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
import { whatsappJobs } from "@/db/schema";
import { findOrCreateConversation } from "@/lib/conversations/conversation-store";
import {
  authSql,
  loadLocalEnv,
  whileSavingMessages,
} from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { scopedWhatsAppRunner } from "@/test/whatsapp-worker";
import {
  claimDueWhatsAppJobs,
  failJob,
  markJobDone,
  recoverStuckWhatsAppJobs,
  rescheduleJob,
  startJobExecution,
} from "./jobs";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const phoneNumberId = `job-retry-${randomUUID()}`;
const { drainWhatsAppJobs, runWhatsAppWorkerOnce } = scopedWhatsAppRunner(
  () => [phoneNumberId],
);
const now = new Date("1990-01-01T12:00:00Z");
const ids: string[] = [];
let schoolId: string;
beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "Job Retry School",
    slug: phoneNumberId,
    whatsappPhoneNumberId: phoneNumberId,
    offerings: [{ name: "Kids BJJ" }],
  });
  schoolId = seeded.schoolId;
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (ids.length)
    await db.delete(whatsappJobs).where(inArray(whatsappJobs.id, ids));
  ids.length = 0;
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
      phoneNumberId,
      dedupeKey: wamid,
      kind: "inbound_message",
      nextAttemptAt: now,
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
  ids.push(job.id);
  return job;
}
async function readJob(id: string) {
  const [job] = await db
    .select()
    .from(whatsappJobs)
    .where(eq(whatsappJobs.id, id));
  return job;
}

