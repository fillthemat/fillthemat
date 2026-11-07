import type { Tables } from "@/db/types";
import { hashToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSlotId } from "./slot-id";

export type BookSlotInput = {
  /** The database decides publication and snapshot facts. */
  school: { id: string };
  offeringId: string;
  slotId: string;
  idempotencyKey: string;
  contact: { name: string; email: string | null; phone: string };
  participant: { name: string; age: number };
  landingSessionToken?: string;
  conversationResumeToken?: string;
  /** Public conversation ID only; never a legacy WhatsApp conversation ID. */
  conversationId?: string;
  now?: Date;
};

const failureCodes = [
  "invalid_slot",
  "slot_unavailable",
  "ineligible",
  "already_booked",
  "school_not_public",
] as const;
type Booking = ReturnType<typeof bookingRecord>;
export type BookSlotResult =
  | { ok: true; booking: Booking; idempotent: boolean }
  | { ok: false; code: (typeof failureCodes)[number] };

/** Preserve the existing route/WhatsApp contract while public rows use snake case. */
function bookingRecord(row: Tables<"bookings">) {
  return {
    id: row.id,
    schoolId: row.school_id,
    contactId: row.contact_id,
    participantId: row.participant_id,
    trialOfferingId: row.trial_offering_id,
    trialWindowId: row.trial_window_id,
    trialOccurrenceId: row.trial_occurrence_id,
    conversationId: row.conversation_id,
    landingSessionId: row.landing_session_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    participantNameSnapshot: row.participant_name_snapshot,
    participantAgeSnapshot: row.participant_age_snapshot,
    offeringNameSnapshot: row.offering_name_snapshot,
    timezoneSnapshot: row.timezone_snapshot,
    startAt: new Date(row.start_at),
    endAt: new Date(row.end_at),
    locationSnapshot: row.location_snapshot,
    instructionsSnapshot: row.instructions_snapshot,
    contactEmailSnapshot: row.contact_email_snapshot,
    contactNameSnapshot: row.contact_name_snapshot,
    contactPhoneSnapshot: row.contact_phone_snapshot,
    icsUid: row.ics_uid,
    icsSequence: row.ics_sequence,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Called only after the route's school access and CAPTCHA checks. */
export async function findBookingByIdempotencyKey(
  schoolId: string,
  idempotencyKey: string,
): Promise<Booking | null> {
  const { data, error } = await createAdminClient()
    .from("bookings")
    .select("*")
    .eq("school_id", schoolId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data ? bookingRecord(data) : null;
}

export async function bookSlot(input: BookSlotInput): Promise<BookSlotResult> {
  const parsed = parseSlotId(input.slotId);
  if (!parsed) return { ok: false, code: "invalid_slot" };
  const { data, error } = await createAdminClient().rpc("book_trial", {
    p_school_id: input.school.id,
    p_offering_id: input.offeringId,
    p_window_id: parsed.windowId,
    p_start_at: parsed.startAt.toISOString(),
    p_idempotency_key: input.idempotencyKey,
    p_contact_name: input.contact.name,
    p_email: input.contact.email ?? undefined,
    p_phone: input.contact.phone,
    p_participant_name: input.participant.name,
    p_participant_age: input.participant.age,
    p_landing_token_hash: input.landingSessionToken
      ? hashToken(input.landingSessionToken)
      : undefined,
    p_resume_token_hash: input.conversationResumeToken
      ? hashToken(input.conversationResumeToken)
      : undefined,
    p_conversation_id: input.conversationId,
    p_now: input.now?.toISOString(),
  });
  if (error) {
    const code = failureCodes.find(
      (candidate) => error.code === "P0001" && error.message === candidate,
    );
    if (code) return { ok: false, code };
    throw error;
  }
  const result = data?.[0];
  if (!result?.booking) throw new Error("booking_result_missing");
  return { ok: true, booking: bookingRecord(result.booking), idempotent: result.idempotent };
}
