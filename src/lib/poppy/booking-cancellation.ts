import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { type Booking, bookingCancelTokens, bookings } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { cancelBooking } from "@/lib/schedule/book-slot";
import { validBookingCancelToken } from "./booking-cancel-token";

const credential = z.object({
  bookingId: z.uuid(),
  token: z.string().regex(/^v1\.[A-Za-z0-9_-]{43}$/),
});

function authorized(booking: Booking, token: string, now: Date) {
  return (
    booking.channel === "poppy" &&
    booking.status === "booked" &&
    booking.startAt > now &&
    validBookingCancelToken(booking, token)
  );
}

/** Read only: email scanners and repeated GETs cannot consume the credential. */
export async function readBookingCancellation(
  bookingId: string,
  token: string,
) {
  if (!credential.safeParse({ bookingId, token }).success) return null;
  const [row] = await getDb()
    .select({ booking: bookings })
    .from(bookings)
    .innerJoin(
      bookingCancelTokens,
      and(
        eq(bookingCancelTokens.bookingId, bookings.id),
        eq(bookingCancelTokens.schoolId, bookings.schoolId),
      ),
    )
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookingCancelTokens.tokenHash, hashToken(token)),
        isNull(bookingCancelTokens.usedAt),
      ),
    )
    .limit(1);
  return row && authorized(row.booking, token, new Date()) ? row.booking : null;
}

/** Authorization, token consumption, cancellation and outboxes commit together. */
export async function cancelBookingWithToken(bookingId: string, token: string) {
  if (!credential.safeParse({ bookingId, token }).success)
    return { ok: false as const, code: "invalid_cancel_link" as const };
  return getDb().transaction(async (tx) => {
    // Lock the booking first, in the same order as owner cancellation.
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update")
      .limit(1);
    const now = new Date();
    if (!booking || !authorized(booking, token, now))
      return { ok: false as const, code: "invalid_cancel_link" as const };
    const [used] = await tx
      .update(bookingCancelTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(bookingCancelTokens.bookingId, booking.id),
          eq(bookingCancelTokens.schoolId, booking.schoolId),
          eq(bookingCancelTokens.tokenHash, hashToken(token)),
          isNull(bookingCancelTokens.usedAt),
        ),
      )
      .returning();
    if (!used)
      return { ok: false as const, code: "invalid_cancel_link" as const };
    const result = await cancelBooking(
      { schoolId: booking.schoolId, bookingId, now },
      { transaction: tx },
    );
    // The lock and checks above guarantee success; any unexpected discrepancy
    // must roll back the credential too, never report a successful cancellation.
    if (!result.ok || result.replay)
      throw new Error("cancel_booking_state_changed");
    return result;
  });
}
