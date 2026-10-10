import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bookings,
  emailDeliveries,
  schools,
  type WhatsAppDelivery,
} from "@/db/schema";

type Database = ReturnType<typeof getDb>;
export type DeliveryTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export async function bookingConfirmationIsStale(
  delivery: WhatsAppDelivery,
  now: Date,
  db: Database | DeliveryTransaction = getDb(),
): Promise<boolean> {
  if (!delivery.bookingId || delivery.templateName !== "booking_confirmation")
    return false;
  const [booking] = await db
    .select({ startAt: bookings.startAt })
    .from(bookings)
    .where(eq(bookings.id, delivery.bookingId))
    .limit(1);
  return Boolean(booking && booking.startAt.getTime() <= now.getTime());
}

/** All successful delivery-death transitions call this inside their transaction.
 * The email and terminal state commit together; a crash cannot lose the notice.
 * Email death has no hook, so notifications never recurse.
 */
export async function onWhatsAppDeliveryDead(
  tx: DeliveryTransaction,
  delivery: WhatsAppDelivery,
  now: Date,
): Promise<void> {
  if (
    delivery.state !== "dead" ||
    delivery.terminalCause === "stale" ||
    !delivery.bookingId ||
    delivery.templateName !== "booking_confirmation"
  )
    return;
  if (await bookingConfirmationIsStale(delivery, now, tx)) return;
  const [school] = await tx
    .select({ notificationEmail: schools.notificationEmail })
    .from(schools)
    .where(eq(schools.id, delivery.schoolId))
    .limit(1);
  if (!school) return;
  await tx
    .insert(emailDeliveries)
    .values({
      schoolId: delivery.schoolId,
      bookingId: delivery.bookingId,
      kind: "owner_whatsapp_confirmation_failed",
      recipient: school.notificationEmail,
      providerIdempotencyKey: `owner-whatsapp-confirmation-failed/${delivery.bookingId}`,
      nextAttemptAt: now,
    })
    .onConflictDoNothing({ target: emailDeliveries.providerIdempotencyKey });
}
