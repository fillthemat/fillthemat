import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "@/db";
import { whatsappDeliveries, whatsappJobs } from "@/db/schema";
import { findOrCreateConversation } from "@/lib/conversations/conversation-store";
import {
  authSql,
  loadLocalEnv,
  whileSavingMessages,
} from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { scopedWhatsAppRunner } from "@/test/whatsapp-worker";
import type { WhatsAppTransport } from "./dependencies";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const phoneNumberId = `job-fallback-${randomUUID()}`;
const { runWhatsAppWorkerOnce } = scopedWhatsAppRunner(() => [phoneNumberId]);
const receivedAt = new Date("1987-01-01T12:00:00Z");
const jobIds: string[] = [];
let schoolId: string;

beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "Job Fallback School",
    slug: `fallback-${randomUUID().slice(0, 8)}`,
    whatsappPhoneNumberId: phoneNumberId,
    offerings: [{ name: "Kids BJJ" }],
  });
  schoolId = seeded.schoolId;
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (jobIds.length)
    await db.delete(whatsappJobs).where(inArray(whatsappJobs.id, jobIds));
  jobIds.length = 0;
  await db
    .delete(whatsappDeliveries)
    .where(eq(whatsappDeliveries.schoolId, schoolId));
});
afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

async function insertJob(
  values: Partial<typeof whatsappJobs.$inferInsert> = {},
) {
  const wamid = randomUUID();
  const [job] = await db
    .insert(whatsappJobs)
    .values({
      schoolId,
      phoneNumberId,
      dedupeKey: wamid,
      kind: "inbound_message",
      createdAt: receivedAt,
      nextAttemptAt: receivedAt,
      payload: {
        wamid,
        waId: randomUUID(),
        phoneNumberId,
        text: "Hello",
        profileName: null,
      },
      ...values,
    })
    .returning();
  jobIds.push(job.id);
  return job;
}

async function deliveries() {
  return db
    .select()
    .from(whatsappDeliveries)
    .where(eq(whatsappDeliveries.schoolId, schoolId));
}

function recordingTransport(
  sent: Parameters<WhatsAppTransport["sendText"]>[0][],
): WhatsAppTransport {
  return {
    sendText: async (input) => {
      sent.push(input);
      return { ok: true, kind: "accepted", providerId: randomUUID() };
    },
    sendTemplate: async () => {
      throw new Error("unexpected template");
    },
    sendInteractive: async () => {
      throw new Error("unexpected interactive");
    },
  };
}

