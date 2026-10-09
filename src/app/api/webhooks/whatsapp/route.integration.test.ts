import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  conversations,
  messages,
  schools,
  users,
  whatsappDeliveries,
  whatsappJobs,
} from "@/db/schema";
import { hashWaId } from "@/lib/crypto";
import { MAX_CHAT_MESSAGES_PER_CONVERSATION } from "@/lib/security/limits";
import {
  WHATSAPP_MAX_BODY_BYTES,
  WHATSAPP_STUB_VERIFY_TOKEN,
} from "@/lib/whatsapp/config";
import { drainDueWhatsAppDeliveries } from "@/lib/whatsapp/deliveries";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import { post, sign, textInboundPayload } from "@/test/whatsapp-webhook";
import { GET, POST } from "./route";

loadLocalEnv();

const db = getDb();
const sql = authSql();
const suffix = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const phoneNumberId = `199${Date.now().toString().slice(-9)}`;
const slug = `wa-${suffix}`;
const waId = "16505551234";
let schoolId = "";

function inboundPayload() {
  // wamids are globally unique in production; use a per-run id so the global
  // `whatsapp_jobs.dedupe_key` uniqueness never collides across test runs.
  return textInboundPayload({
    phoneNumberId,
    waId,
    wamid: `wamid.p4.${suffix}`,
  });
}

async function jobCount() {
  const rows = await db.select().from(whatsappJobs);
  return rows.filter((row) => row.phoneNumberId === phoneNumberId).length;
}

async function messageRows() {
  return db
    .select({ id: messages.id, role: messages.role })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.schoolId, schoolId));
}

async function deliveryRows() {
  return db
    .select()
    .from(whatsappDeliveries)
    .where(eq(whatsappDeliveries.schoolId, schoolId));
}

async function runWorker() {
  // Make this fixture's jobs due explicitly: the shared DB clock can run
  // slightly ahead of Node, so a default now() is not always due immediately.
  await db
    .update(whatsappJobs)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(
      and(
        eq(whatsappJobs.phoneNumberId, phoneNumberId),
        eq(whatsappJobs.state, "pending"),
      ),
    );
  const runId = randomUUID();
  await runWhatsAppWorkerOnce(runId);
  await db
    .update(whatsappDeliveries)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(
      and(
        eq(whatsappDeliveries.schoolId, schoolId),
        eq(whatsappDeliveries.state, "pending"),
      ),
    );
  await drainDueWhatsAppDeliveries(runId);
}

