import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
import { emailDeliveries, whatsappDeliveries, whatsappJobs } from "@/db/schema";
import { claimDueDeliveries } from "@/lib/email/deliveries";
import {
  claimDueWhatsAppDeliveries,
  enqueueWhatsAppDelivery,
} from "@/lib/whatsapp/deliveries";
import { claimDueWhatsAppJobs, enqueueInboundJobs } from "@/lib/whatsapp/jobs";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";

loadLocalEnv();
const db = getDb();
const auth = authSql();
const ownerId = randomUUID();
let schoolId = "";

beforeAll(async () => {
  ({ schoolId } = await seedSchool(auth, {
    ownerId,
    name: "Claim Clock School",
    slug: `claim-clock-${ownerId}`,
    offerings: [{ name: "Trial" }],
  }));
});

afterEach(async () => {
  vi.useRealTimers();
  await db.delete(whatsappJobs).where(eq(whatsappJobs.phoneNumberId, ownerId));
  await db
    .delete(whatsappDeliveries)
    .where(eq(whatsappDeliveries.schoolId, schoolId));
  await db
    .delete(emailDeliveries)
    .where(eq(emailDeliveries.schoolId, schoolId));
});

afterAll(async () => {
  await deleteSchoolOwner(auth, ownerId);
  await auth.end({ timeout: 5 });
});

it("scopes WhatsApp job claims to the requested IDs, including an empty list", async () => {
  const [target, excluded] = await db
    .insert(whatsappJobs)
    .values(
      [1, 2].map(() => ({
        phoneNumberId: ownerId,
        dedupeKey: randomUUID(),
        payload: {},
      })),
    )
    .returning();
  const ids = [requireRow(target, "target job").id];
  expect(await claimDueWhatsAppJobs(randomUUID(), { ids: [] })).toEqual([]);
  expect(
    (await claimDueWhatsAppJobs(randomUUID(), { ids })).map(({ id }) => id),
  ).toEqual(ids);
  const [untouched] = await db
    .select()
    .from(whatsappJobs)
    .where(eq(whatsappJobs.id, requireRow(excluded, "excluded job").id));
  expect(untouched?.state).toBe("pending");
  expect(untouched?.claimedBy).toBeNull();
});

it("scopes email delivery claims to the requested IDs, including an empty list", async () => {
  const [target, excluded] = await db
    .insert(emailDeliveries)
    .values(
      [1, 2].map(() => ({
        schoolId,
        kind: "owner_lead" as const,
        recipient: "owner@local.test",
        providerIdempotencyKey: randomUUID(),
      })),
    )
    .returning();
  const ids = [requireRow(target, "target delivery").id];
  expect(await claimDueDeliveries(randomUUID(), 25, { ids: [] })).toEqual([]);
  expect(
    (await claimDueDeliveries(randomUUID(), 25, { ids })).map(({ id }) => id),
  ).toEqual(ids);
  const [untouched] = await db
    .select()
    .from(emailDeliveries)
    .where(
      eq(emailDeliveries.id, requireRow(excluded, "excluded delivery").id),
    );
  expect(untouched?.state).toBe("pending");
  expect(untouched?.claimedBy).toBeNull();
});

it("scopes WhatsApp delivery claims to the requested IDs, including an empty list", async () => {
  const [target, excluded] = await db
    .insert(whatsappDeliveries)
    .values(
      [1, 2].map(() => ({
        schoolId,
        phoneNumberId: ownerId,
        recipientWaId: "16505550101",
        providerIdempotencyKey: randomUUID(),
      })),
    )
    .returning();
  const ids = [requireRow(target, "target delivery").id];
  expect(await claimDueWhatsAppDeliveries(randomUUID(), { ids: [] })).toEqual(
    [],
  );
  expect(
    (await claimDueWhatsAppDeliveries(randomUUID(), { ids })).map(
      ({ id }) => id,
    ),
  ).toEqual(ids);
  const [untouched] = await db
    .select()
    .from(whatsappDeliveries)
    .where(
      eq(whatsappDeliveries.id, requireRow(excluded, "excluded delivery").id),
    );
  expect(untouched?.state).toBe("pending");
  expect(untouched?.claimedBy).toBeNull();
});

