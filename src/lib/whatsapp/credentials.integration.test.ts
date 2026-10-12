import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import { getDb } from "@/db";
import { schools, whatsappJobs } from "@/db/schema";
import { getOwnedSchool } from "@/lib/auth/current-school";
import { getSchoolBySlug } from "@/lib/schools/public";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { post, textInboundPayload } from "@/test/whatsapp-webhook";
import { scopedWhatsAppRunner } from "@/test/whatsapp-worker";
import { encryptWhatsAppToken } from "./credentials";
import { enqueueWhatsAppDelivery } from "./deliveries";
import { enqueueInboundJobs } from "./jobs";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const suffix = randomUUID();
const ownerIds = [randomUUID(), randomUUID()];
const phoneNumberIds = [`credentials-a-${suffix}`, `credentials-b-${suffix}`];
const schoolIds: string[] = [];
const now = new Date("2020-01-01T12:00:00Z");
const { runWhatsAppWorkerOnce, drainDueWhatsAppDeliveries } =
  scopedWhatsAppRunner(() => phoneNumberIds);

beforeAll(async () => {
  vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "11".repeat(32));
  vi.stubEnv("WHATSAPP_SYSTEM_USER_TOKEN", "shared-token");
  for (const [index, ownerId] of ownerIds.entries()) {
    const { schoolId } = await seedSchool(sql, {
      ownerId,
      name: `Credential School ${index}`,
      slug: `cred-${index}-${suffix}`,
      whatsappPhoneNumberId: phoneNumberIds[index],
      offerings: [{ name: "Kids BJJ" }],
    });
    schoolIds.push(schoolId);
    await db
      .update(schools)
      .set({
        whatsappTokenEncrypted: encryptWhatsAppToken(
          schoolId,
          `school-${index}-token`,
        ),
        whatsappTokenExpiresAt: new Date("2099-02-01T12:00:00Z"),
      })
      .where(eq(schools.id, schoolId));
  }
});
afterAll(async () => {
  await db
    .delete(whatsappJobs)
    .where(inArray(whatsappJobs.phoneNumberId, phoneNumberIds));
  for (const ownerId of ownerIds) await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
  vi.unstubAllEnvs();
});

