import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { schools, users } from "@/db/schema";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import { createWhatsAppConnection } from "./connection";
import {
  resolveInboundSchool,
  sendInboundWhatsAppTypingIndicator,
} from "./inbound";
import { MetaSignupError } from "./meta-signup";
import {
  createAgentPhoneNumberProvider,
  numberProviderFromEnv,
} from "./number-provider";
import { handleAgentPhoneVerification } from "./verification-webhook";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const owners: string[] = [];

async function school(eligible = false) {
  const owner = randomUUID();
  owners.push(owner);
  const email = `${owner}@local.test`;
  await insertAuthUser(sql, owner, email);
  await db.insert(users).values({ id: owner, email });
  const [row] = await db
    .insert(schools)
    .values({
      ownerUserId: owner,
      slug: `connection-${owner.slice(0, 8)}`,
      name: "Connection School",
      timezone: "America/New_York",
      notificationEmail: email,
      ...(eligible
        ? {
            approvedAt: new Date(),
            publishedAt: new Date(),
            phone: "+12125550100",
            publicContactEmail: "hello@school.test",
          }
        : {}),
    })
    .returning({ id: schools.id });
  return requireRow(row, "school").id;
}

beforeAll(async () => {
  await sql`select 1`;
});
afterAll(async () => {
  for (const owner of owners) await deleteAuthUser(sql, owner);
  await sql.end({ timeout: 5 });
});

