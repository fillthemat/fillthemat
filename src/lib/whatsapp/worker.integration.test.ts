import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { conversations, whatsappDeliveries, whatsappJobs } from "@/db/schema";
import { findOrCreateConversation } from "@/lib/conversations/conversation-store";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import {
  sendWhatsAppInteractive,
  sendWhatsAppTemplate,
  sendWhatsAppText,
} from "./client";
import {
  attemptWhatsAppDeliveriesNow,
  enqueueWhatsAppDelivery,
} from "./deliveries";
import { enqueueInboundJobs } from "./jobs";
import { runWhatsAppWorkerOnce } from "./worker";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const suffix = randomUUID();
const phoneNumberId = `worker-${suffix}`;
// Historical time keeps these runs from claiming other worktrees' due rows.
const now = new Date("2020-01-01T12:00:00Z");
let schoolId: string;

beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "Worker School",
    slug: `worker-${suffix}`,
    whatsappPhoneNumberId: phoneNumberId,
    offerings: [{ name: "Kids BJJ" }],
  });
  schoolId = seeded.schoolId;
});
afterAll(async () => {
  await db
    .delete(whatsappJobs)
    .where(eq(whatsappJobs.phoneNumberId, phoneNumberId));
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("WhatsApp worker dependencies", () => {
  it("stops an unknown phone number after one execution and never claims it again", async () => {
    const dedupeKey = `unknown/${suffix}`;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const [job] = await db
      .insert(whatsappJobs)
      .values({
        phoneNumberId,
        dedupeKey,
        kind: "inbound_message",
        nextAttemptAt: now,
        payload: {
          wamid: dedupeKey,
          phoneNumberId: `unmapped-${suffix}`,
          waId: "16505550006",
          text: "Hello",
          profileName: null,
        },
      })
      .returning();
    const runId = randomUUID();
    const result = await runWhatsAppWorkerOnce(runId, {
      now: () => new Date(now),
    });
    const [failed] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.id, job.id));
    expect(failed).toMatchObject({
      state: "dead",
      attempts: 1,
      failureReason: "unknown_phone_number",
      terminalCause: "permanent",
      lastError: "unknown_phone_number",
      claimedAt: null,
      claimedBy: null,
      dedupeKey,
    });
    expect(result.jobs).toEqual({
      claimed: 1,
      done: 0,
      retrying: 0,
      dead: 1,
      deferred: 0,
    });
    const again = await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => new Date(now),
    });
    expect(again.jobs.claimed).toBe(0);
    expect(log.mock.calls).toEqual([
      [
        JSON.stringify({
          event: "queue.dead",
          queue: "whatsapp_job",
          id: job.id,
          schoolId: null,
          reason: "unknown_phone_number",
          terminalCause: "permanent",
          executions: 1,
          runId,
        }),
      ],
    ]);
    log.mockRestore();
  });
  it("recovers only claims older than five minutes on the injected clock", async () => {
    const freshAt = new Date("2020-01-01T11:59:00Z");
    const staleAt = new Date("2020-01-01T11:54:00Z");
    const dueLater = new Date("2020-01-02T12:00:00Z");
    const jobs = await db
      .insert(whatsappJobs)
      .values(
        [freshAt, staleAt].map((claimedAt, index) => ({
          phoneNumberId,
          dedupeKey: `recovery/${index}/${suffix}`,
          kind: "inbound_message",
          payload: {},
          state: "claimed" as const,
          claimedAt,
          claimedBy: "old-worker",
          nextAttemptAt: dueLater,
        })),
      )
      .returning({ id: whatsappJobs.id });
    const deliveries = await db
      .insert(whatsappDeliveries)
      .values(
        [freshAt, staleAt].map((claimedAt, index) => ({
          schoolId,
          phoneNumberId,
          recipientWaId: "16505550005",
          providerIdempotencyKey: `recovery/${index}/${suffix}`,
          state: "claimed" as const,
          claimedAt,
          claimedBy: "old-worker",
          nextAttemptAt: dueLater,
        })),
      )
      .returning({ id: whatsappDeliveries.id });
    await runWhatsAppWorkerOnce(randomUUID(), { now: () => new Date(now) });
    for (const [table, ids] of [
      [whatsappJobs, jobs.map((row) => row.id)],
      [whatsappDeliveries, deliveries.map((row) => row.id)],
    ] as const) {
      const rows = await db
        .select({
          id: table.id,
          state: table.state,
          claimedAt: table.claimedAt,
        })
        .from(table)
        .where(inArray(table.id, ids));
      expect(rows.find((row) => row.id === ids[0])).toMatchObject({
        state: "claimed",
        claimedAt: freshAt,
      });
      expect(rows.find((row) => row.id === ids[1])).toMatchObject({
        state: "pending",
        claimedAt: null,
      });
    }
  });
  it("uses injected pauses while a conversation is busy and defers against the advanced clock", async () => {
    const waId = "16505550004";
    const wamid = `wamid.busy.${suffix}`;
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId },
      now,
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    await db
      .update(conversations)
      .set({ generatingAt: now })
      .where(eq(conversations.id, conversation.conversation.id));
    await enqueueInboundJobs([
      { wamid, waId, phoneNumberId, text: "Hello", profileName: null },
    ]);
    await db
      .update(whatsappJobs)
      .set({ nextAttemptAt: now })
      .where(eq(whatsappJobs.dedupeKey, wamid));
    let elapsed = 0;
    const result = await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => new Date(now.getTime() + elapsed),
      sleep: async (milliseconds) => {
        elapsed += milliseconds;
      },
      transport: {
        sendText: async () => {
          throw new Error("busy conversation must not send");
        },
        sendTemplate: async () => {
          throw new Error("busy conversation must not send");
        },
        sendInteractive: async () => {
          throw new Error("busy conversation must not send");
        },
      },
    });
    expect(result.jobs).toEqual({
      claimed: 1,
      done: 0,
      retrying: 0,
      dead: 0,
      deferred: 1,
    });
    const [job] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    expect({
      elapsed,
      state: job.state,
      attempts: job.attempts,
      nextAttemptAt: job.nextAttemptAt,
    }).toEqual({
      elapsed: 3000,
      state: "pending",
      attempts: 0,
      nextAttemptAt: new Date("2020-01-01T12:00:05Z"),
    });
  });
  it.each(["http", "text", "template", "interactive"])(
    "records %s response failures with the shared short backoff on the injected clock",
    async (type) => {
      const id = await enqueueWhatsAppDelivery(
        {
          schoolId,
          phoneNumberId,
          recipientWaId: "16505550003",
          body: "Hello",
          templateName: type === "template" ? "booking_confirmation" : null,
          interactiveButtons:
            type === "interactive"
              ? [{ id: "confirm", title: "Confirm" }]
              : null,
          windowExpiresAt: new Date("2020-01-02T12:00:00Z"),
          providerIdempotencyKey: `${type}/${suffix}`,
        },
        now,
      );
      if (!id) throw new Error("failed to enqueue test delivery");
      const graph = {
        token: "test-token",
        localNoop: false,
        fetch: async () =>
          type === "http"
            ? new Response("Unavailable", { status: 503 })
            : Response.json({ success: true }),
      };
      await attemptWhatsAppDeliveriesNow([id], randomUUID(), {
        now: () => new Date(now),
        sleep: async () => {
          throw new Error("unexpected retry pause");
        },
        transport: {
          sendText: (input) => sendWhatsAppText(input, graph),
          sendTemplate: (input) => sendWhatsAppTemplate(input, graph),
          sendInteractive: (input) => sendWhatsAppInteractive(input, graph),
        },
      });
      const [row] = await db
        .select()
        .from(whatsappDeliveries)
        .where(eq(whatsappDeliveries.id, id));
      expect({
        state: row.state,
        attempts: row.attempts,
        providerId: row.providerId,
        sentAt: row.sentAt,
        nextAttemptAt: row.nextAttemptAt,
        lastError: row.lastError,
      }).toEqual({
        state: "failed",
        attempts: 1,
        providerId: null,
        sentAt: null,
        nextAttemptAt: new Date("2020-01-01T12:00:10Z"),
        lastError:
          type === "http" ? "graph_http_503" : "graph_missing_message_id",
      });
      await db.delete(whatsappDeliveries).where(eq(whatsappDeliveries.id, id));
    },
  );
  it("uses the fake sender and clock for an inline assistant reply and the delivery sweep", async () => {
    const wamid = `wamid.worker.${suffix}`;
    await enqueueInboundJobs([
      {
        wamid,
        waId: "16505550001",
        phoneNumberId,
        text: "What trials are available?",
        profileName: null,
      },
    ]);
    await db
      .update(whatsappJobs)
      .set({ nextAttemptAt: now })
      .where(eq(whatsappJobs.dedupeKey, wamid));
    const sweepId = await enqueueWhatsAppDelivery({
      schoolId,
      phoneNumberId,
      recipientWaId: "16505550002",
      body: "Sweep reply",
      windowExpiresAt: new Date("2020-01-02T12:00:00Z"),
      providerIdempotencyKey: `sweep/${suffix}`,
    });
    if (!sweepId) throw new Error("failed to enqueue sweep delivery");
    await db
      .update(whatsappDeliveries)
      .set({ nextAttemptAt: now })
      .where(eq(whatsappDeliveries.id, sweepId));
    const sent: string[] = [];
    const sendText = async (input: Parameters<typeof sendWhatsAppText>[0]) => {
      if (input.text !== "Sweep reply") {
        const [executing] = await db
          .select()
          .from(whatsappJobs)
          .where(eq(whatsappJobs.dedupeKey, wamid));
        expect(executing).toMatchObject({ state: "claimed", attempts: 1 });
      }
      sent.push(input.text);
      return {
        ok: true as const,
        kind: "accepted" as const,
        providerId: `fake:${randomUUID()}`,
      };
    };
    const result = await runWhatsAppWorkerOnce(randomUUID(), {
      transport: {
        sendText,
        sendTemplate: async () => {
          throw new Error("unexpected template");
        },
        sendInteractive: async () => {
          throw new Error("unexpected interactive");
        },
      },
      now: () => new Date(now),
      sleep: async () => {
        throw new Error("unexpected pause");
      },
    });
    expect(result).toEqual({
      jobs: { claimed: 1, done: 1, retrying: 0, dead: 0, deferred: 0 },
      deliveries: { claimed: 1, sent: 1, retrying: 0, dead: 0, deferred: 0 },
    });
    expect(sent).toEqual(
      expect.arrayContaining([
        "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.",
        "Sweep reply",
      ]),
    );
    const rows = await db
      .select()
      .from(whatsappDeliveries)
      .where(
        and(
          eq(whatsappDeliveries.schoolId, schoolId),
          eq(whatsappDeliveries.state, "sent"),
        ),
      );
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (row) =>
          row.state === "sent" &&
          row.attempts === 1 &&
          row.providerId?.startsWith("fake:") &&
          row.sentAt?.getTime() === now.getTime(),
      ),
    ).toBe(true);
  });
});
