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
import { whatsappDeliveries } from "@/db/schema";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import {
  claimDueWhatsAppDeliveries,
  enqueueWhatsAppDelivery,
} from "./deliveries";

loadLocalEnv();
const db = getDb();
const auth = authSql();
const ownerId = randomUUID();
let schoolId = "";

beforeAll(async () => {
  ({ schoolId } = await seedSchool(auth, {
    ownerId,
    name: "WhatsApp Delivery Clock School",
    slug: `wa-claim-${ownerId}`,
    offerings: [{ name: "Trial" }],
  }));
});
afterEach(async () => {
  vi.useRealTimers();
  await db
    .delete(whatsappDeliveries)
    .where(eq(whatsappDeliveries.schoolId, schoolId));
});
afterAll(async () => {
  await deleteSchoolOwner(auth, ownerId);
  await auth.end({ timeout: 5 });
});

async function insertDelivery(
  input: Pick<typeof whatsappDeliveries.$inferInsert, "state"> & {
    nextAttemptAt?: Date | SQL;
  } = {},
) {
  const [row] = await db
    .insert(whatsappDeliveries)
    .values({
      schoolId,
      phoneNumberId: ownerId,
      recipientWaId: "16505550101",
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
  expect(await claimDueWhatsAppDeliveries(randomUUID(), { ids: [] })).toEqual(
    [],
  );
  expect(
    sortedIds(await claimDueWhatsAppDeliveries(randomUUID(), { ids })),
  ).toEqual(ids);
  const [untouched] = await db
    .select()
    .from(whatsappDeliveries)
    .where(eq(whatsappDeliveries.id, excluded.id));
  expect(untouched?.state).toBe("pending");
  expect(untouched?.claimedBy).toBeNull();
});

describe.each([
  ["behind", "2000-01-01T00:00:00Z"],
  ["ahead", "2100-01-01T00:00:00Z"],
])("claiming with the server clock %s the database", (_skew, serverTime) => {
  it("claims a freshly enqueued reply immediately", async () => {
    skewServerClock(serverTime);
    const id = await enqueueWhatsAppDelivery({
      schoolId,
      phoneNumberId: ownerId,
      recipientWaId: "16505550101",
      providerIdempotencyKey: randomUUID(),
      body: "Hello",
    });
    const ids = [requireRow(id, "enqueued delivery")];
    expect(
      sortedIds(await claimDueWhatsAppDeliveries(randomUUID(), { ids })),
    ).toEqual(ids);
  });

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
      sortedIds(await claimDueWhatsAppDeliveries(randomUUID(), { ids })),
    ).toEqual(sortedIds([pendingDue, retryDue]));
    expect(await claimDueWhatsAppDeliveries(randomUUID(), { ids })).toEqual([]);
  });
});
