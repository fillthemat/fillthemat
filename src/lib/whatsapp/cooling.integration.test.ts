import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { schools } from "@/db/schema";
import {
  appendMessage,
  findConversation,
  findOrCreateConversation,
  loadTranscript,
} from "@/lib/conversations/conversation-store";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { createWhatsAppConnection } from "./connection";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const owners: string[] = [];
afterAll(async () => {
  for (const owner of owners) await deleteSchoolOwner(sql, owner);
  await sql.end({ timeout: 5 });
});

async function liveConnection(
  options: { releaseNumber?: (resourceId: string) => Promise<void> } = {},
) {
  const ownerId = randomUUID();
  owners.push(ownerId);
  const { schoolId } = await seedSchool(sql, {
    ownerId,
    name: "Cooling School",
    slug: `cooling-${ownerId}`,
    phone: "+12125550100",
    publishedAt: new Date(),
    offerings: [{ name: "Trial" }],
  });
  await db
    .update(schools)
    .set({ publicContactEmail: "hello@school.test" })
    .where(eq(schools.id, schoolId));
  let time = new Date("2026-10-12T10:00:00Z");
  let purchases = 0;
  const released: string[] = [];
  let paymentMethod = true;
  const connection = createWhatsAppConnection({
    db,
    now: () => time,
    numberProvider: {
      async buyUsNumber() {
        purchases += 1;
        return {
          ok: true,
          number: `+1212555010${purchases}`,
          resourceId: `PN-${schoolId}-${purchases}`,
        };
      },
      async releaseNumber({ resourceId }) {
        await options.releaseNumber?.(resourceId);
        released.push(resourceId);
      },
    },
    meta: {
      async exchangeCode() {
        return { token: "cooling-token", expiresAt: null };
      },
      async validateNumber() {
        return true;
      },
      async subscribe() {},
      async register() {},
      async readReadiness() {
        return {
          registered: true,
          paymentMethod,
          profileName: "Cooling School",
        };
      },
      async deregister({ phoneNumberId }) {
        released.push(phoneNumberId);
      },
    },
  });
  await connection.enable(schoolId);
  const started = await connection.startSignup(schoolId);
  await connection.completeSignup(schoolId, {
    attemptId: requireRow(started.connection.attemptId, "attempt"),
    code: "signup-code",
    wabaId: "197001",
    phoneNumberId: `197${Date.now()}${Math.floor(Math.random() * 10000)}`,
  });
  await connection.checkReadiness(schoolId);
  return {
    connection,
    schoolId,
    released,
    removeCard: () => {
      paymentMethod = false;
    },
    setTime: (at: string) => {
      time = new Date(at);
    },
  };
}