describe("school-scoped WhatsApp sends", () => {
  it("keeps credential ciphertext and expiry out of page-facing school readers", async () => {
    const owned = await getOwnedSchool(ownerIds[0]);
    const publicDetails = await getSchoolBySlug(`cred-0-${suffix}`);
    for (const school of [owned, publicDetails]) {
      expect(school?.id).toBe(schoolIds[0]);
      expect(school).not.toHaveProperty("whatsappTokenEncrypted");
      expect(school).not.toHaveProperty("whatsappTokenExpiresAt");
      expect(school).not.toHaveProperty("whatsappRegistrationPinEncrypted");
      expect(school).not.toHaveProperty("whatsappVerificationCode");
      expect(school).not.toHaveProperty("whatsappVerificationExpiresAt");
      expect(school).not.toHaveProperty("whatsappVerificationMessageIds");
    }
  });
  it("marks school A's inbound message read/typing using A's credential", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ success: true });
    });
    try {
      const response = await POST(
        post(
          textInboundPayload({
            phoneNumberId: phoneNumberIds[0],
            waId: "16505550002",
            wamid: `wamid.typing.${suffix}`,
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(requests).toEqual([
        {
          url: `https://graph.facebook.com/v26.0/${phoneNumberIds[0]}/messages`,
          authorization: "Bearer school-0-token",
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
      await db
        .delete(whatsappJobs)
        .where(eq(whatsappJobs.dedupeKey, `wamid.typing.${suffix}`));
    }
  });
  it("answers school A's inbound message with A's token, never school B's", async () => {
    const wamid = `wamid.credentials.${suffix}`;
    await enqueueInboundJobs([
      {
        wamid,
        waId: "16505550001",
        phoneNumberId: phoneNumberIds[0],
        text: "What trials are available?",
        profileName: null,
      },
    ]);
    await db
      .update(whatsappJobs)
      .set({ nextAttemptAt: now })
      .where(eq(whatsappJobs.dedupeKey, wamid));
    const sends: Array<{
      phoneNumberId: string;
      token?: string | null;
      text: string;
    }> = [];
    const result = await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => now,
      transport: {
        sendText: async (input) => {
          sends.push(input);
          return {
            ok: true,
            kind: "accepted",
            providerId: `fake:${randomUUID()}`,
          };
        },
        sendTemplate: async () => {
          throw new Error("unexpected template");
        },
        sendInteractive: async () => {
          throw new Error("unexpected interactive");
        },
      },
    });
    const [job] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    expect(job.lastError).toBeNull();
    expect(result.jobs.done).toBe(1);
    expect(sends).toEqual([
      expect.objectContaining({
        phoneNumberId: phoneNumberIds[0],
        token: "school-0-token",
        text: "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.",
      }),
    ]);
  });
  it.each(["text", "template", "interactive"])(
    "passes the school's credential for queued %s sends, with the shared fallback for legacy schools",
    async (type) => {
      await db
        .update(schools)
        .set({ whatsappTokenEncrypted: null, whatsappTokenExpiresAt: null })
        .where(eq(schools.id, schoolIds[1]));
      for (const [index, schoolId] of schoolIds.entries()) {
        await enqueueWhatsAppDelivery(
          {
            schoolId,
            phoneNumberId: phoneNumberIds[index],
            recipientWaId: "16505550003",
            providerIdempotencyKey: `credential-${type}-${index}-${suffix}`,
            body: "Hello",
            templateName: type === "template" ? "booking_confirmation" : null,
            interactiveButtons:
              type === "interactive" ? [{ id: "yes", title: "Yes" }] : null,
            windowExpiresAt: new Date("2020-01-02T12:00:00Z"),
          },
          { now },
        );
      }
      const sends: Array<{ phoneNumberId: string; token?: string | null }> = [];
      const send = async (input: {
        phoneNumberId: string;
        token?: string | null;
      }) => {
        sends.push(input);
        return {
          ok: true as const,
          kind: "accepted" as const,
          providerId: `fake:${randomUUID()}`,
        };
      };
      const result = await drainDueWhatsAppDeliveries(randomUUID(), 25, {
        now: () => now,
        transport: {
          sendText: send,
          sendTemplate: send,
          sendInteractive: send,
        },
      });
      expect(result.sent).toBe(2);
      expect(sends).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phoneNumberId: phoneNumberIds[0],
            token: "school-0-token",
          }),
          expect.objectContaining({
            phoneNumberId: phoneNumberIds[1],
            token: "shared-token",
          }),
        ]),
      );
    },
  );
  it.each(["expired", "other-school", "corrupt", "missing-key"])(
    "never falls back to shared access when a school credential is %s",
    async (failure) => {
      await db
        .update(schools)
        .set({
          whatsappConnectionState: "live",
          whatsappTokenEncrypted:
            failure === "corrupt"
              ? "not-a-ciphertext"
              : encryptWhatsAppToken(
                  failure === "other-school" ? schoolIds[0] : schoolIds[1],
                  "school-1-token",
                ),
          whatsappTokenExpiresAt:
            failure === "expired" ? now : new Date("2099-01-01T00:00:00Z"),
        })
        .where(eq(schools.id, schoolIds[1]));
      if (failure === "missing-key")
        vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "");
      await enqueueWhatsAppDelivery(
        {
          schoolId: schoolIds[1],
          phoneNumberId: phoneNumberIds[1],
          recipientWaId: "16505550004",
          providerIdempotencyKey: `credential-invalid-${failure}-${suffix}`,
          body: "Hello",
          windowExpiresAt: new Date("2020-01-02T12:00:00Z"),
        },
        { now },
      );
      const send = vi.fn(async () => ({
        ok: true as const,
        kind: "accepted" as const,
        providerId: "must-not-send",
      }));
      try {
        const result = await drainDueWhatsAppDeliveries(randomUUID(), 25, {
          now: () => now,
          transport: {
            sendText: send,
            sendTemplate: send,
            sendInteractive: send,
          },
        });
        expect(send).not.toHaveBeenCalled();
        expect(result.retrying).toBe(1);
      } finally {
        vi.stubEnv("WHATSAPP_TOKEN_ENCRYPTION_KEY", "11".repeat(32));
      }
    },
  );
});
