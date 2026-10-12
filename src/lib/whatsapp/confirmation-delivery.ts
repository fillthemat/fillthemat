import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bookings,
  emailDeliveries,
  schools,
  type WhatsAppDelivery,
} from "@/db/schema";
import { BOOKING_CONFIRMATION_DELIVERY_PREFIX } from "./confirmation";

type Database = ReturnType<typeof getDb>;
export type DeliveryTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

function isBookingConfirmation(delivery: WhatsAppDelivery): boolean {
  if (!delivery.bookingId) return false;
  // Recognize pending legacy confirmations too, without consulting the shared
  // template registry. Other booking-linked replies must not trigger alerts.
  if (delivery.templateName)
    return delivery.templateName === "booking_confirmation";
  return (
    !delivery.interactiveButtons?.length &&
    delivery.providerIdempotencyKey.startsWith(
      BOOKING_CONFIRMATION_DELIVERY_PREFIX,
    )
  );
}

export async function bookingConfirmationIsStale(
  delivery: WhatsAppDelivery,
  now: Date,
  db: Database | DeliveryTransaction = getDb(),
): Promise<boolean> {
  if (!isBookingConfirmation(delivery) || !delivery.bookingId) return false;
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
    !isBookingConfirmation(delivery)
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

/** Cancel only notices no email worker has started; in-flight/sent mail cannot
 * be recalled safely. The delete and confirmed delivery commit together.
 */
export async function onWhatsAppDeliveryConfirmed(
  tx: DeliveryTransaction,
  delivery: WhatsAppDelivery,
): Promise<void> {
  if (
    !delivery.bookingId ||
    !isBookingConfirmation(delivery) ||
    !["delivered", "read"].includes(delivery.state)
  )
    return;
  await tx
    .delete(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.schoolId, delivery.schoolId),
        eq(emailDeliveries.bookingId, delivery.bookingId),
        eq(emailDeliveries.kind, "owner_whatsapp_confirmation_failed"),
        inArray(emailDeliveries.state, ["pending", "failed"]),
        eq(emailDeliveries.attempts, 0),
      ),
    );
}
