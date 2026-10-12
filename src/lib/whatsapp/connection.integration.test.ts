import { randomUUID } from "node:crypto";
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
  createTwilioNumberProvider,
  numberProviderFromEnv,
} from "./number-provider";

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
  it("reports setup unavailable without carrier credentials and permits a later retry", async () => {
    const id = await school(true);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_SMS_WEBHOOK_URL", "");
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
      numberProvider: createTwilioNumberProvider({
        accountSid: `AC${"a".repeat(32)}`,
        authToken: "test-token",
        smsWebhookUrl: "https://example.test/sms",
        fetch: async (url, init) => {
          if (
            init?.method !== "GET" ||
            !String(url).includes("IncomingPhoneNumbers.json")
          )
            throw new Error("Must find the prior rental, not buy another");
          return Response.json({
            incoming_phone_numbers: [
              {
                sid: `PN${"c".repeat(32)}`,
                phone_number: "+442079460000",
                friendly_name: "Unrelated international number",
              },
              {
                sid: `PN${"d".repeat(32)}`,
                phone_number: "+12125550146",
                friendly_name: `fillthemat:${saved.allocationId}`,
              },
            ],
            next_page_uri: null,
          });
        },
      }),
    });
    expect(await resumed.enable(id)).toMatchObject({
      ok: true,
      connection: {
        state: "popup",
        number: "+12125550146",
        providerResourceId: `PN${"d".repeat(32)}`,
        allocationId: saved.allocationId,
      },
    });
  });
  it("purchases through Twilio's US inventory and records the phone resource, not the school phone", async () => {
    const id = await school(true);
    const requests: { url: string; body: string }[] = [];
    const connection = createWhatsAppConnection({
      db,
      numberProvider: createTwilioNumberProvider({
        accountSid: `AC${"a".repeat(32)}`,
        authToken: "test-token",
        smsWebhookUrl: "https://example.test/api/webhooks/twilio",
        fetch: async (url, init) => {
          requests.push({ url: String(url), body: String(init?.body ?? "") });
          if (init?.method === "POST")
            return Response.json({
              phone_number: "+12125550145",
              sid: `PN${"b".repeat(32)}`,
            });
          if (String(url).includes("AvailablePhoneNumbers/US/Local"))
            return Response.json({
              available_phone_numbers: [{ phone_number: "+12125550145" }],
            });
          return Response.json({
            incoming_phone_numbers: [],
            next_page_uri: null,
          });
        },
      }),
    });
    expect(await connection.enable(id)).toMatchObject({
      ok: true,
      connection: {
        state: "popup",
        number: "+12125550145",
        providerResourceId: `PN${"b".repeat(32)}`,
      },
    });
    expect(requests[1]?.url).toContain(
      "AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&VoiceEnabled=true&PageSize=1",
    );
    const body = new URLSearchParams(requests[2]?.body);
    expect(body.get("PhoneNumber")).toBe("+12125550145");
    expect(body.get("SmsUrl")).toBe("https://example.test/api/webhooks/twilio");
    expect(body.get("FriendlyName")).toBe(
      `fillthemat:${(await connection.read(id)).allocationId}`,
    );
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