describe("bounded WhatsApp job executions", () => {
  it("allows a fifth successful execution but gives a legacy exhausted job no sixth execution", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const successful = await insertJob({ attempts: 4, payload: { text: "" } });
    const exhausted = await insertJob({
      attempts: 5,
      lastError: "previous failure",
      payload: { text: "" },
    });
    const result = await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => now,
    });
    expect(await readJob(successful.id)).toMatchObject({
      state: "done",
      attempts: 5,
    });
    expect(await readJob(exhausted.id)).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
      lastError: "previous failure",
    });
    expect(result.jobs).toEqual({
      claimed: 2,
      done: 1,
      retrying: 0,
      dead: 1,
      deferred: 0,
    });
  });
  it("persists each started execution and exhausts transient failures on the fifth across claim batches", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const waId = randomUUID();
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId },
      now,
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    const wamid = randomUUID();
    const job = await insertJob({
      payload: {
        wamid,
        waId,
        phoneNumberId,
        text: "Private inbound message",
        profileName: null,
      },
    });
    let clock = new Date(now);
    await whileSavingMessages(
      sql,
      {
        conversationId: conversation.conversation.id,
        role: "user",
        statement:
          "raise exception 'temporary storage outage with private details'",
      },
      async () => {
        const retryTimes = ["12:00:10", "12:00:30", "12:01:10", "12:02:30"];
        for (let execution = 1; execution <= 5; execution++) {
          const result = await drainWhatsAppJobs(randomUUID(), 10, {
            now: () => clock,
            transport: {
              sendText: async () => {
                throw new Error("must not send after storage failure");
              },
              sendTemplate: async () => {
                throw new Error("unexpected template");
              },
              sendInteractive: async () => {
                throw new Error("unexpected interactive");
              },
            },
          });
          const row = await readJob(job.id);
          expect(row).toMatchObject({
            attempts: execution,
            schoolId,
            state: execution === 5 ? "dead" : "failed",
            failureReason: "whatsapp_job_failed",
            terminalCause: execution === 5 ? "attempts_exhausted" : null,
            claimedAt: null,
            claimedBy: null,
          });
          expect(result).toEqual({
            claimed: 1,
            done: 0,
            retrying: execution === 5 ? 0 : 1,
            dead: execution === 5 ? 1 : 0,
            deferred: 0,
          });
          if (execution < 5) {
            expect(row.nextAttemptAt).toEqual(
              new Date(`1990-01-01T${retryTimes[execution - 1]}Z`),
            );
            const beforeDue = await drainWhatsAppJobs(randomUUID(), 10, {
              now: () => clock,
            });
            expect(beforeDue.claimed).toBe(0);
            clock = row.nextAttemptAt;
          }
        }
      },
    );
    const after = await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => new Date("1990-01-02T12:00:00Z"),
    });
    expect(after.jobs.claimed).toBe(0);
    expect(log.mock.calls).toHaveLength(1);
    expect(log.mock.calls[0][0]).not.toMatch(/Private|165055|storage|details/);
  });

  it("fences every old-owner write after recovery and reclaim, even with a reused run id", async () => {
    const job = await insertJob();
    const [claim] = await claimDueWhatsAppJobs("reused-run", {
      now,
      limit: 1,
      phoneNumberIds: [phoneNumberId],
    });
    const execution = await startJobExecution(claim, schoolId, now);
    if (!execution) throw new Error("execution not reserved");
    expect(await readJob(job.id)).toMatchObject({
      state: "claimed",
      attempts: 1,
    });
    const later = new Date("1990-01-01T12:06:00Z");
    // Recover and immediately claim the same job with the same run identifier.
    await recoverStuckWhatsAppJobs(undefined, later, "recovery-run", [
      phoneNumberId,
    ]);
    const [newClaim] = await claimDueWhatsAppJobs("reused-run", {
      phoneNumberIds: [phoneNumberId],
      now: later,
      limit: 1,
    });
    expect(newClaim.attempts).toBe(1);
    expect(await markJobDone(execution, schoolId, later)).toBe(false);
    expect(
      await failJob(
        execution,
        { kind: "internal", reason: "school_missing" },
        "private error",
        later,
      ),
    ).toBe("deferred");
    await rescheduleJob(execution, 2000, later);
    expect(await startJobExecution(execution, schoolId, later)).toBeNull();
    expect(await readJob(job.id)).toMatchObject({
      state: "claimed",
      attempts: 1,
      claimedBy: "reused-run",
      claimedAt: later,
      terminalCause: null,
    });
    const final = await startJobExecution(newClaim, schoolId, later);
    if (!final) throw new Error("new execution not reserved");
    expect(await markJobDone(final, schoolId, later)).toBe(true);
    expect(await readJob(job.id)).toMatchObject({
      state: "done",
      attempts: 2,
      claimedAt: null,
      claimedBy: null,
    });
  });
  it("keeps a crashed execution's count and stops recovery at the cap exactly once", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const claimedAt = new Date("1990-01-01T11:54:00Z");
    const retry = await insertJob({
      state: "claimed",
      attempts: 4,
      claimedAt,
      claimedBy: "crashed",
      nextAttemptAt: new Date("1990-01-02T12:00:00Z"),
    });
    const exhausted = await insertJob({
      schoolId,
      state: "claimed",
      attempts: 5,
      claimedAt,
      claimedBy: "crashed",
      lastError: "Original failure with private message and 16505550001",
      failureReason: "whatsapp_job_failed",
    });
    const runId = randomUUID();
    const result = await runWhatsAppWorkerOnce(runId, { now: () => now });
    expect(await readJob(retry.id)).toMatchObject({
      state: "pending",
      attempts: 4,
      claimedAt: null,
      claimedBy: null,
    });
    expect(await readJob(exhausted.id)).toMatchObject({
      state: "dead",
      attempts: 5,
      claimedAt: null,
      claimedBy: null,
      terminalCause: "attempts_exhausted",
      failureReason: "whatsapp_job_failed",
      lastError: exhausted.lastError,
      payload: exhausted.payload,
      dedupeKey: exhausted.dedupeKey,
    });
    expect(result.jobs).toEqual({
      claimed: 0,
      done: 0,
      retrying: 0,
      dead: 1,
      deferred: 0,
    });
    await runWhatsAppWorkerOnce(randomUUID(), { now: () => now });
    expect(log.mock.calls).toEqual([
      [
        JSON.stringify({
          event: "queue.dead",
          queue: "whatsapp_job",
          id: exhausted.id,
          schoolId,
          reason: "whatsapp_job_failed",
          terminalCause: "attempts_exhausted",
          executions: 5,
          runId,
        }),
      ],
    ]);
  });
});
