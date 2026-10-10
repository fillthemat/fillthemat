import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { whatsappDeliveries, whatsappJobs } from "@/db/schema";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { claimDueWhatsAppDeliveries } from "./deliveries";
import { claimDueWhatsAppJobs } from "./jobs";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const phoneNumberId = `claim-lanes-${randomUUID()}`;
// Fixed time for deterministic due gates; every claim is explicitly scoped.
const now = new Date("1901-01-01T12:00:00Z");
const jobIds: string[] = [];
const deliveryIds: string[] = [];
let schoolId: string;

beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "Claim Lanes School",
    slug: phoneNumberId,
    whatsappPhoneNumberId: phoneNumberId,
    offerings: [{ name: "Kids BJJ" }],
  });
  schoolId = seeded.schoolId;
});
afterEach(async () => {
  if (jobIds.length)
    await db.delete(whatsappJobs).where(inArray(whatsappJobs.id, jobIds));
  if (deliveryIds.length)
    await db
      .delete(whatsappDeliveries)
      .where(inArray(whatsappDeliveries.id, deliveryIds));
  jobIds.length = 0;
  deliveryIds.length = 0;
});
afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

async function job(values: Partial<typeof whatsappJobs.$inferInsert> = {}) {
  const [row] = await db
    .insert(whatsappJobs)
    .values({
      phoneNumberId,
      dedupeKey: randomUUID(),
      kind: "inbound_message",
      payload: { text: "Hello" },
      createdAt: now,
      nextAttemptAt: now,
      ...values,
    })
    .returning();
  jobIds.push(row.id);
  return row;
}

async function delivery(
  values: Partial<typeof whatsappDeliveries.$inferInsert> = {},
) {
  const [row] = await db
    .insert(whatsappDeliveries)
    .values({
      schoolId,
      phoneNumberId,
      recipientWaId: randomUUID(),
      providerIdempotencyKey: randomUUID(),
      createdAt: now,
      nextAttemptAt: now,
      ...values,
    })
    .returning();
  deliveryIds.push(row.id);
  return row;
}

const queues = [
  {
    name: "jobs",
    insert: job,
    limit: 10,
    freshCapacity: 8,
    retryCapacity: 2,
    claim: (runId: string, limit = 10) =>
      claimDueWhatsAppJobs(runId, {
        now,
        limit,
        phoneNumberIds: [phoneNumberId],
      }),
  },
  {
    name: "deliveries",
    insert: delivery,
    limit: 25,
    freshCapacity: 20,
    retryCapacity: 5,
    claim: (runId: string, limit = 25) =>
      claimDueWhatsAppDeliveries(runId, {
        now,
        limit,
        phoneNumberIds: [phoneNumberId],
      }),
  },
  {
    name: "explicit-ID deliveries",
    insert: delivery,
    limit: 25,
    freshCapacity: 20,
    retryCapacity: 5,
    claim: (runId: string, limit = 25) =>
      claimDueWhatsAppDeliveries(runId, { now, limit, ids: [...deliveryIds] }),
  },
];