describe("prospect apology after WhatsApp job exhaustion", () => {
  it("does not extend the window from another prospect, another school number, or a future receipt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await insertJob({ attempts: 5 });
    const clock = new Date("1987-01-02T12:00:10Z");
    await insertJob({ state: "done", createdAt: clock });
    await insertJob({
      state: "done",
      createdAt: clock,
      phoneNumberId: "another-school-number",
      payload: job.payload,
    });
    await insertJob({
      state: "done",
      createdAt: new Date("1987-01-03T12:00:10Z"),
      payload: job.payload,
    });
    const sent: Parameters<WhatsAppTransport["sendText"]>[0][] = [];
    await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => clock,
      transport: recordingTransport(sent),
    });
    expect(sent).toEqual([]);
    expect(await deliveries()).toEqual([]);
  });

  it("uses a newer inbound from the same prospect to recognize an open conversation window", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await insertJob({ attempts: 5 });
    const clock = new Date("1987-01-02T12:00:10Z");
    await insertJob({
      state: "done",
      createdAt: new Date("1987-01-02T12:00:09Z"),
      payload: job.payload,
    });
    const sent: Parameters<WhatsAppTransport["sendText"]>[0][] = [];
    await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => clock,
      transport: recordingTransport(sent),
    });
    expect(sent).toHaveLength(1);
    const [fallback] = await deliveries();
    expect(fallback.windowExpiresAt).toEqual(new Date("1987-01-03T12:00:09Z"));
  });

  it("does not reset or replace an existing apology delivery for the same job", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await insertJob({ attempts: 5 });
    await db.insert(whatsappDeliveries).values({
      schoolId,
      phoneNumberId,
      recipientWaId: "existing-recipient",
      providerIdempotencyKey: `job-fallback/${job.id}`,
      body: "existing apology",
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
      nextAttemptAt: receivedAt,
    });
    const sent: Parameters<WhatsAppTransport["sendText"]>[0][] = [];
    await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => receivedAt,
      transport: recordingTransport(sent),
    });
    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: "dead",
      attempts: 5,
      body: "existing apology",
    });
    expect(sent).toEqual([]);
  });

  it("keeps an exhausted claim recoverable if saving its apology fails, then commits both together", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await insertJob({
      state: "claimed",
      attempts: 5,
      claimedAt: receivedAt,
      claimedBy: "crashed",
    });
    const clock = new Date("1987-01-01T12:06:00Z");
    const sent: Parameters<WhatsAppTransport["sendText"]>[0][] = [];
    const overrides = { now: () => clock, transport: recordingTransport(sent) };
    const name = `test_fallback_save_${randomUUID().replaceAll("-", "")}`;
    await sql.unsafe(
      `create function public.${name}() returns trigger language plpgsql as $$ begin raise exception 'temporary apology storage outage'; end $$`,
    );
    try {
      await sql.unsafe(
        `create trigger ${name} before insert on app.whatsapp_deliveries for each row when (new.provider_idempotency_key = 'job-fallback/${job.id}') execute function public.${name}()`,
      );
      try {
        await expect(
          runWhatsAppWorkerOnce(randomUUID(), overrides),
        ).rejects.toThrow();
        const [row] = await db
          .select()
          .from(whatsappJobs)
          .where(eq(whatsappJobs.id, job.id));
        expect(row).toMatchObject({
          state: "claimed",
          attempts: 5,
          terminalCause: null,
        });
        expect(await deliveries()).toEqual([]);
        expect(log.mock.calls).toEqual([]);
      } finally {
        await sql.unsafe(`drop trigger ${name} on app.whatsapp_deliveries`);
      }
    } finally {
      await sql.unsafe(`drop function public.${name}()`);
    }
    const result = await runWhatsAppWorkerOnce(randomUUID(), overrides);
    expect(result.jobs.dead).toBe(1);
    expect(sent).toHaveLength(1);
    expect(await deliveries()).toHaveLength(1);
    expect(log.mock.calls).toHaveLength(1);
  });

  it("caps a failing apology at five sends with no second fallback or sixth send", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await insertJob({ attempts: 5, failureReason: "whatsapp_job_failed" });
    let clock = receivedAt;
    const sent: Parameters<WhatsAppTransport["sendText"]>[0][] = [];
    const transport = recordingTransport(sent);
    transport.sendText = async (input) => {
      sent.push(input);
      return { ok: false, kind: "network_error", message: "temporary outage" };
    };
    const result = await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => clock,
      sleep: async (milliseconds) => {
        clock = new Date(clock.getTime() + milliseconds);
      },
      transport,
    });
    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attempts: 5,
      state: "dead",
      terminalCause: "attempts_exhausted",
    });
    expect(result.deliveries.dead).toBe(1);
    await runWhatsAppWorkerOnce(randomUUID(), { now: () => clock, transport });
    expect(sent).toHaveLength(5);
    expect(await deliveries()).toHaveLength(1);
  });

  it("sends one apology when recovery exhausts a crashed fifth execution, including before School resolution was saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await insertJob({
      schoolId: null,
      state: "claimed",
      attempts: 5,
      claimedAt: receivedAt,
      claimedBy: "crashed",
    });
    const clock = new Date("1987-01-01T12:06:00Z");
    const sent: Parameters<WhatsAppTransport["sendText"]>[0][] = [];
    const overrides = { now: () => clock, transport: recordingTransport(sent) };
    const runs = await Promise.all([
      runWhatsAppWorkerOnce(randomUUID(), overrides),
      runWhatsAppWorkerOnce(randomUUID(), overrides),
    ]);
    expect(runs.reduce((total, run) => total + run.jobs.dead, 0)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(await deliveries()).toHaveLength(1);
    const [row] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.id, job.id));
    expect(row).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
      claimedAt: null,
      claimedBy: null,
    });
    await runWhatsAppWorkerOnce(randomUUID(), overrides);
    expect(sent).toHaveLength(1);
  });

  it.each(["1987-01-02T12:00:00Z", "1987-01-02T12:00:01Z"])(
    "sends no apology at or after the service-window deadline (%s), even with an active 30-day conversation",
    async (time) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const job = await insertJob({
        attempts: 5,
        failureReason: "whatsapp_job_failed",
      });
      const payload = job.payload as { waId: string };
      await findOrCreateConversation({
        schoolId,
        identity: { channel: "whatsapp", waId: payload.waId },
        now: receivedAt,
      });
      const sent: Parameters<WhatsAppTransport["sendText"]>[0][] = [];
      const result = await runWhatsAppWorkerOnce(randomUUID(), {
        now: () => new Date(time),
        transport: recordingTransport(sent),
      });
      expect(result.jobs.dead).toBe(1);
      expect(sent).toEqual([]);
      expect(await deliveries()).toEqual([]);
    },
  );

  it("sends no apology for a permanent unknown-number job even at the execution limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await insertJob({
      attempts: 5,
      failureReason: "unknown_phone_number",
    });
    const sent: Parameters<WhatsAppTransport["sendText"]>[0][] = [];
    const result = await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => receivedAt,
      transport: recordingTransport(sent),
    });
    const [row] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.id, job.id));
    expect(row).toMatchObject({
      state: "dead",
      terminalCause: "permanent",
      attempts: 5,
    });
    expect(result.jobs.dead).toBe(1);
    expect(sent).toEqual([]);
    expect(await deliveries()).toEqual([]);
  });

  it("sends exactly one fixed plain-text apology after five transient executions, never reprocessing the dead job", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await insertJob();
    const payload = job.payload as { waId: string };
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId: payload.waId },
      now: receivedAt,
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    const sent: Parameters<WhatsAppTransport["sendText"]>[0][] = [];
    const transport = recordingTransport(sent);
    let clock = receivedAt;
    await whileSavingMessages(
      sql,
      {
        conversationId: conversation.conversation.id,
        role: "user",
        statement: "raise exception 'temporary storage outage'",
      },
      async () => {
        const result = await runWhatsAppWorkerOnce(randomUUID(), {
          now: () => clock,
          sleep: async (milliseconds) => {
            expect(sent).toEqual([]);
            clock = new Date(clock.getTime() + milliseconds);
          },
          transport,
        });
        const [row] = await db
          .select()
          .from(whatsappJobs)
          .where(eq(whatsappJobs.id, job.id));
        expect(row).toMatchObject({ attempts: 5, state: "dead" });
        expect(result.jobs).toMatchObject({ claimed: 5, retrying: 4, dead: 1 });
      },
    );
    expect(sent).toEqual([
      {
        to: payload.waId,
        phoneNumberId,
        text: "Sorry, we're having trouble replying right now. Please message us again in a bit.",
      },
    ]);
    const [fallback] = await deliveries();
    expect(fallback).toMatchObject({
      state: "sent",
      attempts: 1,
      templateName: null,
      interactiveButtons: null,
      providerIdempotencyKey: `job-fallback/${job.id}`,
      windowExpiresAt: new Date("1987-01-02T12:00:00Z"),
    });
    await runWhatsAppWorkerOnce(randomUUID(), { now: () => clock, transport });
    expect(sent).toHaveLength(1);
    expect(await deliveries()).toHaveLength(1);
  });
});
