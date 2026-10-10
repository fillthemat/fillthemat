import { randomUUID } from "node:crypto";
import { eq, type SQL, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { whatsappJobs } from "@/db/schema";
import { loadLocalEnv, requireRow } from "@/test/integration-env";
import {
  claimDueWhatsAppJobs,
  enqueueInboundJobs,
  failJob,
  rescheduleJob,
} from "./jobs";

loadLocalEnv();
const db = getDb();
const phoneNumberId = randomUUID();

async function insertJob(
  input: Pick<typeof whatsappJobs.$inferInsert, "state"> & {
    nextAttemptAt?: Date | SQL;
  } = {},
) {
  const [row] = await db
    .insert(whatsappJobs)
    .values({
      phoneNumberId,
      dedupeKey: randomUUID(),
      payload: {},
      ...input,
    })
    .returning();
  return requireRow(row, "job");
}

function skewServerClock(time: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(time));
}

function sortedIds(rows: { id: string }[]) {
  return rows.map(({ id }) => id).sort();
}

afterEach(async () => {
  vi.useRealTimers();
  await db
    .delete(whatsappJobs)
    .where(eq(whatsappJobs.phoneNumberId, phoneNumberId));
});

it("scopes claims to the requested IDs, including an empty list", async () => {
  const target = await insertJob();
  const excluded = await insertJob();
  const ids = [target.id];
  expect(await claimDueWhatsAppJobs(randomUUID(), { ids: [] })).toEqual([]);
  expect(sortedIds(await claimDueWhatsAppJobs(randomUUID(), { ids }))).toEqual(
    ids,
  );
  const [untouched] = await db
    .select()
    .from(whatsappJobs)
    .where(eq(whatsappJobs.id, excluded.id));
  expect(untouched?.state).toBe("pending");
  expect(untouched?.claimedBy).toBeNull();
});

describe.each([
  ["behind", "2000-01-01T00:00:00Z"],
  ["ahead", "2100-01-01T00:00:00Z"],
])("claiming with the server clock %s the database", (_skew, serverTime) => {
  it("schedules failed jobs' retries from the database clock", async () => {
    const job = await insertJob();
    skewServerClock(serverTime);
    await failJob(job.id, 0, "retry me");
    const [retry] = await db
      .select({
        attempts: whatsappJobs.attempts,
        dueAt: whatsappJobs.nextAttemptAt,
        remainingMs:
          sql<number>`extract(epoch from (${whatsappJobs.nextAttemptAt} - now())) * 1000`.mapWith(
            Number,
          ),
      })
      .from(whatsappJobs)
      .where(eq(whatsappJobs.id, job.id));
    expect(retry?.attempts).toBe(1);
    expect(retry?.dueAt).toBeInstanceOf(Date);
    expect(retry?.remainingMs).toBeGreaterThan(55_000);
    expect(retry?.remainingMs).toBeLessThanOrEqual(60_000);
    expect(await claimDueWhatsAppJobs(randomUUID(), { ids: [job.id] })).toEqual(
      [],
    );
  });

  it("reschedules busy jobs two seconds after the database's current time", async () => {
    const job = await insertJob({ state: "claimed" });
    skewServerClock(serverTime);
    await rescheduleJob(job.id, 2000);
    const [retry] = await db
      .select({
        state: whatsappJobs.state,
        claimedBy: whatsappJobs.claimedBy,
        claimedAt: whatsappJobs.claimedAt,
        remainingMs:
          sql<number>`extract(epoch from (${whatsappJobs.nextAttemptAt} - now())) * 1000`.mapWith(
            Number,
          ),
      })
      .from(whatsappJobs)
      .where(eq(whatsappJobs.id, job.id));
    expect(retry?.state).toBe("pending");
    expect(retry?.claimedBy).toBeNull();
    expect(retry?.claimedAt).toBeNull();
    expect(retry?.remainingMs).toBeGreaterThan(0);
    expect(retry?.remainingMs).toBeLessThanOrEqual(2000);
    expect(await claimDueWhatsAppJobs(randomUUID(), { ids: [job.id] })).toEqual(
      [],
    );
  });

  it("claims a freshly enqueued inbound job immediately", async () => {
    skewServerClock(serverTime);
    const wamid = randomUUID();
    expect(
      await enqueueInboundJobs([
        {
          phoneNumberId,
          wamid,
          waId: "16505550101",
          text: "Hello",
          profileName: null,
        },
      ]),
    ).toBe(1);
    const [job] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    const ids = [requireRow(job, "enqueued job").id];
    expect(
      sortedIds(await claimDueWhatsAppJobs(randomUUID(), { ids })),
    ).toEqual(ids);
  });

  it("claims database-due jobs, but not future retries or completed jobs", async () => {
    const pendingDue = await insertJob();
    const retryDue = await insertJob({ state: "failed" });
    const futureRetry = await insertJob({
      state: "failed",
      nextAttemptAt: sql`now() + interval '1 day'`,
    });
    const completed = await insertJob({ state: "done" });
    const ids = sortedIds([pendingDue, retryDue, futureRetry, completed]);
    skewServerClock(serverTime);
    expect(
      sortedIds(await claimDueWhatsAppJobs(randomUUID(), { ids })),
    ).toEqual(sortedIds([pendingDue, retryDue]));
    expect(await claimDueWhatsAppJobs(randomUUID(), { ids })).toEqual([]);
  });
});