describe("WhatsApp cooling-off", () => {
  it("resumes a failed carrier release without deregistering twice or reviving the number", async () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "97".repeat(32));
    let attempts = 0;
    try {
      const { connection, schoolId, released, setTime } = await liveConnection({
        releaseNumber: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("Carrier unavailable");
        },
      });
      const live = await connection.read(schoolId);
      await connection.switchOff(schoolId);
      setTime("2026-11-11T10:00:00Z");
      await expect(connection.release(schoolId)).rejects.toThrow(
        "Carrier unavailable",
      );
      expect(await connection.read(schoolId)).toMatchObject({
        state: "cooling",
        number: live.number,
      });
      expect(await connection.switchOn(schoolId)).toMatchObject({
        ok: false,
        code: "invalid_state",
      });
      expect(await connection.release(schoolId)).toMatchObject({
        ok: true,
        connection: { state: "released" },
      });
      expect(released).toEqual([live.phoneNumberId, live.providerResourceId]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("excludes a second release and restoration while the carrier request is in flight", async () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "97".repeat(32));
    const { promise: started, resolve: startedRelease } =
      Promise.withResolvers<void>();
    const { promise: pending, resolve: finishRelease } =
      Promise.withResolvers<void>();
    try {
      const { connection, schoolId, setTime } = await liveConnection({
        releaseNumber: async () => {
          startedRelease();
          await pending;
        },
      });
      await connection.switchOff(schoolId);
      setTime("2026-11-11T10:00:00Z");
      const first = connection.release(schoolId);
      await started;
      try {
        expect(await connection.release(schoolId)).toMatchObject({
          ok: false,
          code: "invalid_state",
        });
        expect(await connection.switchOn(schoolId)).toMatchObject({
          ok: false,
          code: "invalid_state",
        });
        expect(await connection.enable(schoolId)).toMatchObject({
          ok: false,
          code: "invalid_state",
        });
      } finally {
        finishRelease();
      }
      expect(await first).toMatchObject({
        ok: true,
        connection: { state: "released" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("does not restore Live if Meta no longer confirms the school card", async () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "97".repeat(32));
    try {
      const { connection, schoolId, removeCard } = await liveConnection();
      await connection.switchOff(schoolId);
      removeCard();
      expect(await connection.switchOn(schoolId)).toMatchObject({
        ok: true,
        connection: { state: "needs-card" },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("releases only at the deadline, deregisters before carrier release and buys a fresh allocation afterwards", async () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "97".repeat(32));
    try {
      const { connection, schoolId, released, setTime } =
        await liveConnection();
      const live = await connection.read(schoolId);
      const identity = { channel: "whatsapp", waId: "12125550197" } as const;
      const history = await findOrCreateConversation({
        schoolId,
        identity,
        now: new Date("2026-10-12T10:00:00Z"),
      });
      if (!history.ok) throw new Error("Missing conversation");
      await appendMessage({
        conversationId: history.conversation.id,
        messageId: "old-message",
        role: "user",
        parts: [{ type: "text", text: "A past enquiry" }],
      });
      await connection.switchOff(schoolId);
      expect(await connection.release(schoolId)).toMatchObject({
        ok: false,
        code: "invalid_state",
      });
      expect(released).toEqual([]);
      setTime("2026-11-11T10:00:00Z");
      expect(await connection.switchOn(schoolId)).toMatchObject({
        ok: false,
        code: "invalid_state",
      });
      expect(await connection.release(schoolId)).toMatchObject({
        ok: true,
        connection: { state: "released", phoneNumberId: null, number: null },
      });
      expect(released).toEqual([live.phoneNumberId, live.providerResourceId]);
      expect(await connection.release(schoolId)).toMatchObject({
        ok: false,
        code: "invalid_state",
      });
      expect(await connection.enable(schoolId)).toMatchObject({
        ok: true,
        connection: { state: "popup", number: "+12125550102", releaseAt: null },
      });
      expect((await connection.read(schoolId)).allocationId).not.toBe(
        live.allocationId,
      );
      expect((await loadTranscript(history.conversation.id))[0].parts).toEqual([
        { type: "text", text: "A past enquiry" },
      ]);
      expect(
        await findConversation({
          schoolId,
          identity,
          now: new Date("2026-10-12T10:01:00Z"),
        }),
      ).toMatchObject({ schoolId });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("switches off for thirty days and restores the same Live number before release", async () => {
    vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "97".repeat(32));
    try {
      const { connection, schoolId, released, setTime } =
        await liveConnection();
      const live = await connection.read(schoolId);
      expect(await connection.switchOff(schoolId)).toMatchObject({
        ok: true,
        connection: {
          state: "cooling",
          number: live.number,
          releaseAt: new Date("2026-11-11T10:00:00Z"),
        },
      });
      setTime("2026-11-10T10:00:00Z");
      expect(await connection.switchOn(schoolId)).toMatchObject({
        ok: true,
        connection: {
          state: "live",
          number: live.number,
          allocationId: live.allocationId,
          releaseAt: null,
        },
      });
      expect(released).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
