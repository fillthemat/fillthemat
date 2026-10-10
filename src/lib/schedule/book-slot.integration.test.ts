import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { bookSlot, cancelBooking } from "./book-slot";
import { listOpenSlots } from "./occurrences";

loadLocalEnv();
const db = getDb();
const auth = authSql();
const ownerId = randomUUID();
let schoolId = "";
let offeringId = "";
let contactNumber = 0;

beforeAll(async () => {
  const seeded = await seedSchool(auth, {
    ownerId,
    name: "Booking Clock School",
    slug: `book-clock-${ownerId}`,
    publishedAt: new Date(),
    offerings: [{ name: "Trial" }],
  });
  schoolId = seeded.schoolId;
  offeringId = requireRow(seeded.offeringIds[0], "offering");
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
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await deleteSchoolOwner(auth, ownerId);
  await auth.end({ timeout: 5 });
});

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
