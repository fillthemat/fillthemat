import "server-only";
import type { Database } from "@/db/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmailBooking } from "./templates";

export type EmailDelivery = Database["public"]["Tables"]["email_deliveries"]["Row"];
type Booking = Database["public"]["Tables"]["bookings"]["Row"];

/** One conditional statement: stale/duplicate finalizers change no rows. */
export async function updateClaim(
  claim: EmailDelivery,
  values: Database["public"]["Tables"]["email_deliveries"]["Update"],
) {
  if (!claim.claimed_at || !claim.claimed_by) return null;
  const { data } = await createAdminClient()
    .from("email_deliveries")
    .update(values)
    .eq("id", claim.id)
    .eq("state", "claimed")
    .eq("claimed_by", claim.claimed_by)
    .eq("claimed_at", claim.claimed_at)
    .eq("attempts", claim.attempts)
    .select()
    .maybeSingle()
    .throwOnError();
  return data;
}

export function emailBooking(row: Booking): EmailBooking & {
  endAt: Date;
  icsUid: string;
  icsSequence: number;
} {
  return {
    startAt: new Date(row.start_at),
    endAt: new Date(row.end_at),
    icsUid: row.ics_uid,
    icsSequence: row.ics_sequence,
    timezoneSnapshot: row.timezone_snapshot,
    offeringNameSnapshot: row.offering_name_snapshot,
    participantNameSnapshot: row.participant_name_snapshot,
    participantAgeSnapshot: row.participant_age_snapshot,
    locationSnapshot: row.location_snapshot,
    instructionsSnapshot: row.instructions_snapshot,
    contactNameSnapshot: row.contact_name_snapshot,
    contactEmailSnapshot: row.contact_email_snapshot,
    contactPhoneSnapshot: row.contact_phone_snapshot,
  };
}
