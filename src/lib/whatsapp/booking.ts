import { generateId } from "ai";
import { formatInTimeZone } from "date-fns-tz";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { schools, type WhatsAppBookingIntent } from "@/db/schema";
import { appendMessage } from "@/lib/conversations/conversation-store";
import { attemptPendingForBooking } from "@/lib/email/deliveries";
import { bookSlot } from "@/lib/schedule/book-slot";
import { whatsappBookingQuotaExceeded } from "@/lib/security/limits";
import { bookingConfirmationIdempotencyKey } from "./confirmation";
import {
  attemptWhatsAppDeliveriesNow,
  enqueueWhatsAppDelivery,
} from "./deliveries";
import {
  type WhatsAppWorkerDependencies,
  whatsappWorkerDependencies,
} from "./dependencies";
import { markBookingIntentConfirmed } from "./intents";

/**
 * What the person was sent: the booking confirmation, saved as a message, or
 * a notice, which isn't saved.
 */
export type BookingReply = { text: string; messageId?: string };

export type ConfirmWhatsAppBookingResult = (
  | { status: "booked"; bookingId: string; idempotent: boolean }
  | { status: "rate_limited" }
  | { status: "incomplete" }
  | { status: "book_failed"; code: string }
) & { reply: BookingReply };

async function sendNotice({
  schoolId,
  waId,
  phoneNumberId,
  text,
  runId,
  windowExpiresAt,
  idempotencyKey,
  dependencies,
}: {
  schoolId: string;
  waId: string;
  phoneNumberId: string;
  text: string;
  runId: string;
  windowExpiresAt: Date;
  idempotencyKey: string;
  dependencies: WhatsAppWorkerDependencies;
}): Promise<BookingReply> {
  const deliveryId = await enqueueWhatsAppDelivery(
    {
      schoolId,
      recipientWaId: waId,
      phoneNumberId,
      providerIdempotencyKey: idempotencyKey,
      body: text,
      windowExpiresAt,
    },
    dependencies.now(),
  );
  if (deliveryId)
    await attemptWhatsAppDeliveriesNow([deliveryId], runId, dependencies);
  return { text };
}

/**
 * Platform write path for a confirmed booking over WhatsApp (decision A / F /
 * D7 / D8). Called only after a `prepare_booking` capture and an explicit
 * in-chat confirmation (reply button `confirm_booking:<id>` or an exact
 * affirmative). The agent NEVER reaches `bookSlot`; this function does.
 *
 * - Idempotency key is a deterministic v5 UUID from `(schoolId, wamid)` so a
 *   job/webhook retry replays into the same booking instead of double-booking.
 * - No-email contact → `bookSlot` stores a null email snapshot and skips the
 *   prospect email; the prospect confirmation is enqueued here as the
 *   `booking_confirmation` WhatsApp template and the owner email stays email.
 */
export async function confirmWhatsAppBooking(
  {
    schoolId,
    conversationId,
    intent,
    waId,
    phoneNumberId,
    wamid,
    profileName,
    runId,
  }: {
    schoolId: string;
    conversationId: string;
    intent: WhatsAppBookingIntent;
    waId: string;
    phoneNumberId: string;
    wamid: string;
    profileName: string | null;
    runId: string;
  },
  overrides: Partial<WhatsAppWorkerDependencies> = {},
): Promise<ConfirmWhatsAppBookingResult> {
  const dependencies = whatsappWorkerDependencies(overrides);
  const now = dependencies.now();
  const windowExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const db = getDb();
  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  // The school was deleted mid-turn, and its conversation with it.
  if (!school) throw new Error("school_missing");

  // 429-equivalent: per-wa_id daily booking cap (Phase 5 abuse controls).
  if (await whatsappBookingQuotaExceeded(schoolId, waId, now)) {
    const reply = await sendNotice({
      schoolId,
      waId,
      phoneNumberId,
      runId,
      windowExpiresAt,
      dependencies,
      idempotencyKey: `wa-notice/${waId}/${wamid}`,
      text: "You've reached the daily booking limit for today. Please try again tomorrow.",
    });
    return { status: "rate_limited", reply };
  }

  // A booking needs a concrete participant age. If the agent captured a bare
  // prepare_booking without one, ask again rather than guessing.
  if (intent.participantAge == null) {
    const reply = await sendNotice({
      schoolId,
      waId,
      phoneNumberId,
      runId,
      windowExpiresAt,
      dependencies,
      idempotencyKey: `wa-notice/${waId}/${wamid}`,
      text: "I still need the participant's age to complete the booking. Could you tell me their age in years?",
    });
    return { status: "incomplete", reply };
  }

  const participantName =
    (intent.participantName ?? profileName ?? "").trim() || "Guest";
  const result = await bookSlot({
    school,
    offeringId: intent.offeringId,
    slotId: intent.slotId,
    idempotencyKey: bookingConfirmationIdempotencyKey(schoolId, wamid),
    contact: { name: participantName, email: null, phone: waId },
    participant: { name: participantName, age: intent.participantAge },
    conversationId,
  });

  if (!result.ok) {
    const message =
      result.code === "already_booked"
        ? "This participant is already booked into that slot."
        : result.code === "ineligible"
          ? "That participant doesn't meet the offering's age range."
          : "That time is no longer open — please pick another time.";
    const reply = await sendNotice({
      schoolId,
      waId,
      phoneNumberId,
      runId,
      windowExpiresAt,
      dependencies,
      idempotencyKey: `wa-notice/${waId}/${wamid}`,
      text: message,
    });
    return { status: "book_failed", code: result.code, reply };
  }

  await markBookingIntentConfirmed(intent.id);

  const booking = result.booking;
  const when = formatInTimeZone(
    booking.startAt,
    school.timezone,
    "EEEE MMM d 'at' h:mm a",
  );
  const transcript =
    `Booked! ${booking.participantNameSnapshot}'s trial for ${booking.offeringNameSnapshot} is ${when}. ` +
    `${school.name} will see you there.`;
  const transcriptMessageId = await appendMessage({
    role: "assistant",
    conversationId,
    messageId: generateId(),
    parts: [{ type: "text", text: transcript }],
  });

  // No-email prospect confirmation → WhatsApp template (decision B / D8). The
  // owner notification stays email and was enqueued by `bookSlot` already.
  const templateDeliveryId = await enqueueWhatsAppDelivery(
    {
      schoolId,
      recipientWaId: waId,
      phoneNumberId,
      providerIdempotencyKey: `booking-confirmation-template/${booking.id}`,
      templateName: "booking_confirmation",
      templateParams: [
        school.name,
        booking.participantNameSnapshot,
        booking.offeringNameSnapshot,
        when,
      ],
      bookingId: booking.id,
    },
    dependencies.now(),
  );
  if (templateDeliveryId) {
    await attemptWhatsAppDeliveriesNow(
      [templateDeliveryId],
      runId,
      dependencies,
    );
  }
  if (!result.idempotent) {
    await attemptPendingForBooking(booking.id);
  }

  return {
    status: "booked",
    bookingId: booking.id,
    idempotent: result.idempotent,
    reply: { text: transcript, messageId: transcriptMessageId },
  };
}
