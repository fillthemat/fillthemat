import { createHmac, timingSafeEqual } from "node:crypto";
import type { Transaction } from "@/db";
import { type Booking, bookingCancelTokens } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { poppyAppOrigin } from "./urls";

function signingSecret() {
  const secret = process.env.POPPY_CANCEL_LINK_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "POPPY_CANCEL_LINK_SECRET must contain at least 32 characters",
    );
  return secret;
}

// A purpose-separated HMAC is deterministic so durable email retries recover
// the same credential without storing it (or a plaintext email containing it).
// Booking UUIDs are never reused; the stored hash authorizes only one use.
export function bookingCancelToken(booking: Pick<Booking, "id" | "schoolId">) {
  return `v1.${createHmac("sha256", signingSecret())
    .update(`poppy-booking-cancel:v1:${booking.schoolId}:${booking.id}`)
    .digest("base64url")}`;
}

export function validBookingCancelToken(booking: Booking, token: string) {
  if (!/^v1\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return timingSafeEqual(
    Buffer.from(token),
    Buffer.from(bookingCancelToken(booking)),
  );
}

export async function issueBookingCancelToken(
  booking: Booking,
  tx: Transaction,
) {
  await tx.insert(bookingCancelTokens).values({
    bookingId: booking.id,
    schoolId: booking.schoolId,
    tokenHash: hashToken(bookingCancelToken(booking)),
  });
}

export function bookingCancelUrl(booking: Booking) {
  return `${poppyAppOrigin()}/poppy/bookings/${booking.id}/cancel?token=${bookingCancelToken(booking)}`;
}
