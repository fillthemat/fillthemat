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
import type { WhatsAppSendOutcome } from "./client";
import { enqueueWhatsAppDelivery } from "./deliveries";
import type { WhatsAppWorkerDependencies } from "./dependencies";
import { runWhatsAppWorkerOnce as runScopedWorker } from "./worker";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const phoneNumberId = `in-run-${randomUUID()}`;
const { runWhatsAppWorkerOnce } = scopedWhatsAppRunner(() => [phoneNumberId]);
const start = new Date("1890-01-01T12:00:00Z");
const jobIds: string[] = [];
let schoolId: string;
let fixtureOrder = 0;

beforeAll(async () => {
  const school = await seedSchool(sql, {
    ownerId,
    name: "In-run Retry School",
    slug: phoneNumberId,
    whatsappPhoneNumberId: phoneNumberId,
    offerings: [{ name: "Kids BJJ" }],
  });
  schoolId = school.schoolId;
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (schoolId)
    await db
      .delete(whatsappDeliveries)
      .where(eq(whatsappDeliveries.schoolId, schoolId));
  if (jobIds.length)
    await db.delete(whatsappJobs).where(inArray(whatsappJobs.id, jobIds));
  jobIds.length = 0;
});
afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

function fakeRun(send: () => Promise<WhatsAppSendOutcome>) {
  let clock = start.getTime();
  const sleeps: number[] = [];
  const dependencies: WhatsAppWorkerDependencies = {
    now: () => new Date(clock),
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
    transport: { sendText: send, sendTemplate: send, sendInteractive: send },
  };
  return {
    dependencies,
    sleeps,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

async function insertDelivery() {
  const id = await enqueueWhatsAppDelivery(
    {
      schoolId,
      phoneNumberId,
      recipientWaId: "16505550085",
      providerIdempotencyKey: randomUUID(),
      body: "Hello",
      windowExpiresAt: new Date(start.getTime() + 86_400_000),
    },
    start,
  );
  if (!id) throw new Error("delivery not inserted");
  await db
    .update(whatsappDeliveries)
    .set({ createdAt: new Date(start.getTime() + fixtureOrder++) })
    .where(eq(whatsappDeliveries.id, id));
  return id;
}

async function insertJob(waId = randomUUID()) {
  const wamid = randomUUID();
  const [job] = await db
    .insert(whatsappJobs)
    .values({
      phoneNumberId,
      dedupeKey: wamid,
      kind: "inbound_message",
      nextAttemptAt: start,
      payload: {
        wamid,
        waId,
        phoneNumberId,
        text: "What trials are available?",
        profileName: null,
      },
    })
    .returning();
  jobIds.push(job.id);
  return job;
}

async function readDelivery(id: string) {
  const [row] = await db
    .select()
    .from(whatsappDeliveries)
    .where(eq(whatsappDeliveries.id, id));
  return row;
}

describe("bounded in-run WhatsApp retries", () => {
  it("does not claim or recover another phone number's work, including earlier retries", async () => {
    const foreignPhone = `foreign-${randomUUID()}`;
    const [foreign] = await db
      .insert(whatsappJobs)
      .values({
        phoneNumberId: foreignPhone,
        dedupeKey: randomUUID(),
        kind: "inbound_message",
        payload: { text: "" },
        attempts: 2,
        nextAttemptAt: start,
        createdAt: new Date(start.getTime() - 10_000),
      })
      .returning();
    jobIds.push(foreign.id);
    const [foreignClaim, foreignFuture] = await db
      .insert(whatsappJobs)
      .values([
        {
          phoneNumberId: foreignPhone,
          dedupeKey: randomUUID(),
          kind: "inbound_message",
          payload: { text: "" },
          state: "claimed",
          attempts: 5,
          claimedBy: "foreign-worker",
          claimedAt: new Date(start.getTime() - 600_000),
          nextAttemptAt: start,
        },
        {
          phoneNumberId: foreignPhone,
          dedupeKey: randomUUID(),
          kind: "inbound_message",
          payload: { text: "" },
          state: "failed",
          attempts: 1,
          nextAttemptAt: new Date(start.getTime() + 10_000),
        },
      ])
      .returning();
    jobIds.push(foreignClaim.id, foreignFuture.id);
    const [foreignDelivery, foreignRetry] = await db
      .insert(whatsappDeliveries)
      .values([
        {
          schoolId,
          phoneNumberId: foreignPhone,
          recipientWaId: "foreign",
          providerIdempotencyKey: randomUUID(),
          state: "claimed",
          attempts: 5,
          claimedBy: "foreign-worker",
          claimedAt: new Date(start.getTime() - 600_000),
          nextAttemptAt: start,
        },
        {
          schoolId,
          phoneNumberId: foreignPhone,
          recipientWaId: "foreign",
          providerIdempotencyKey: randomUUID(),
          state: "failed",
          attempts: 1,
          nextAttemptAt: new Date(start.getTime() + 10_000),
        },
      ])
      .returning();
    const id = await insertDelivery();
    const fake = fakeRun(async () => ({
      ok: true,
      kind: "accepted",
      providerId: randomUUID(),
    }));
    const result = await runScopedWorker(randomUUID(), {
      ...fake.dependencies,
      phoneNumberIds: [phoneNumberId],
    });
    expect(result.jobs.claimed).toBe(0);
    expect(result.jobs.dead).toBe(0);
    expect(result.deliveries.claimed).toBe(1);
    expect(result.deliveries.dead).toBe(0);
    expect(await readDelivery(id)).toMatchObject({
      state: "sent",
      attempts: 1,
    });
    expect(
      (
        await db
          .select()
          .from(whatsappJobs)
          .where(eq(whatsappJobs.id, foreign.id))
      )[0],
    ).toMatchObject({ state: "pending", attempts: 2, claimedBy: null });
    const untouchedJobs = await db
      .select()
      .from(whatsappJobs)
      .where(inArray(whatsappJobs.id, [foreignClaim.id, foreignFuture.id]));
    expect(
      untouchedJobs.find((row) => row.id === foreignClaim.id),
    ).toMatchObject({
      state: "claimed",
      attempts: 5,
      claimedBy: "foreign-worker",
    });
    expect(
      untouchedJobs.find((row) => row.id === foreignFuture.id),
    ).toMatchObject({ state: "failed", attempts: 1 });
    expect(await readDelivery(foreignDelivery.id)).toMatchObject({
      state: "claimed",
      attempts: 5,
      claimedBy: "foreign-worker",
    });
    expect(await readDelivery(foreignRetry.id)).toMatchObject({
      state: "failed",
      attempts: 1,
    });
    expect(fake.sleeps).toEqual([]);
  });
  it("delivers in one run after two transient failures with 10s and 20s waits", async () => {
    const id = await insertDelivery();
    let executions = 0;
    const fake = fakeRun(async () => {
      executions += 1;
      return executions <= 2
        ? { ok: false, kind: "network_error", message: "temporary outage" }
        : { ok: true, kind: "accepted", providerId: `accepted-${id}` };
    });
    const result = await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
    expect(await readDelivery(id)).toMatchObject({
      state: "sent",
      attempts: 3,
      providerId: `accepted-${id}`,
    });
    expect(fake.sleeps).toEqual([10_000, 20_000]);
    expect(result.deliveries).toEqual({
      claimed: 3,
      sent: 1,
      retrying: 2,
      dead: 0,
      deferred: 0,
    });
  });
  it("exhausts transient sends after five executions in one run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await insertDelivery();
    const fake = fakeRun(async () => ({
      ok: false,
      kind: "network_error",
      message: "outage",
    }));
    const result = await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
    expect(await readDelivery(id)).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
    });
    expect(fake.sleeps).toEqual([10_000, 20_000, 40_000, 80_000]);
    expect(result.deliveries).toEqual({
      claimed: 5,
      sent: 0,
      retrying: 4,
      dead: 1,
      deferred: 0,
    });
  });
  it("retries the delivery created by an inline assistant reply without repeating the job", async () => {
    const job = await insertJob();
    let calls = 0;
    const fake = fakeRun(async () => {
      calls += 1;
      return calls <= 2
        ? { ok: false, kind: "network_error", message: "outage" }
        : { ok: true, kind: "accepted", providerId: `inline-${job.id}` };
    });
    const result = await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
    const [row] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.id, job.id));
    expect(row).toMatchObject({ state: "done", attempts: 1 });
    const deliveries = await db
      .select()
      .from(whatsappDeliveries)
      .where(eq(whatsappDeliveries.schoolId, schoolId));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      state: "sent",
      attempts: 3,
      providerId: `inline-${job.id}`,
    });
    expect(fake.sleeps).toEqual([10_000, 20_000]);
    expect(result.jobs.done).toBe(1);
    // Inline attempts retain their existing separate accounting.
    expect(result.deliveries).toEqual({
      claimed: 2,
      sent: 1,
      retrying: 1,
      dead: 0,
      deferred: 0,
    });
  });
  it("leaves failures beyond the remaining budget for the next cron run without resetting the count", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await insertDelivery();
    const fake = fakeRun(async () => {
      fake.advance(70_000);
      return { ok: false, kind: "network_error", message: "slow outage" };
    });
    const result = await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
    expect(fake.dependencies.now()).toEqual(new Date("1890-01-01T12:04:00Z"));
    expect(fake.sleeps).toEqual([10_000, 20_000]);
    expect(result.deliveries.claimed).toBe(3);
    expect(await readDelivery(id)).toMatchObject({
      state: "failed",
      attempts: 3,
      nextAttemptAt: new Date("1890-01-01T12:04:40Z"),
    });
    fake.advance(86_400_000);
    // Templates, unlike free-form replies, remain eligible on the next day.
    await db
      .update(whatsappDeliveries)
      .set({ templateName: "booking_confirmation", templateParams: [] })
      .where(eq(whatsappDeliveries.id, id));
    const cron = fakeRun(async () => ({
      ok: false,
      kind: "network_error",
      message: "outage",
    }));
    cron.advance(fake.dependencies.now().getTime() - start.getTime());
    const continued = await runWhatsAppWorkerOnce(
      randomUUID(),
      cron.dependencies,
    );
    expect(await readDelivery(id)).toMatchObject({
      state: "dead",
      attempts: 5,
    });
    expect(continued.deliveries.claimed).toBe(2);
    expect(cron.sleeps).toEqual([80_000]);
  });
  it("ends immediately when only fresh future work or retries at/after the deadline exist", async () => {
    const fresh = await insertDelivery();
    const retry = await insertDelivery();
    await db
      .update(whatsappDeliveries)
      .set({ nextAttemptAt: new Date(start.getTime() + 1000) })
      .where(eq(whatsappDeliveries.id, fresh));
    await db
      .update(whatsappDeliveries)
      .set({
        attempts: 1,
        state: "failed",
        nextAttemptAt: new Date(start.getTime() + 240_000),
      })
      .where(eq(whatsappDeliveries.id, retry));
    const fake = fakeRun(async () => {
      throw new Error("nothing eligible");
    });
    const result = await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
    expect(fake.sleeps).toEqual([]);
    expect(result.deliveries.claimed).toBe(0);
    expect(fake.dependencies.now()).toEqual(start);
  });
  it("does not claim fresh arrivals during the retry-only tail", async () => {
    const id = await insertDelivery();
    let freshId: string | undefined;
    let calls = 0;
    const fake = fakeRun(async () => {
      calls += 1;
      if (calls === 1) {
        freshId = await insertDelivery();
        return { ok: false, kind: "network_error", message: "outage" };
      }
      return { ok: true, kind: "accepted", providerId: `accepted-${id}` };
    });
    await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
    expect(calls).toBe(2);
    if (!freshId) throw new Error("fresh arrival not inserted");
    expect(await readDelivery(freshId)).toMatchObject({
      state: "pending",
      attempts: 0,
      claimedAt: null,
    });
    expect(fake.sleeps).toEqual([10_000]);
  });
  it("rechecks the deadline after a late timer without claiming the retry", async () => {
    const id = await insertDelivery();
    const fake = fakeRun(async () => ({
      ok: false,
      kind: "network_error",
      message: "outage",
    }));
    fake.dependencies.sleep = async () => {
      fake.advance(240_000);
    };
    const result = await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
    expect(result.deliveries.claimed).toBe(1);
    expect(await readDelivery(id)).toMatchObject({
      state: "failed",
      attempts: 1,
      claimedAt: null,
    });
  });
  it("releases unstarted batch claims when fresh work uses the run budget", async () => {
    const first = await insertDelivery();
    const second = await insertDelivery();
    const retry = await insertDelivery();
    await db
      .update(whatsappDeliveries)
      .set({
        attempts: 2,
        state: "failed",
        failureReason: "network_error",
        lastError: "previous outage",
      })
      .where(eq(whatsappDeliveries.id, retry));
    let calls = 0;
    const fake = fakeRun(async () => {
      calls += 1;
      fake.advance(240_000);
      return { ok: false, kind: "network_error", message: "slow outage" };
    });
    const result = await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
    expect(calls).toBe(1);
    expect(await readDelivery(first)).toMatchObject({
      state: "failed",
      attempts: 1,
      claimedAt: null,
    });
    expect(await readDelivery(second)).toMatchObject({
      state: "pending",
      attempts: 0,
      claimedAt: null,
    });
    expect(await readDelivery(retry)).toMatchObject({
      state: "failed",
      attempts: 2,
      failureReason: "network_error",
      lastError: "previous outage",
      nextAttemptAt: start,
      claimedAt: null,
    });
    expect(result.deliveries.deferred).toBe(2);
    expect(fake.sleeps).toEqual([]);
  });
  it("releases unstarted jobs and skips the delivery sweep when a job uses the budget", async () => {
    const first = await insertJob();
    const second = await insertJob();
    await db
      .update(whatsappJobs)
      .set({ createdAt: start })
      .where(eq(whatsappJobs.id, first.id));
    await db
      .update(whatsappJobs)
      .set({ createdAt: new Date(start.getTime() + 1) })
      .where(eq(whatsappJobs.id, second.id));
    const deliveryId = await insertDelivery();
    let calls = 0;
    const fake = fakeRun(async () => {
      calls += 1;
      fake.advance(240_000);
      return { ok: true, kind: "accepted", providerId: `slow-${first.id}` };
    });
    const result = await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
    expect(calls).toBe(1);
    const rows = await db
      .select()
      .from(whatsappJobs)
      .where(inArray(whatsappJobs.id, [first.id, second.id]));
    expect(rows.find((row) => row.id === first.id)).toMatchObject({
      state: "done",
      attempts: 1,
      claimedAt: null,
    });
    expect(rows.find((row) => row.id === second.id)).toMatchObject({
      state: "pending",
      attempts: 0,
      claimedAt: null,
    });
    expect(await readDelivery(deliveryId)).toMatchObject({
      state: "pending",
      attempts: 0,
      claimedAt: null,
    });
    expect(result.jobs.deferred).toBe(1);
    expect(result.deliveries.claimed).toBe(0);
  });
  it("retries transient job failures on the same policy clock until five executions", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const waId = randomUUID();
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId },
      now: start,
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    const job = await insertJob(waId);
    const fake = fakeRun(async () => {
      throw new Error("no reply after storage failure");
    });
    let result: Awaited<ReturnType<typeof runWhatsAppWorkerOnce>> | undefined;
    await whileSavingMessages(
      sql,
      {
        conversationId: conversation.conversation.id,
        role: "user",
        statement: "raise exception 'temporary storage outage'",
      },
      async () => {
        result = await runWhatsAppWorkerOnce(randomUUID(), fake.dependencies);
      },
    );
    const [row] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.id, job.id));
    expect(row).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
    });
    expect(fake.sleeps).toEqual([10_000, 20_000, 40_000, 80_000]);
    expect(result?.jobs).toEqual({
      claimed: 5,
      done: 0,
      retrying: 4,
      dead: 1,
      deferred: 0,
    });
  });
});