describe("WhatsApp connection commands", () => {
  it.each([
    ["Your WhatsApp code is one two three four five six.", "123456"],
    ["Your code is 123456. Repeating: 123456.", "123456"],
    ["Your code is 1 2 3 4 5 6 7.", null],
    ["Your code is 123456 or 654321.", null],
  ])(
    "receives only an unambiguous signed voice code (%s)",
    async (text, expectedCode) => {
      const id = await school(true);
      let time = new Date("2026-10-12T10:00:00Z");
      const connection = createWhatsAppConnection({
        db,
        now: () => time,
        numberProvider: {
          async buyUsNumber() {
            return { ok: true, number: "+12125550191", resourceId: `PN-${id}` };
          },
        },
      });
      await connection.enable(id);
      const start = await connection.startSignup(id);
      const config = {
        agentId: "agt_verification",
        secret: "voice-secret",
      };
      const url = "https://fillthemat.test/api/webhooks/agentphone";
      const callId = "call_verification";
      const provider = createAgentPhoneNumberProvider({
        apiKey: "test-key",
        agentId: config.agentId,
        fetch: async (input) => {
          if (String(input).includes("/numbers/"))
            return Response.json({
              id: "num_verification",
              phoneNumber: "+12125550191",
              country: "US",
              status: "active",
              externalId: start.connection.allocationId,
              agentId: config.agentId,
            });
          expect(String(input)).toContain(`/calls/${callId}`);
          return Response.json({
            id: callId,
            agentId: config.agentId,
            phoneNumberId: "num_verification",
            toNumber: "+12125550191",
            direction: "inbound",
            startedAt: "2026-10-12T10:00:00Z",
          });
        },
      });
      const request = (valid = true, ended = false) => {
        const body = JSON.stringify({
          event: ended ? "agent.call_ended" : "agent.message",
          channel: "voice",
          agentId: config.agentId,
          data: {
            numberId: "num_verification",
            to: "+12125550191",
            direction: "inbound",
            callId,
            transcript: ended ? [{ role: "user", content: text }] : text,
          },
        });
        const timestamp = String(Math.floor(time.getTime() / 1000));
        const signature = createHmac("sha256", config.secret)
          .update(`${timestamp}.${body}`)
          .digest("hex");
        return new Request(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": valid ? `sha256=${signature}` : "fake",
            "X-Webhook-Timestamp": timestamp,
            "X-Webhook-ID": "delivery_voice",
          },
          body,
        });
      };
      const dependencies = {
        config,
        connection,
        numberProvider: provider,
        now: () => time,
      };
      expect(
        (await handleAgentPhoneVerification(request(false), dependencies))
          .status,
      ).toBe(403);
      expect((await connection.read(id)).verificationCode).toBeNull();
      const response = await handleAgentPhoneVerification(
        request(),
        dependencies,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        text: "",
        hangup: Boolean(expectedCode),
      });
      expect((await connection.read(id)).verificationCode).toBe(expectedCode);
      await handleAgentPhoneVerification(request(true, true), dependencies);
      expect((await connection.read(id)).verificationCode).toBe(expectedCode);
      time = new Date("2026-10-12T10:01:00Z");
      await connection.cancelSignup(
        id,
        requireRow(start.connection.attemptId, "attempt"),
      );
      await connection.startSignup(id);
      await handleAgentPhoneVerification(request(), dependencies);
      expect((await connection.read(id)).verificationCode).toBeNull();
    },
  );
  it.each(["cancelled", "popup-failed"] as const)(
    "releases a %s reservation after seven days, not before",
    async (state) => {
      const id = await school(true);
      let time = new Date("2026-10-12T10:00:00Z");
      const rentals: string[] = [];
      const connection = createWhatsAppConnection({
        db,
        now: () => time,
        numberProvider: {
          async buyUsNumber() {
            return { ok: true, number: "+12125550190", resourceId: `PN-${id}` };
          },
          async releaseNumber({ resourceId }) {
            rentals.push(resourceId);
          },
        },
      });
      await connection.enable(id);
      const start = await connection.startSignup(id);
      const attempt = requireRow(start.connection.attemptId, "attempt");
      if (state === "cancelled") await connection.cancelSignup(id, attempt);
      else await connection.failSignup(id, attempt);
      expect((await connection.read(id)).releaseAt).toEqual(
        new Date("2026-10-19T10:00:00Z"),
      );
      expect(await connection.release(id)).toMatchObject({ ok: false });
      time = new Date("2026-10-19T10:00:00Z");
      expect(await connection.startSignup(id)).toMatchObject({ ok: false });
      expect(await connection.releaseDue()).toEqual({
        released: 1,
        failed: 0,
        deferred: 0,
      });
      expect((await connection.read(id)).state).toBe("released");
      expect(rentals).toEqual([`PN-${id}`]);
    },
  );
  it.each(["popup", "cancelled", "popup-failed", "failed"] as const)(
    "switches off %s setup so its number can be released",
    async (state) => {
      const id = await school(true);
      let time = new Date("2026-10-12T10:00:00Z");
      const released: string[] = [];
      const connection = createWhatsAppConnection({
        db,
        now: () => time,
        numberProvider: {
          async buyUsNumber() {
            return state === "failed"
              ? { ok: false, code: "purchase_failed" }
              : { ok: true, number: "+12125550189", resourceId: `PN-${id}` };
          },
          async releaseNumber({ resourceId }) {
            released.push(resourceId);
          },
        },
      });
      await connection.enable(id);
      if (state === "cancelled" || state === "popup-failed") {
        const start = await connection.startSignup(id);
        const attempt = requireRow(start.connection.attemptId, "attempt");
        if (state === "cancelled") await connection.cancelSignup(id, attempt);
        else await connection.failSignup(id, attempt);
      }
      expect(await connection.switchOff(id)).toMatchObject({
        ok: true,
        connection: {
          state: "cooling",
          releaseAt: new Date("2026-11-11T10:00:00Z"),
        },
      });
      if (state !== "failed") {
        expect(await connection.switchOn(id)).toMatchObject({
          ok: true,
          connection: { state: "popup", number: "+12125550189" },
        });
        await connection.switchOff(id);
      }
      time = new Date("2026-11-11T10:00:00Z");
      expect(await connection.release(id)).toMatchObject({
        ok: true,
        connection: { state: "released" },
      });
      expect(released).toEqual(state === "failed" ? [] : [`PN-${id}`]);
    },
  );
  it("reconnects expired access on the same number with a fresh customer token", async () => {
    const id = await school(true);
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "aa".repeat(32));
    let time = new Date("2026-10-12T10:00:00Z");
    let expiry = new Date("2026-10-12T11:00:00Z");
    const connection = createWhatsAppConnection({
      db,
      now: () => time,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550188", resourceId: `PN-${id}` };
        },
      },
      meta: {
        async exchangeCode() {
          return { token: "fresh-token", expiresAt: expiry };
        },
        async validateNumber() {
          return true;
        },
        async subscribe() {},
        async updateProfile() {},
        async register() {},
        async readReadiness() {
          return {
            registered: true,
            paymentMethod: true,
            messagingAvailable: true,
            profileName: "School",
          };
        },
      },
    });
    const complete = async () => {
      const start = await connection.startSignup(id);
      return connection.completeSignup(id, {
        attemptId: requireRow(start.connection.attemptId, "attempt"),
        code: "code",
        wabaId: "198003",
        phoneNumberId: "106500000198003",
      });
    };
    try {
      await connection.enable(id);
      await complete();
      await connection.checkReadiness(id);
      await connection.markBroken(id, "access");
      time = new Date("2026-10-12T12:00:00Z");
      expect(await connection.checkReadiness(id)).toMatchObject({
        ok: false,
        connection: { state: "broken-access" },
      });
      expiry = new Date("2026-12-01T12:00:00Z");
      expect(await complete()).toMatchObject({
        ok: true,
        connection: { state: "needs-card", number: "+12125550188" },
      });
      expect(await connection.checkReadiness(id)).toMatchObject({
        connection: { state: "live" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("restarts a broken number with a new allocation only after releasing the old carrier rental", async () => {
    const id = await school(true);
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "bb".repeat(32));
    const purchases: string[] = [];
    const released: string[] = [];
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async releaseNumber({ resourceId }) {
          released.push(resourceId);
        },
        async buyUsNumber({ allocationId }) {
          purchases.push(allocationId);
          if (purchases.length === 2) expect(released).toEqual([`PN-${id}`]);
          return {
            ok: true,
            number: purchases.length === 1 ? "+12125550187" : "+12125550186",
            resourceId: `PN-${id}`,
          };
        },
      },
      meta: {
        async exchangeCode() {
          return { token: "number-token", expiresAt: null };
        },
        async validateNumber() {
          return true;
        },
        async subscribe() {},
        async updateProfile() {},
        async register() {},
        async readReadiness() {
          return {
            registered: true,
            paymentMethod: true,
            profileName: "School",
          };
        },
      },
    });
    try {
      await connection.enable(id);
      const start = await connection.startSignup(id);
      await connection.completeSignup(id, {
        attemptId: requireRow(start.connection.attemptId, "attempt"),
        code: "code",
        wabaId: "198004",
        phoneNumberId: "106500000198004",
      });
      await connection.checkReadiness(id);
      await connection.markBroken(id, "number");
      expect(await connection.enable(id)).toMatchObject({
        ok: true,
        connection: {
          state: "popup",
          number: "+12125550186",
          phoneNumberId: null,
          wabaId: null,
        },
      });
      expect(purchases[1]).not.toBe(purchases[0]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each(["card", "access", "restricted", "number"] as const)(
    "keeps broken-%s offline until Meta confirms funding and messaging health",
    async (part) => {
      const id = await school(true);
      vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "98".repeat(32));
      let paymentMethod = true;
      let messagingAvailable = true;
      const connection = createWhatsAppConnection({
        db,
        numberProvider: {
          async buyUsNumber() {
            return { ok: true, number: "+12125550198", resourceId: `PN-${id}` };
          },
        },
        meta: {
          async exchangeCode() {
            return { token: "health-token", expiresAt: null };
          },
          async validateNumber() {
            return true;
          },
          async subscribe() {},
          async updateProfile() {},
          async register() {},
          async readReadiness() {
            return {
              registered: true,
              paymentMethod,
              messagingAvailable,
              profileName: "Connection School",
            };
          },
        },
      });
      try {
        await connection.enable(id);
        const started = await connection.startSignup(id);
        await connection.completeSignup(id, {
          attemptId: requireRow(started.connection.attemptId, "attempt"),
          code: "code",
          wabaId: "198001",
          phoneNumberId: `${Date.now()}${part.length}`,
        });
        await connection.checkReadiness(id);
        expect(await connection.markBroken(id, part)).toMatchObject({
          connection: { state: `broken-${part}` },
        });
        paymentMethod = false;
        expect(await connection.checkReadiness(id)).toMatchObject({
          connection: { state: `broken-${part}` },
        });
        paymentMethod = true;
        messagingAvailable = false;
        expect(await connection.checkReadiness(id)).toMatchObject({
          connection: { state: `broken-${part}` },
        });
        messagingAvailable = true;
        expect(await connection.checkReadiness(id)).toMatchObject({
          connection: { state: "live" },
        });
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it("handles account restrictions, access removal and offboarding for the matching account, ignoring other apps and stale events after recovery", async () => {
    const id = await school(true);
    const other = await school(true);
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "99".repeat(32));
    let time = new Date("2026-10-12T12:00:00Z");
    const connection = createWhatsAppConnection({
      db,
      now: () => time,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550199", resourceId: `PN-${id}` };
        },
      },
      meta: {
        async exchangeCode() {
          return { token: "webhook-token", expiresAt: null };
        },
        async validateNumber() {
          return true;
        },
        async subscribe() {},
        async updateProfile() {},
        async register() {},
        async readReadiness() {
          return {
            registered: true,
            paymentMethod: true,
            messagingAvailable: true,
            profileName: "School",
          };
        },
      },
    });
    const payload = (event: string, extra = {}) => ({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "198002",
          time: time.getTime() / 1000,
          changes: [{ field: "account_update", value: { event, ...extra } }],
        },
      ],
    });
    try {
      await connection.enable(id);
      const start = await connection.startSignup(id);
      await connection.completeSignup(id, {
        attemptId: requireRow(start.connection.attemptId, "attempt"),
        code: "code",
        wabaId: "198002",
        phoneNumberId: "106500000198002",
      });
      await connection.checkReadiness(id);
      time = new Date("2026-10-12T12:01:00Z");
      await connection.handleAccountUpdates(
        payload("PARTNER_APP_UNINSTALLED", {
          waba_info: { waba_id: "198002", partner_app_id: "other" },
        }),
        "198",
      );
      expect((await connection.read(id)).state).toBe("live");
      for (const [event, part, extra] of [
        [
          "ACCOUNT_RESTRICTION",
          "restricted",
          {
            restriction_info: [
              { restriction_type: "RESTRICTED_CUSTOMER_INITIATED_MESSAGING" },
            ],
          },
        ],
        [
          "DISABLED_UPDATE",
          "restricted",
          { ban_info: { waba_ban_state: "DISABLE" } },
        ],
        [
          "PARTNER_APP_UNINSTALLED",
          "access",
          { waba_info: { waba_id: "198002", partner_app_id: "198" } },
        ],
        ["ACCOUNT_OFFBOARDED", "number", {}],
        ["ACCOUNT_DELETED", "number", {}],
      ] as const) {
        time = new Date(time.getTime() + 60_000);
        const callback = payload(event, extra);
        await connection.handleAccountUpdates(callback, "198");
        expect((await connection.read(id)).state).toBe(`broken-${part}`);
        expect((await connection.read(other)).state).toBe("off");
        time = new Date(time.getTime() + 60_000);
        await connection.checkReadiness(id);
        expect((await connection.read(id)).state).toBe("live");
        await connection.handleAccountUpdates(callback, "198");
        expect((await connection.read(id)).state).toBe("live");
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("goes Live only after Meta confirms both registration and a payment method", async () => {
    const id = await school(true);
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "96".repeat(32));
    let registered = true;
    let paymentMethod = false;
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550196", resourceId: `PN-${id}` };
        },
      },
      meta: {
        async exchangeCode() {
          return { token: "readiness-token", expiresAt: null };
        },
        async validateNumber() {
          return true;
        },
        async subscribe() {},
        async updateProfile() {},
        async register() {},
        async readReadiness(input) {
          expect(input).toEqual({
            token: "readiness-token",
            wabaId: "196001",
            phoneNumberId: "106500000196001",
          });
          return {
            registered,
            paymentMethod,
            profileName: "Connection School",
          };
        },
      },
    });
    try {
      expect(await connection.checkReadiness(id)).toMatchObject({
        ok: false,
        code: "invalid_state",
      });
      await connection.enable(id);
      const started = await connection.startSignup(id);
      await connection.completeSignup(id, {
        attemptId: requireRow(started.connection.attemptId, "attempt"),
        code: "code",
        wabaId: "196001",
        phoneNumberId: "106500000196001",
      });
      expect(await connection.checkReadiness(id)).toMatchObject({
        ok: true,
        connection: { state: "needs-card" },
      });
      paymentMethod = true;
      registered = false;
      expect(await connection.checkReadiness(id)).toMatchObject({
        ok: true,
        connection: { state: "needs-card" },
      });
      registered = true;
      expect(await connection.checkReadiness(id)).toMatchObject({
        ok: true,
        connection: { state: "live", profileName: "Connection School" },
      });
      expect(await connection.read(id)).toMatchObject({
        state: "live",
        profileName: "Connection School",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("serializes registration and allows switching off while Meta is working", async () => {
    const id = await school(true);
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "ef".repeat(32));
    let unblock: (() => void) | undefined;
    let registering: (() => void) | undefined;
    const startedRegistration = new Promise<void>((resolve) => {
      registering = resolve;
    });
    const registration = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550156", resourceId: `PN-${id}` };
        },
      },
      meta: {
        async exchangeCode() {
          return { token: "concurrent-token", expiresAt: null };
        },
        async readReadiness() {
          throw new Error("Unexpected readiness check");
        },
        async validateNumber() {
          return true;
        },
        async subscribe() {},
        async updateProfile() {},
        async register() {
          registering?.();
          await registration;
        },
      },
    });
    try {
      await connection.enable(id);
      const started = await connection.startSignup(id);
      const input = {
        attemptId: requireRow(started.connection.attemptId, "attempt"),
        code: "code",
        wabaId: "195006",
        phoneNumberId: "106500000195006",
      };
      const completion = connection.completeSignup(id, input);
      await startedRegistration;
      try {
        expect(await connection.completeSignup(id, input)).toMatchObject({
          ok: false,
          code: "invalid_state",
          connection: { state: "registering" },
        });
        expect(
          await connection.cancelSignup(id, input.attemptId),
        ).toMatchObject({ ok: false, code: "invalid_state" });
        expect(await connection.startSignup(id)).toMatchObject({
          ok: false,
          code: "invalid_state",
        });
        expect(await connection.switchOff(id)).toMatchObject({
          ok: true,
          connection: { state: "cooling" },
        });
      } finally {
        unblock?.();
      }
      expect(await completion).toMatchObject({
        ok: true,
        connection: { state: "cooling" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("refuses another school's attempt and assets without subscribing or registering", async () => {
    const id = await school(true);
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550154", resourceId: `PN-${id}` };
        },
      },
      meta: {
        async exchangeCode() {
          return { token: "unrelated-token", expiresAt: null };
        },
        async readReadiness() {
          throw new Error("Unexpected readiness check");
        },
        async validateNumber() {
          return false;
        },
        async subscribe() {
          throw new Error("Must not subscribe unrelated assets");
        },
        async updateProfile() {},
        async register() {
          throw new Error("Must not register unrelated assets");
        },
      },
    });
    await connection.enable(id);
    const started = await connection.startSignup(id);
    const input = {
      attemptId: requireRow(started.connection.attemptId, "attempt"),
      code: "code",
      wabaId: "195004",
      phoneNumberId: "106500000195004",
    };
    expect(
      await connection.completeSignup(await school(true), input),
    ).toMatchObject({ ok: false, code: "invalid_state" });
    expect(await connection.completeSignup(id, input)).toMatchObject({
      ok: false,
      code: "invalid_assets",
      connection: {
        state: "popup-failed",
        wabaId: null,
        phoneNumberId: null,
        number: "+12125550154",
      },
    });
  });
  it("fails visibly without Meta credentials and permits a fresh popup retry", async () => {
    vi.stubEnv("WHATSAPP_APP_ID", "");
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    const id = await school(true);
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550155", resourceId: `PN-${id}` };
        },
      },
    });
    try {
      await connection.enable(id);
      const started = await connection.startSignup(id);
      expect(
        await connection.completeSignup(id, {
          attemptId: requireRow(started.connection.attemptId, "attempt"),
          code: "code",
          wabaId: "195005",
          phoneNumberId: "106500000195005",
        }),
      ).toMatchObject({
        ok: false,
        code: "unconfigured",
        connection: { state: "popup-failed", number: "+12125550155" },
      });
      expect(await connection.startSignup(id)).toMatchObject({
        ok: true,
        connection: { state: "popup", number: "+12125550155" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("captures the reserved number's OTP through a signed carrier callback, not an unsigned or cross-allocation callback", async () => {
    const id = await school(true);
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550153", resourceId: `PN-${id}` };
        },
      },
    });
    await connection.enable(id);
    const started = await connection.startSignup(id);
    const config = {
      agentId: "agt_verification",
      secret: "webhook-secret",
    };
    const numberProvider = createAgentPhoneNumberProvider({
      apiKey: "test-key",
      agentId: config.agentId,
      fetch: async (url) => {
        expect(String(url)).toContain("/numbers/num_verification");
        return Response.json({
          id: "num_verification",
          phoneNumber: "+12125550153",
          country: "US",
          status: "active",
          externalId: started.connection.allocationId,
          agentId: config.agentId,
        });
      },
    });
    const url = "https://fillthemat.test/api/webhooks/agentphone";
    const body = JSON.stringify({
      event: "agent.message",
      channel: "sms",
      agentId: config.agentId,
      data: {
        numberId: "num_verification",
        to: "+12125550153",
        direction: "inbound",
        message: "Your WhatsApp code: 123-456. Do not share it.",
        receivedAt: new Date().toISOString(),
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signed = `sha256=${createHmac("sha256", config.secret).update(`${timestamp}.${body}`).digest("hex")}`;
    const request = (signature: string) =>
      new Request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Timestamp": timestamp,
          "X-Webhook-ID": "delivery_sms",
        },
        body,
      });
    expect(
      (
        await handleAgentPhoneVerification(request("fake"), {
          connection,
          config,
          numberProvider,
        })
      ).status,
    ).toBe(403);
    expect((await connection.read(id)).verificationCode).toBeNull();
    expect(
      (
        await handleAgentPhoneVerification(request(signed), {
          connection,
          config,
          numberProvider,
        })
      ).status,
    ).toBe(200);
    expect((await connection.read(id)).verificationCode).toBe("123456");
    await connection.cancelSignup(
      id,
      requireRow(started.connection.attemptId, "attempt"),
    );
    await connection.startSignup(id);
    await handleAgentPhoneVerification(request(signed), {
      connection,
      config,
      numberProvider,
    });
    expect((await connection.read(id)).verificationCode).toBeNull();
  });
  it("does not let a changed unsigned delivery ID replay an older SMS over a newer code", async () => {
    const id = await school(true);
    let time = new Date("2026-10-12T10:00:00Z");
    const connection = createWhatsAppConnection({
      db,
      now: () => time,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550194", resourceId: "num_replay" };
        },
      },
    });
    await connection.enable(id);
    const started = await connection.startSignup(id);
    const config = { agentId: "agt_verification", secret: "replay-secret" };
    const provider = createAgentPhoneNumberProvider({
      apiKey: "test-key",
      agentId: config.agentId,
      fetch: async () =>
        Response.json({
          id: "num_replay",
          phoneNumber: "+12125550194",
          country: "US",
          status: "active",
          externalId: started.connection.allocationId,
          agentId: config.agentId,
        }),
    });
    const deliver = (code: string, receivedAt: string, deliveryId: string) => {
      const body = JSON.stringify({
        event: "agent.message",
        channel: "sms",
        agentId: config.agentId,
        data: {
          numberId: "num_replay",
          to: "+12125550194",
          direction: "inbound",
          message: `WhatsApp code: ${code}`,
          receivedAt,
        },
      });
      const timestamp = String(Math.floor(time.getTime() / 1000));
      return handleAgentPhoneVerification(
        new Request("https://example.test/api/webhooks/agentphone", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-timestamp": timestamp,
            "x-webhook-id": deliveryId,
            "x-webhook-signature": `sha256=${createHmac("sha256", config.secret).update(`${timestamp}.${body}`).digest("hex")}`,
          },
          body,
        }),
        { config, connection, numberProvider: provider, now: () => time },
      );
    };
    await deliver("123456", time.toISOString(), "delivery_first");
    time = new Date("2026-10-12T10:01:00Z");
    await deliver("654321", time.toISOString(), "delivery_second");
    await deliver("123456", "2026-10-12T10:00:00.000Z", "delivery_tampered");
    expect((await connection.read(id)).verificationCode).toBe("654321");
  });
  it("shows a current six-digit carrier code only during signup, rejects old allocations and does not extend replays", async () => {
    const id = await school(true);
    let now = new Date("2026-10-12T10:00:00Z");
    const connection = createWhatsAppConnection({
      db,
      now: () => now,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550151", resourceId: `PN-${id}` };
        },
      },
    });
    await connection.enable(id);
    const started = await connection.startSignup(id);
    const input = {
      allocationId: requireRow(started.connection.allocationId, "allocation"),
      number: "+12125550151",
      messageId: "SM195-code",
      code: "654321",
      receivedAt: now,
    };
    expect(
      await connection.receiveVerificationCode({
        ...input,
        allocationId: randomUUID(),
      }),
    ).toBe(false);
    expect(
      await connection.receiveVerificationCode({ ...input, code: "12345" }),
    ).toBe(false);
    expect(await connection.receiveVerificationCode(input)).toBe(true);
    expect(await connection.read(id)).toMatchObject({
      verificationCode: "654321",
    });
    expect(
      (await connection.read(await school(true))).verificationCode,
    ).toBeNull();
    now = new Date("2026-10-12T10:11:00Z");
    expect(await connection.receiveVerificationCode(input)).toBe(false);
    expect((await connection.read(id)).verificationCode).toBeNull();
    now = new Date("2026-10-12T10:01:00Z");
    await connection.cancelSignup(
      id,
      requireRow(started.connection.attemptId, "attempt"),
    );
    expect(
      await connection.receiveVerificationCode({
        ...input,
        messageId: "SM195-late",
      }),
    ).toBe(false);
    expect((await connection.read(id)).verificationCode).toBeNull();
    await connection.startSignup(id);
    expect(await connection.receiveVerificationCode(input)).toBe(false);
    expect(
      await connection.receiveVerificationCode({
        ...input,
        messageId: "SM195-delayed-from-prior-popup",
      }),
    ).toBe(false);
    expect((await connection.read(id)).verificationCode).toBeNull();
  });
  it("keeps the number through a failed popup and failed registration, then retries with the same PIN", async () => {
    const id = await school(true);
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "cd".repeat(32));
    let purchased = false;
    const pins: string[] = [];
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          if (purchased) throw new Error("Must not repurchase");
          purchased = true;
          return { ok: true, number: "+12125550150", resourceId: `PN-${id}` };
        },
      },
      meta: {
        async exchangeCode() {
          return { token: "retry-token", expiresAt: null };
        },
        async readReadiness() {
          throw new Error("Unexpected readiness check");
        },
        async validateNumber() {
          return true;
        },
        async subscribe() {},
        async updateProfile() {},
        async register({ pin }) {
          pins.push(pin);
          if (pins.length === 1) throw new MetaSignupError("signup_failed");
        },
      },
    });
    try {
      await connection.enable(id);
      const initial = await connection.startSignup(id);
      await connection.failSignup(
        id,
        requireRow(initial.connection.attemptId, "attempt"),
      );
      expect(await connection.read(id)).toMatchObject({
        state: "popup-failed",
        number: "+12125550150",
      });
      const resumed = await connection.startSignup(id);
      const input = {
        attemptId: requireRow(resumed.connection.attemptId, "attempt"),
        code: "retry-code",
        wabaId: "195002",
        phoneNumberId: "106500000195002",
      };
      expect(await connection.completeSignup(id, input)).toMatchObject({
        ok: false,
        code: "signup_failed",
        connection: { state: "popup-failed", number: "+12125550150" },
      });
      const retried = await connection.startSignup(id);
      expect(
        await connection.completeSignup(id, {
          ...input,
          attemptId: requireRow(retried.connection.attemptId, "attempt"),
        }),
      ).toMatchObject({
        ok: true,
        connection: { state: "needs-card", number: "+12125550150" },
      });
      expect(pins).toHaveLength(2);
      expect(pins[1]).toBe(pins[0]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("completes Meta signup, registers the reserved number and uses the school's saved credential", async () => {
    const id = await school(true);
    const phoneNumberId = "106500000195001";
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
    const profiles: unknown[] = [];
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          return { ok: true, number: "+12125550149", resourceId: `PN-${id}` };
        },
      },
      meta: {
        async exchangeCode(code) {
          expect(code).toBe("popup-code");
          return {
            token: "customer-school-token",
            expiresAt: new Date("2027-01-01"),
          };
        },
        async readReadiness() {
          throw new Error("Unexpected readiness check");
        },
        async validateNumber(input) {
          return (
            input.token === "customer-school-token" &&
            input.number === "+12125550149" &&
            input.phoneNumberId === phoneNumberId &&
            input.wabaId === "195001"
          );
        },
        async subscribe() {},
        async register(input) {
          expect(input.pin).toMatch(/^\d{6}$/);
        },
        async updateProfile(input) {
          profiles.push(input);
        },
      },
    });
    try {
      await connection.enable(id);
      const started = await connection.startSignup(id);
      expect(
        await connection.completeSignup(id, {
          attemptId: requireRow(started.connection.attemptId, "attempt"),
          code: "popup-code",
          wabaId: "195001",
          phoneNumberId,
        }),
      ).toMatchObject({
        ok: true,
        connection: {
          state: "needs-card",
          number: "+12125550149",
          wabaId: "195001",
          phoneNumberId,
        },
      });
      const message = {
        phoneNumberId,
        wamid: "wamid.signup",
        waId: "12125550200",
        profileName: null,
        text: "Hello",
      };
      expect(await resolveInboundSchool(message)).toEqual({
        resolved: true,
        schoolId: id,
      });
      expect(profiles).toEqual([
        {
          token: "customer-school-token",
          phoneNumberId,
          profileName: "Connection School",
          email: "hello@school.test",
          website: null,
        },
      ]);
      const sends: string[] = [];
      vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
        sends.push(new Headers(init.headers).get("Authorization") ?? "");
        return Response.json({ success: true });
      });
      await sendInboundWhatsAppTypingIndicator(message);
      expect(sends).toEqual([]);
      expect(JSON.stringify(await connection.read(id))).not.toContain(
        "customer-school-token",
      );
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
  it("resumes a cancelled popup with its reserved number, without another purchase", async () => {
    const id = await school(true);
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "19".repeat(32));
    let purchased = false;
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          if (purchased) throw new Error("Must keep the reserved number");
          purchased = true;
          return { ok: true, number: "+12125550148", resourceId: `PN-${id}` };
        },
      },
      meta: {
        async exchangeCode() {
          return { token: "resumed-token", expiresAt: null };
        },
        async readReadiness() {
          throw new Error("Unexpected readiness check");
        },
        async validateNumber() {
          return true;
        },
        async subscribe() {},
        async register() {},
        async updateProfile() {},
      },
    });
    try {
      await connection.enable(id);
      const started = await connection.startSignup(id);
      expect(started.ok).toBe(true);
      const attemptId = requireRow(started.connection.attemptId, "attempt");
      expect(await connection.cancelSignup(id, attemptId)).toMatchObject({
        ok: true,
        connection: { state: "cancelled", number: "+12125550148" },
      });
      expect(await connection.startSignup(id)).toMatchObject({
        ok: true,
        connection: {
          state: "popup",
          number: "+12125550148",
          providerResourceId: `PN-${id}`,
        },
      });
      expect((await connection.read(id)).attemptId).not.toBe(attemptId);
      expect(await connection.cancelSignup(id, attemptId)).toMatchObject({
        ok: false,
        code: "invalid_state",
      });
      expect(
        await connection.completeSignup(id, {
          attemptId: requireRow(
            (await connection.read(id)).attemptId,
            "resumed attempt",
          ),
          code: "resumed-code",
          wabaId: "195007",
          phoneNumberId: "106500000195007",
        }),
      ).toMatchObject({
        ok: true,
        connection: { state: "needs-card", number: "+12125550148" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("reports setup unavailable without carrier credentials and permits a later retry", async () => {
    const id = await school(true);
    vi.stubEnv("AGENTPHONE_API_KEY", "");
    vi.stubEnv("AGENTPHONE_VERIFICATION_AGENT_ID", "");
    vi.stubEnv("AGENTPHONE_WEBHOOK_SECRET", "");
    try {
      const connection = createWhatsAppConnection({
        db,
        numberProvider: numberProviderFromEnv(),
      });
      expect(await connection.enable(id)).toMatchObject({
        ok: false,
        code: "unconfigured",
        connection: { state: "failed", number: null },
      });
      expect(await connection.enable(id)).toMatchObject({
        ok: false,
        code: "unconfigured",
        connection: { state: "failed" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps an uncertain carrier outcome claimed rather than risking another purchase", async () => {
    const id = await school(true);
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          throw new Error("Carrier response lost after purchase");
        },
      },
    });
    await expect(connection.enable(id)).rejects.toThrow(
      "Carrier response lost after purchase",
    );
    expect((await connection.read(id)).state).toBe("buying");
    expect(await connection.enable(id)).toMatchObject({
      ok: false,
      code: "invalid_state",
      connection: { state: "buying" },
    });
  });
  it("reconciles an existing carrier allocation on retry without purchasing a second number", async () => {
    const id = await school(true);
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          return { ok: false, code: "purchase_failed" };
        },
      },
    });
    await connection.enable(id);
    const saved = await connection.read(id);
    const resumed = createWhatsAppConnection({
      db,
      numberProvider: createAgentPhoneNumberProvider({
        apiKey: "test-token",
        agentId: "agt_verification",
        fetch: async (url, init) => {
          if (
            init?.method !== "GET" ||
            !String(url).includes(`numbers?externalId=${saved.allocationId}`)
          )
            throw new Error("Must find the prior rental, not buy another");
          return Response.json({
            data: [
              {
                id: "num_prior",
                phoneNumber: "+12125550146",
                country: "US",
                status: "active",
                externalId: saved.allocationId,
                agentId: "agt_verification",
              },
            ],
            hasMore: false,
            total: 1,
          });
        },
      }),
    });
    expect(await resumed.enable(id)).toMatchObject({
      ok: true,
      connection: {
        state: "popup",
        number: "+12125550146",
        providerResourceId: "num_prior",
        allocationId: saved.allocationId,
      },
    });
  });
  it("purchases an AgentPhone US number and records the phone resource, not the school phone", async () => {
    const id = await school(true);
    const requests: { url: string; body: string }[] = [];
    const connection = createWhatsAppConnection({
      db,
      numberProvider: createAgentPhoneNumberProvider({
        apiKey: "test-token",
        agentId: "agt_verification",
        fetch: async (url, init) => {
          requests.push({ url: String(url), body: String(init?.body ?? "") });
          if (init?.method === "POST")
            return Response.json({
              phoneNumber: "+12125550145",
              id: "num_purchased",
              country: "US",
              status: "active",
              agentId: "agt_verification",
              externalId: JSON.parse(String(init.body)).externalId,
            });
          return Response.json({
            data: [],
            hasMore: false,
            total: 0,
          });
        },
      }),
    });
    expect(await connection.enable(id)).toMatchObject({
      ok: true,
      connection: {
        state: "popup",
        number: "+12125550145",
        providerResourceId: "num_purchased",
      },
    });
    expect(requests[1]?.url).toBe("https://api.agentphone.ai/v1/numbers");
    expect(JSON.parse(requests[1]?.body ?? "{}")).toEqual({
      country: "US",
      type: "sms",
      agentId: "agt_verification",
      externalId: (await connection.read(id)).allocationId,
    });
  });
  it("refuses a concurrent enable while the first purchase is in progress", async () => {
    const id = await school(true);
    let finishPurchase: (() => void) | undefined;
    let purchaseStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      purchaseStarted = resolve;
    });
    const purchase = new Promise<void>((resolve) => {
      finishPurchase = resolve;
    });
    let count = 0;
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          count += 1;
          purchaseStarted?.();
          await purchase;
          return { ok: true, number: "+12125550144", resourceId: `PN-${id}` };
        },
      },
    });
    const first = connection.enable(id);
    await started;
    try {
      expect(await connection.enable(id)).toMatchObject({
        ok: false,
        code: "invalid_state",
        connection: { state: "buying" },
      });
    } finally {
      finishPurchase?.();
    }
    expect(await first).toMatchObject({
      ok: true,
      connection: { state: "popup" },
    });
    expect(count).toBe(1);
  });
  it("shows a failed purchase and retries with the same allocation identity", async () => {
    const id = await school(true);
    const attempts: string[] = [];
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber(input) {
          attempts.push(input.allocationId);
          return attempts.length === 1
            ? { ok: false, code: "purchase_failed" }
            : { ok: true, number: "+12125550143", resourceId: `PN-${id}` };
        },
      },
    });
    expect(await connection.enable(id)).toMatchObject({
      ok: false,
      code: "purchase_failed",
      connection: { state: "failed", number: null, providerResourceId: null },
    });
    expect((await connection.read(id)).state).toBe("failed");
    expect(await connection.enable(id)).toMatchObject({
      ok: true,
      connection: { state: "popup", number: "+12125550143" },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(attempts[0]);
  });
  it("buys a US number, persists its allocation, and awaits Meta signup without buying again", async () => {
    const id = await school(true);
    const purchases: { schoolId: string; allocationId: string }[] = [];
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber(input) {
          purchases.push(input);
          expect((await connection.read(id)).state).toBe("buying");
          return { ok: true, number: "+12125550142", resourceId: `PN-${id}` };
        },
      },
    });
    expect(await connection.enable(id)).toMatchObject({
      ok: true,
      connection: {
        state: "popup",
        number: "+12125550142",
        providerResourceId: `PN-${id}`,
        gaps: [],
      },
    });
    const saved = await connection.read(id);
    expect(saved).toMatchObject({
      state: "popup",
      number: "+12125550142",
      providerResourceId: `PN-${id}`,
    });
    expect(purchases).toEqual([
      { schoolId: id, allocationId: saved.allocationId },
    ]);
    expect(await connection.enable(id)).toMatchObject({
      ok: false,
      code: "invalid_state",
      connection: saved,
    });
    expect(purchases).toHaveLength(1);
    expect(await connection.read(await school())).toMatchObject({
      state: "off",
      number: null,
      providerResourceId: null,
    });
  });
  it("lists every eligibility gap and refuses purchase until each is fixed", async () => {
    const id = await school();
    const connection = createWhatsAppConnection({
      db,
      numberProvider: {
        async buyUsNumber() {
          throw new Error("Ineligible school must not buy a number");
        },
      },
    });
    expect(await connection.enable(id)).toMatchObject({
      ok: false,
      code: "ineligible",
      connection: {
        state: "off",
        gaps: ["approval", "publishing", "phone", "public-contact-email"],
      },
    });
    for (const [field, value, gap] of [
      ["approvedAt", new Date(), "approval"],
      ["publishedAt", new Date(), "publishing"],
      ["phone", "+12125550100", "phone"],
    ] as const) {
      await db
        .update(schools)
        .set({ [field]: value })
        .where(eq(schools.id, id));
      const result = await connection.enable(id);
      expect(result).toMatchObject({ ok: false, code: "ineligible" });
      expect(result.connection.gaps).not.toContain(gap);
      expect(result.connection.state).toBe("off");
    }
    expect((await connection.read(id)).gaps).toEqual(["public-contact-email"]);
  });
});
