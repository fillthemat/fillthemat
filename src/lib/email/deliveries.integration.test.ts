import { randomUUID } from "node:crypto";
import { eq, type SQL, sql } from "drizzle-orm";
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
import { emailDeliveries } from "@/db/schema";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { claimDueDeliveries } from "./deliveries";

loadLocalEnv();
const db = getDb();
const auth = authSql();
const ownerId = randomUUID();
let schoolId = "";

beforeAll(async () => {
  ({ schoolId } = await seedSchool(auth, {
    ownerId,
    name: "Email Delivery Clock School",
    slug: `email-claim-${ownerId}`,
    offerings: [{ name: "Trial" }],
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  await db
    .delete(emailDeliveries)
    .where(eq(emailDeliveries.schoolId, schoolId));
});
afterAll(async () => {
  await deleteSchoolOwner(auth, ownerId);
  await auth.end({ timeout: 5 });
});

async function insertDelivery(
  input: Pick<typeof emailDeliveries.$inferInsert, "state"> & {
    nextAttemptAt?: Date | SQL;
  } = {},
) {
  const [row] = await db
    .insert(emailDeliveries)
    .values({
      schoolId,
      kind: "owner_lead",
      recipient: "owner@local.test",
      providerIdempotencyKey: randomUUID(),
      ...input,
    })
    .returning();
  return requireRow(row, "delivery");
}

function skewServerClock(time: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(time));
}

function sortedIds(rows: { id: string }[]) {
  return rows.map(({ id }) => id).sort();
}

it("scopes claims to the requested IDs, including an empty list", async () => {
  const target = await insertDelivery();
  const excluded = await insertDelivery();
  const ids = [target.id];
  expect(await claimDueDeliveries(randomUUID(), 25, { ids: [] })).toEqual([]);
  expect(
    sortedIds(await claimDueDeliveries(randomUUID(), 25, { ids })),
  ).toEqual(ids);
  const [untouched] = await db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.id, excluded.id));
  expect(untouched?.state).toBe("pending");
  expect(untouched?.claimedBy).toBeNull();
});

describe.each([
  ["behind", "2000-01-01T00:00:00Z"],
  ["ahead", "2100-01-01T00:00:00Z"],
])("claiming with the server clock %s the database", (_skew, serverTime) => {
  it("claims database-due deliveries, but not future retries or sent deliveries", async () => {
    const pendingDue = await insertDelivery();
    const retryDue = await insertDelivery({ state: "failed" });
    const futureRetry = await insertDelivery({
      state: "failed",
      nextAttemptAt: sql`now() + interval '1 day'`,
    });
    const sent = await insertDelivery({ state: "sent" });
    const ids = sortedIds([pendingDue, retryDue, futureRetry, sent]);
    skewServerClock(serverTime);
    expect(
      sortedIds(await claimDueDeliveries(randomUUID(), 25, { ids })),
    ).toEqual(sortedIds([pendingDue, retryDue]));
    expect(await claimDueDeliveries(randomUUID(), 25, { ids })).toEqual([]);
  });
});
