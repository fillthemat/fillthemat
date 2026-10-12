import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, emailDeliveries } from "@/db/schema";
import { shouldCreateReminder } from "@/lib/schedule/reminders";

export async function createDueReminderDeliveries(now = new Date()) {
  const db = getDb();
  const due = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "booked"), gt(bookings.startAt, now)));

  let created = 0;
  for (const booking of due) {
    if (
      !shouldCreateReminder({
        createdAt: booking.createdAt,
        startAt: booking.startAt,
        now,
      })
    ) {
      continue;
    }
    // WhatsApp no-email bookings have no email reminder address; skip them
    // (their reminder medium is the WhatsApp template, a Phase 6 rollout step).
    if (!booking.contactEmailSnapshot) continue;
    const inserted = await db
      .insert(emailDeliveries)
      .values({
        schoolId: booking.schoolId,
        bookingId: booking.id,
        kind: "booking_reminder",
        recipient: booking.contactEmailSnapshot,
        providerIdempotencyKey: `booking-reminder/${booking.id}`,
        state: "pending",
        nextAttemptAt: now,
      })
      .onConflictDoNothing({
        target: emailDeliveries.providerIdempotencyKey,
      })
      .returning({ id: emailDeliveries.id });
    if (inserted[0]) created += 1;
  }
  return created;
}
