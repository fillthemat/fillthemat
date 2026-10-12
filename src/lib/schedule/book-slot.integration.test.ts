import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
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
import { emailDeliveries, schools, trialWindows } from "@/db/schema";
import { attemptPendingForBooking } from "@/lib/email/deliveries";
import type { EmailMessage } from "@/lib/email/dependencies";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { bookSlot, cancelBooking } from "./book-slot";
import { listOpenSlots } from "./occurrences";

loadLocalEnv(process.env.INTEGRATION_ENV_FILE);
const localUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(localUrl.hostname))
  throw new Error("Booking-path tests require a local database");
const admin = authSql();
const databaseName = `booking_path_${randomUUID().replaceAll("-", "")}`;
localUrl.pathname = `/${databaseName}`;
const auth = postgres(localUrl.toString(), { max: 1 });
let databaseCreated = false;
let db: ReturnType<typeof getDb>;
const ownerId = randomUUID();
const schoolId = randomUUID();
const offeringId = randomUUID();
let contactNumber = 0;

beforeAll(async () => {
  // Validate the full migration chain without touching the shared stack.
  await admin.unsafe(`create database "${databaseName}"`);
  databaseCreated = true;
  await auth`create schema auth`;
  await auth`create table auth.users (id uuid primary key)`;
  for (const migration of readMigrationFiles({ migrationsFolder: "drizzle" }))
    await auth.begin(async (tx) => {
      for (const statement of migration.sql) await tx.unsafe(statement);
    });
  vi.stubEnv("DATABASE_URL", localUrl.toString());
  db = getDb();
  await auth`insert into auth.users (id) values (${ownerId})`;
  await auth`insert into app.users (id, email) values (${ownerId}, ${`${ownerId}@local.test`})`;
  await auth`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email, approved_at, published_at) values (${schoolId}, ${ownerId}, ${`book-clock-${ownerId}`}, 'Booking Clock School', 'America/New_York', 'owner@local.test', now(), now())`;
  await auth`insert into app.trial_offerings (id, school_id, name) values (${offeringId}, ${schoolId}, 'Trial')`;
  await db.insert(trialWindows).values(
    Array.from({ length: 7 }, (_, dayOfWeek) => ({
      schoolId,
      trialOfferingId: offeringId,
      dayOfWeek,
      startMinute: 1020,
      durationMinutes: 60,
      capacity: 10,
    })),
  );
}, 60000);
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await auth.end({ timeout: 5 });
  if (databaseCreated)
    await admin.unsafe(
      `drop database if exists "${databaseName}" with (force)`,
    );
  await admin.end({ timeout: 5 });
  vi.unstubAllEnvs();
}, 60000);

async function createBooking() {
  const [schoolRow] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, schoolId));
  const school = requireRow(schoolRow, "school");
  const windows = await db
    .select()
    .from(trialWindows)
    .where(eq(trialWindows.schoolId, schoolId));
  const slot = requireRow(
    listOpenSlots({
      offeringId,
      timezone: school.timezone,
      windows,
      occurrences: [],
      now: new Date(),
    }).find(({ startAt }) => startAt.getTime() > Date.now() + 2 * 86_400_000),
    "future trial",
  );
  const result = await bookSlot({
    channel: "web",
    school,
    offeringId,
    slotId: slot.slotId,
    idempotencyKey: randomUUID(),
    contact: {
      name: "Booking Contact",
      email: `${randomUUID()}@local.test`,
      phone: `1650555010${++contactNumber}`,
    },
    participant: { name: "Trial Participant", age: 8 },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.booking;
}

describe("inline booking emails with the app clock behind the database", () => {
  it("joins an Operation transaction so booking and outboxes roll back with it", async () => {
    let bookingId = "";
    await expect(
      db.transaction(async (tx) => {
        const [school] = await tx
          .select()
          .from(schools)
          .where(eq(schools.id, schoolId));
        const windows = await tx
          .select()
          .from(trialWindows)
          .where(eq(trialWindows.schoolId, schoolId));
        const slot = requireRow(
          listOpenSlots({
            offeringId,
            timezone: requireRow(school, "school").timezone,
            windows,
            occurrences: [],
            now: new Date(),
          })[0],
          "trial",
        );
        const result = await bookSlot(
          {
            school: requireRow(school, "school"),
            channel: "web",
            offeringId,
            slotId: slot.slotId,
            idempotencyKey: randomUUID(),
            contact: {
              name: "Atomic Contact",
              email: `${randomUUID()}@local.test`,
              phone: "16508881111",
            },
            participant: { name: "Atomic Participant", age: 8 },
          },
          { transaction: tx },
        );
        if (!result.ok) throw new Error(result.code);
        bookingId = result.booking.id;
        throw new Error("outer_write_failed");
      }),
    ).rejects.toThrow("outer_write_failed");
    expect(
      await auth`select id from app.bookings where id = ${bookingId}`,
    ).toHaveLength(0);
    expect(
      await auth`select id from app.email_deliveries where booking_id = ${bookingId}`,
    ).toHaveLength(0);
  });
  it("records the web channel for direct bookings", async () => {
    expect(await createBooking()).toMatchObject({ channel: "web" });
  });

  it("sends both cancellation emails inline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 86_400_000));
    const booking = await createBooking();
    const send = vi.fn(async (_message: EmailMessage) => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: randomUUID(),
    }));
    await attemptPendingForBooking(booking.id, { transport: { send } });
    send.mockClear();
    const result = await cancelBooking({ schoolId, bookingId: booking.id });
    expect(result.ok).toBe(true);
    await attemptPendingForBooking(booking.id, { transport: { send } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      send.mock.calls.map(([message]) => message.idempotencyKey).sort(),
    ).toEqual([
      `booking-cancellation/${booking.id}/1`,
      `owner-cancellation/${booking.id}/1`,
    ]);
    const deliveries = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.bookingId, booking.id));
    const cancellations = deliveries.filter(
      ({ kind }) =>
        kind === "booking_cancellation" || kind === "owner_cancellation",
    );
    expect(cancellations).toHaveLength(2);
    for (const delivery of cancellations) {
      expect(delivery.state).toBe("sent");
      expect(delivery.nextAttemptAt).toEqual(new Date());
    }
  });

  it("sends both booking confirmation and owner notification inline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 86_400_000));
    const booking = await createBooking();
    const send = vi.fn(async (_message: EmailMessage) => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: randomUUID(),
    }));
    await attemptPendingForBooking(booking.id, { transport: { send } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      send.mock.calls.map(([message]) => message.idempotencyKey).sort(),
    ).toEqual([
      `booking-confirmation/${booking.id}`,
      `owner-booking/${booking.id}`,
    ]);
    const deliveries = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.bookingId, booking.id));
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      expect(delivery.state).toBe("sent");
      expect(delivery.nextAttemptAt).toEqual(new Date());
    }
  });
});