async function conversationForWa(id: string) {
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, schoolId),
        eq(conversations.waIdHash, hashWaId(id)),
        isNull(conversations.endedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

beforeAll(async () => {
  await insertAuthUser(sql, ownerId, `wa-${suffix}@local.test`);
  await db.insert(users).values({
    id: ownerId,
    email: `wa-${suffix}@local.test`,
    name: "WA Owner",
  });
  const [school] = await db
    .insert(schools)
    .values({
      ownerUserId: ownerId,
      name: "WhatsApp School",
      slug,
      timezone: "America/New_York",
      notificationEmail: `wa-${suffix}@local.test`,
      whatsappPhoneNumberId: phoneNumberId,
      approvedAt: new Date(),
    })
    .returning({ id: schools.id });
  if (!school) throw new Error("failed to seed school");
  schoolId = school.id;
});

afterAll(async () => {
  await db
    .delete(whatsappJobs)
    .where(eq(whatsappJobs.phoneNumberId, phoneNumberId));
  await db.delete(users).where(eq(users.id, ownerId));
  await deleteAuthUser(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("POST /api/webhooks/whatsapp (enqueue-then-ack)", () => {
  it("enqueues a job instead of persisting inline", async () => {
    const response = await POST(post(inboundPayload()));
    expect(response.status).toBe(200);
    expect(await jobCount()).toBe(1);
    expect(await messageRows()).toHaveLength(0);
  });

  it("dedupes a replayed wamid to a single job row", async () => {
    await POST(post(inboundPayload()));
    expect(await jobCount()).toBe(1);
  });

  it("rejects a wrong signature with 401", async () => {
    const response = await POST(post(inboundPayload(), "wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("rejects an oversized body with 413", async () => {
    const body = "x".repeat(WHATSAPP_MAX_BODY_BYTES + 1);
    const request = new Request("http://127.0.0.1:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body),
      },
      body,
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
  });
});

describe("worker + status flow", () => {
  it("runs the agent to completion and advances delivery pending→claimed→sent", async () => {
    await runWorker();

    const rows = await messageRows();
    const userRows = rows.filter((row) => row.role === "user");
    const assistantRows = rows.filter((row) => row.role === "assistant");
    expect(userRows).toHaveLength(1);
    // With no Gateway token the assistant replies via its scripted local model.
    expect(assistantRows).toHaveLength(1);

    const deliveries = await deliveryRows();
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    expect(deliveries[0].state).toBe("sent");
    expect(deliveries[0].providerId).toMatch(/^local-noop:/);

    const conversation = await conversationForWa(waId);
    expect(conversation).toBeTruthy();
    expect(conversation?.generatingAt).toBeNull();
  });

  it("applies a delivered status and ignores an older out-of-order status", async () => {
    const [delivery] = await deliveryRows();
    expect(delivery).toBeTruthy();

    const statusPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "test-waba",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: phoneNumberId },
                statuses: [
                  {
                    id: delivery?.providerId,
                    status: "delivered",
                    timestamp: "1700000000",
                    recipient_id: waId,
                  },
                  {
                    id: delivery?.providerId,
                    status: "read",
                    timestamp: "1600000000",
                    recipient_id: waId,
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect((await POST(post(statusPayload))).status).toBe(200);

    const [updated] = await deliveryRows();
    expect(updated.state).toBe("delivered");
  });

  it("does not double-write on a replayed wamid after processing", async () => {
    const before = await messageRows();
    await POST(post(inboundPayload()));
    expect(await jobCount()).toBe(1);
    await runWorker();
    const after = await messageRows();
    expect(after.length).toBe(before.length);
  });
});

describe("conversation invariants survive enqueue-then-ack", () => {
  function inboundFor(wa: string, wamid: string, body?: string) {
    return textInboundPayload({ phoneNumberId, waId: wa, wamid, text: body });
  }

  async function conversationMessages(conversationId: string) {
    return db
      .select({ id: messages.id, role: messages.role })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.id));
  }

  it("routes a second distinct message from the same wa_id into one conversation", async () => {
    const id = "16505551111";
    expect(
      (await POST(post(inboundFor(id, `wamid.inv-a.${suffix}`, "Hello"))))
        .status,
    ).toBe(200);
    expect(
      (await POST(post(inboundFor(id, `wamid.inv-b.${suffix}`, "What times?"))))
        .status,
    ).toBe(200);

    await runWorker();

    const conversation = requireRow(
      await conversationForWa(id),
      "conversation",
    );
    const rows = await conversationMessages(conversation.id);
    expect(rows.filter((row) => row.role === "user")).toHaveLength(2);
    expect(rows.filter((row) => row.role === "assistant")).toHaveLength(2);
    expect(conversation.generatingAt).toBeNull();
  });

  it("starts a new conversation after inactivity and keeps the old transcript", async () => {
    const id = "16505550062";
    expect(
      (await POST(post(inboundFor(id, `wamid.inactive-a.${suffix}`, "Hello"))))
        .status,
    ).toBe(200);
    await runWorker();
    const original = requireRow(await conversationForWa(id), "conversation");
    const originalMessages = await conversationMessages(original.id);
    await db
      .update(conversations)
      .set({ expiresAt: addDays(new Date(), -1) })
      .where(eq(conversations.id, original.id));
    expect(
      (
        await POST(
          post(inboundFor(id, `wamid.inactive-b.${suffix}`, "Hello again")),
        )
      ).status,
    ).toBe(200);
    await runWorker();
    const current = requireRow(
      await conversationForWa(id),
      "current conversation",
    );
    expect(current.id).not.toBe(original.id);
    expect(current.generatingAt).toBeNull();
    expect(await conversationMessages(current.id)).toHaveLength(2);
    expect(await conversationMessages(original.id)).toEqual(originalMessages);
    const [ended] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, original.id));
    expect(ended?.endedAt).toBeInstanceOf(Date);
    expect(ended?.endReason).toBe("inactivity");
  });

  it("reschedules while generatingAt is held, then completes on release", async () => {
    const id = "16505552222";
    expect(
      (await POST(post(inboundFor(id, `wamid.lock-a.${suffix}`)))).status,
    ).toBe(200);
    await runWorker();

    const conversation = requireRow(
      await conversationForWa(id),
      "conversation",
    );
    const before = await conversationMessages(conversation.id);

    // Simulate a concurrent worker mid-flight by holding the single-flight lock.
    await db
      .update(conversations)
      .set({ generatingAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));

    expect(
      (await POST(post(inboundFor(id, `wamid.lock-b.${suffix}`)))).status,
    ).toBe(200);
    await runWorker();

    const jobs = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.phoneNumberId, phoneNumberId));
    const deferred = requireRow(
      jobs.find((job) => job.dedupeKey === `wamid.lock-b.${suffix}`),
      "deferred job",
    );
    // Deferred, not failed/dropped, and nothing was double-written.
    expect(deferred.state).toBe("pending");
    expect(await conversationMessages(conversation.id)).toHaveLength(
      before.length,
    );

    // Release the lock and make the deferred job due again; it then completes.
    await db
      .update(conversations)
      .set({ generatingAt: null, updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
    await db
      .update(whatsappJobs)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(whatsappJobs.id, deferred.id));
    await runWorker();

    const after = await conversationMessages(conversation.id);
    expect(after).toHaveLength(before.length + 2);
    expect(
      requireRow(await conversationForWa(id), "conversation").generatingAt,
    ).toBeNull();
  });

  it.each(["question", "confirmation"] as const)(
    "ends a conversation at its message limit on a %s with an unsaved notice, then answers the next message in a new conversation",
    async (kind) => {
      const id = kind === "question" ? "16505553333" : "16505553334";
      const capSuffix = `${suffix}-${kind}`;
      expect(
        (await POST(post(inboundFor(id, `wamid.cap-seed.${capSuffix}`))))
          .status,
      ).toBe(200);
      await runWorker();

      const conversation = requireRow(
        await conversationForWa(id),
        "conversation",
      );
      const existing = await conversationMessages(conversation.id);
      const fill = MAX_CHAT_MESSAGES_PER_CONVERSATION - existing.length;

      if (fill > 0) {
        await db.insert(messages).values(
          Array.from({ length: fill }, (_, index) => ({
            conversationId: conversation.id,
            messageId: `wamid.cap-fill-${index}.${capSuffix}`,
            role: "user" as const,
            parts: [{ type: "text", text: `fill ${index}` }],
            completion: "complete" as const,
            purgeAt: addDays(new Date(), 30),
          })),
        );
      }

      const before = await conversationMessages(conversation.id);
      expect(
        (
          await POST(
            post(
              inboundFor(
                id,
                `wamid.cap-over.${capSuffix}`,
                kind === "confirmation"
                  ? `confirm_booking:${randomUUID()}`
                  : "Hello?",
              ),
            ),
          )
        ).status,
      ).toBe(200);
      await runWorker();

      expect(await conversationMessages(conversation.id)).toEqual(before);
      const [ended] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversation.id));
      expect(ended?.endedAt).toBeInstanceOf(Date);
      expect(ended?.endReason).toBe("message_limit");
      expect(ended?.generatingAt).toBeNull();
      expect(await conversationForWa(id)).toBeUndefined();
      const [notice] = await db
        .select()
        .from(whatsappDeliveries)
        .where(
          eq(
            whatsappDeliveries.providerIdempotencyKey,
            `wa-notice/${id}/wamid.cap-over.${capSuffix}`,
          ),
        );
      expect(notice?.body).toBe(
        "This conversation has reached its message limit. Your next message starts a fresh conversation.",
      );
      expect(notice?.state).toBe("sent");

      expect(
        (
          await POST(
            post(inboundFor(id, `wamid.cap-next.${capSuffix}`, "Hello again")),
          )
        ).status,
      ).toBe(200);
      await runWorker();
      const current = requireRow(
        await conversationForWa(id),
        "new conversation",
      );
      expect(current.id).not.toBe(conversation.id);
      expect(current.generatingAt).toBeNull();
      const currentMessages = await conversationMessages(current.id);
      expect(
        currentMessages.filter(({ role }) => role === "user"),
      ).toHaveLength(1);
      expect(
        currentMessages.filter(({ role }) => role === "assistant"),
      ).toHaveLength(1);
      expect(await conversationMessages(conversation.id)).toEqual(before);
      const deliveries = await db
        .select()
        .from(whatsappDeliveries)
        .where(
          and(
            eq(whatsappDeliveries.schoolId, schoolId),
            eq(whatsappDeliveries.recipientWaId, id),
          ),
        );
      expect(deliveries).toHaveLength(3);
      expect(deliveries.every(({ state }) => state === "sent")).toBe(true);
    },
  );

  it("answers the next inbound message after an abandoned generation lock", async () => {
    const id = "16505554444";
    expect(
      (await POST(post(inboundFor(id, `wamid.abandoned-a.${suffix}`)))).status,
    ).toBe(200);
    await runWorker();
    const conversation = requireRow(
      await conversationForWa(id),
      "conversation",
    );
    const before = await conversationMessages(conversation.id);

    // A crashed function left its claim behind eleven minutes ago.
    await db
      .update(conversations)
      .set({ generatingAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(conversations.id, conversation.id));
    const wamid = `wamid.abandoned-b.${suffix}`;
    expect(
      (await POST(post(inboundFor(id, wamid, "Can I try a class?")))).status,
    ).toBe(200);
    await runWorker();

    const after = await conversationMessages(conversation.id);
    expect(after.filter((row) => row.role === "user")).toHaveLength(
      before.filter((row) => row.role === "user").length + 1,
    );
    expect(after.filter((row) => row.role === "assistant")).toHaveLength(
      before.filter((row) => row.role === "assistant").length + 1,
    );
    expect(
      requireRow(await conversationForWa(id), "conversation").generatingAt,
    ).toBeNull();
    const [job] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    expect(job?.state).toBe("done");
    const deliveries = await db
      .select()
      .from(whatsappDeliveries)
      .where(
        and(
          eq(whatsappDeliveries.schoolId, schoolId),
          eq(whatsappDeliveries.recipientWaId, id),
        ),
      );
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((delivery) => delivery.state === "sent")).toBe(
      true,
    );
  });
});

describe("GET /api/webhooks/whatsapp", () => {
  it("echoes the challenge as text/plain for a matching verify token", async () => {
    const url = new URL("http://127.0.0.1:3000/api/webhooks/whatsapp");
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", WHATSAPP_STUB_VERIFY_TOKEN);
    url.searchParams.set("hub.challenge", "challenge-123");
    const response = await GET(new Request(url.toString()));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("challenge-123");
  });

  it("rejects a mismatched verify token with 403", async () => {
    const url = new URL("http://127.0.0.1:3000/api/webhooks/whatsapp");
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", "wrong-token");
    url.searchParams.set("hub.challenge", "challenge-123");
    const response = await GET(new Request(url.toString()));
    expect(response.status).toBe(403);
  });
});