describe.each([
  ["behind", "2000-01-01T00:00:00Z"],
  ["ahead", "2100-01-01T00:00:00Z"],
])("claiming with the server clock %s the database", (_skew, serverTime) => {
  it("claims a freshly enqueued inbound WhatsApp job immediately", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(serverTime));
    const wamid = randomUUID();
    expect(
      await enqueueInboundJobs([
        {
          phoneNumberId: ownerId,
          wamid,
          waId: "16505550101",
          text: "Hello",
          profileName: null,
        },
      ]),
    ).toBe(1);

    const jobs = await db
      .select({ id: whatsappJobs.id })
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    const claimed = await claimDueWhatsAppJobs(randomUUID(), {
      ids: jobs.map(({ id }) => id),
    });
    expect(
      claimed
        .filter((row) => row.phoneNumberId === ownerId)
        .map(({ dedupeKey }) => dedupeKey),
    ).toEqual([wamid]);
  });

  it("claims database-due WhatsApp jobs, but not future retries or completed jobs", async () => {
    const rows = await db
      .insert(whatsappJobs)
      .values(
        [
          { state: "pending" as const },
          { state: "failed" as const },
          {
            state: "failed" as const,
            nextAttemptAt: sql`now() + interval '1 day'`,
          },
          { state: "done" as const },
        ].map((job) => ({
          ...job,
          schoolId,
          phoneNumberId: ownerId,
          dedupeKey: randomUUID(),
          payload: {},
        })),
      )
      .returning({ id: whatsappJobs.id });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(serverTime));
    const ids = rows.map(({ id }) => id);
    const claimed = await claimDueWhatsAppJobs(randomUUID(), { ids });
    expect(
      claimed
        .filter((row) => row.schoolId === schoolId)
        .map(({ id }) => id)
        .sort(),
    ).toEqual(
      rows
        .slice(0, 2)
        .map(({ id }) => id)
        .sort(),
    );
    expect(
      (await claimDueWhatsAppJobs(randomUUID(), { ids })).filter(
        (row) => row.schoolId === schoolId,
      ),
    ).toEqual([]);
  });

  it("claims database-due WhatsApp deliveries, but not future retries or sent deliveries", async () => {
    const rows = await db
      .insert(whatsappDeliveries)
      .values(
        [
          { state: "pending" as const },
          { state: "failed" as const },
          {
            state: "failed" as const,
            nextAttemptAt: sql`now() + interval '1 day'`,
          },
          { state: "sent" as const },
        ].map((delivery) => ({
          ...delivery,
          schoolId,
          phoneNumberId: ownerId,
          recipientWaId: "16505550101",
          providerIdempotencyKey: randomUUID(),
        })),
      )
      .returning({ id: whatsappDeliveries.id });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(serverTime));
    const ids = rows.map(({ id }) => id);
    const claimed = await claimDueWhatsAppDeliveries(randomUUID(), { ids });
    expect(claimed.map(({ id }) => id).sort()).toEqual(
      rows
        .slice(0, 2)
        .map(({ id }) => id)
        .sort(),
    );
    expect(await claimDueWhatsAppDeliveries(randomUUID(), { ids })).toEqual([]);
  });

  it("claims a freshly enqueued WhatsApp reply immediately", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(serverTime));
    const id = await enqueueWhatsAppDelivery({
      schoolId,
      phoneNumberId: ownerId,
      recipientWaId: "16505550101",
      providerIdempotencyKey: randomUUID(),
      body: "Hello",
    });
    expect(id).not.toBeNull();
    const claimed = await claimDueWhatsAppDeliveries(randomUUID(), {
      ids: [requireRow(id, "delivery")],
    });
    expect(
      claimed.filter((row) => row.schoolId === schoolId).map(({ id }) => id),
    ).toEqual([id]);
  });

  it("claims database-due email deliveries, but not future retries or sent deliveries", async () => {
    const rows = await db
      .insert(emailDeliveries)
      .values(
        [
          { state: "pending" as const },
          { state: "failed" as const },
          {
            state: "failed" as const,
            nextAttemptAt: sql`now() + interval '1 day'`,
          },
          { state: "sent" as const },
        ].map((delivery) => ({
          ...delivery,
          schoolId,
          kind: "owner_lead" as const,
          recipient: "owner@local.test",
          providerIdempotencyKey: randomUUID(),
        })),
      )
      .returning({ id: emailDeliveries.id });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(serverTime));
    const ids = rows.map(({ id }) => id);
    const claimed = await claimDueDeliveries(randomUUID(), 25, { ids });
    expect(
      claimed
        .filter((row) => row.schoolId === schoolId)
        .map(({ id }) => id)
        .sort(),
    ).toEqual(
      rows
        .slice(0, 2)
        .map(({ id }) => id)
        .sort(),
    );
    expect(
      (await claimDueDeliveries(randomUUID(), 25, { ids })).filter(
        (row) => row.schoolId === schoolId,
      ),
    ).toEqual([]);
  });
});