describe.each(queues)("$name lane behavior", (queue) => {
  it("claims a lone fresh row ahead of more retries than a full batch", async () => {
    for (let i = 0; i < queue.limit + 1; i++)
      await queue.insert({ attempts: 3 });
    const fresh = await queue.insert();
    const claimed = await queue.claim("fresh-in-backlog");
    expect(claimed).toHaveLength(queue.limit);
    expect(claimed[0].id).toBe(fresh.id);
    expect(claimed.slice(1).every((row) => row.attempts === 3)).toBe(true);
  });

  it.each([0, 2])(
    "fills a full batch from an otherwise empty lane (executions %i)",
    async (attempts) => {
      for (let i = 0; i < queue.limit + 1; i++)
        await queue.insert({ attempts });
      const claimed = await queue.claim("empty-lane");
      expect(claimed).toHaveLength(queue.limit);
      expect(claimed.every((row) => row.attempts === attempts)).toBe(true);
      expect(new Set(claimed.map((row) => row.id)).size).toBe(queue.limit);
    },
  );

  it("refills spare retry capacity with fresh rows and keeps fresh rows first", async () => {
    const retry = await queue.insert({ attempts: 2 });
    for (let i = 0; i < queue.limit + 1; i++) await queue.insert();
    const claimed = await queue.claim("retry-refill");
    expect(claimed).toHaveLength(queue.limit);
    expect(claimed.slice(0, -1).every((row) => row.attempts === 0)).toBe(true);
    expect(claimed.at(-1)?.id).toBe(retry.id);
  });

  it("orders each lane by creation time then ID before limiting, not by execution count", async () => {
    const prefix = randomUUID().slice(0, 24);
    const id = (n: number) => `${prefix}${n.toString().padStart(12, "0")}`;
    // Insert in reverse age/ID order so neither insertion nor UPDATE order wins.
    for (let i = queue.freshCapacity + 1; i >= 1; i--)
      await queue.insert({ id: id(i), attempts: 0 });
    for (let i = queue.retryCapacity + 1; i >= 1; i--)
      await queue.insert({ id: id(100 + i), attempts: 1 });
    const oldestFresh = await queue.insert({
      id: id(99),
      createdAt: new Date(now.getTime() - 1_000),
    });
    const oldestRetry = await queue.insert({
      id: id(199),
      attempts: 4,
      state: "pending",
      createdAt: new Date(now.getTime() - 2_000),
    });
    const claimed = await queue.claim("ordered");
    expect(claimed.map((row) => row.id)).toEqual([
      oldestFresh.id,
      ...Array.from({ length: queue.freshCapacity - 1 }, (_, i) => id(i + 1)),
      oldestRetry.id,
      ...Array.from({ length: queue.retryCapacity - 1 }, (_, i) => id(101 + i)),
    ]);
  });

  it("excludes future, terminal and already claimed rows in either lane", async () => {
    for (const attempts of [0, 2]) {
      await queue.insert({
        attempts,
        nextAttemptAt: new Date(now.getTime() + 1),
      });
      await queue.insert({ attempts, state: "dead" });
      await queue.insert({ attempts, state: "claimed" });
    }
    const due = await queue.insert();
    const claimed = await queue.claim("due-only");
    expect(claimed.map((row) => row.id)).toEqual([due.id]);
    expect(await queue.claim("again")).toEqual([]);
  });

  it("scales custom limits to the same ratio and does not claim with zero capacity", async () => {
    for (let i = 0; i < 6; i++) {
      await queue.insert({ attempts: 0 });
      await queue.insert({ attempts: 2 });
    }
    expect(await queue.claim("zero", 0)).toEqual([]);
    const claimed = await queue.claim("small", 5);
    expect(claimed.map((row) => row.attempts)).toEqual([0, 0, 0, 0, 2]);
  });

  it("gives simultaneous claimers on independent connections disjoint full batches", async () => {
    for (let i = 0; i < queue.limit * 2; i++) await queue.insert();
    const isJob = queue.name === "jobs";
    const module = isJob ? "jobs" : "deliveries";
    const claim = isJob ? "claimDueWhatsAppJobs" : "claimDueWhatsAppDeliveries";
    const opts = {
      limit: queue.limit,
      phoneNumberIds: [phoneNumberId],
      ...(queue.name === "explicit-ID deliveries" ? { ids: deliveryIds } : {}),
    };
    // getDb has max:1, so two calls in this process would merely serialize.
    const run = async (runId: string) => {
      const { stdout } = await promisify(execFile)("bun", [
        "--env-file=.env.local",
        "-e",
        `import { ${claim} } from './src/lib/whatsapp/${module}.ts';
         const rows = await ${claim}('${runId}', { ...${JSON.stringify(opts)}, now: new Date('${now.toISOString()}') });
         console.log(JSON.stringify(rows.map(row => row.id)));
         process.exit(0);`,
      ]);
      return JSON.parse(stdout);
    };
    const [first, second] = await Promise.all([run("first"), run("second")]);
    expect(first).toHaveLength(queue.limit);
    expect(second).toHaveLength(queue.limit);
    expect(new Set([...first, ...second]).size).toBe(queue.limit * 2);
  });

  it("skips rows locked by another transaction instead of waiting or double claiming", async () => {
    const lockedFresh = await queue.insert({
      createdAt: new Date(now.getTime() - 1_000),
    });
    const lockedRetry = await queue.insert({
      attempts: 2,
      createdAt: new Date(now.getTime() - 1_000),
    });
    const fresh = await queue.insert();
    const retry = await queue.insert({ attempts: 2 });
    const table =
      queue.name === "jobs" ? "app.whatsapp_jobs" : "app.whatsapp_deliveries";
    await sql.begin(async (tx) => {
      await tx.unsafe(
        `select id from ${table} where id in ($1, $2) for update`,
        [lockedFresh.id, lockedRetry.id],
      );
      const claimed = await queue.claim("skip-locked");
      expect(claimed.map((row) => row.id)).toEqual([fresh.id, retry.id]);
    });
    const remaining = await queue.claim("released-lock");
    expect(remaining.map((row) => row.id)).toEqual([
      lockedFresh.id,
      lockedRetry.id,
    ]);
  });
});

