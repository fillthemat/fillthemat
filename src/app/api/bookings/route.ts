import { attemptPendingForBooking } from "@/lib/email/deliveries";
import {
  bookSlot,
  findBookingByIdempotencyKey,
} from "@/lib/schedule/book-slot";
import { getPublicSchoolBySlug } from "@/lib/schools/public";
import {
  emailBookingQuotaExceeded,
  recipientQuotaExceeded,
} from "@/lib/security/limits";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createBookingHandler } from "./handler";

export const POST = createBookingHandler({
  getPublicSchoolBySlug,
  verifyTurnstile,
  findBookingByIdempotencyKey,
  emailBookingQuotaExceeded,
  recipientQuotaExceeded,
  bookSlot,
  attemptPendingForBooking,
  logFailure: (record) => console.error(JSON.stringify(record)),
});