it("inline explicit IDs never claim unrelated rows or broaden an empty list", async () => {
  const outside = await delivery({
    createdAt: new Date(now.getTime() - 1_000),
  });
  const inside = await delivery();
  expect(
    await claimDueWhatsAppDeliveries("empty-ids", { now, ids: [] }),
  ).toEqual([]);
  const claimed = await claimDueWhatsAppDeliveries("inline", {
    now,
    ids: [inside.id],
  });
  expect(claimed.map((row) => row.id)).toEqual([inside.id]);
  const remaining = await claimDueWhatsAppDeliveries("outside", {
    now,
    phoneNumberIds: [phoneNumberId],
  });
  expect(remaining.map((row) => row.id)).toEqual([outside.id]);
});

describe("WhatsApp fresh-first claim lanes", () => {
  it("reserves fresh delivery lane capacity of twenty and retry capacity of five despite an older retry backlog", async () => {
    for (let i = 0; i < 30; i++)
      await delivery({
        attempts: 2,
        state: "pending",
        createdAt: new Date(now.getTime() - 1_000),
      });
    for (let i = 0; i < 25; i++)
      await delivery({ attempts: 0, state: "failed" });
    const claimed = await claimDueWhatsAppDeliveries("delivery-lanes", {
      now,
      phoneNumberIds: [phoneNumberId],
    });
    expect(claimed).toHaveLength(25);
    expect(claimed.slice(0, 20).every((row) => row.attempts === 0)).toBe(true);
    expect(claimed.slice(20).map((row) => row.attempts)).toEqual([
      2, 2, 2, 2, 2,
    ]);
    for (const row of claimed)
      expect(row).toMatchObject({
        state: "claimed",
        claimedBy: "delivery-lanes",
        claimedAt: now,
        updatedAt: now,
      });
  });
  it("reserves fresh job lane capacity of eight and retry capacity of two despite an older retry backlog", async () => {
    for (let i = 0; i < 20; i++)
      await job({
        attempts: 1,
        state: "pending",
        createdAt: new Date(now.getTime() - 1_000),
      });
    for (let i = 0; i < 12; i++) await job({ attempts: 0, state: "failed" });
    const claimed = await claimDueWhatsAppJobs("job-lanes", {
      now,
      phoneNumberIds: [phoneNumberId],
    });
    expect(claimed).toHaveLength(10);
    expect(claimed.map((row) => row.attempts)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
    ]);
    for (const row of claimed)
      expect(row).toMatchObject({
        state: "claimed",
        claimedBy: "job-lanes",
        claimedAt: now,
        updatedAt: now,
      });
  });
});
