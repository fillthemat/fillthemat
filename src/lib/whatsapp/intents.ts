import "server-only";
import type { Tables } from "@/db/types";
import { createAdminClient } from "@/lib/supabase/admin";

function intentFromRow(row: Tables<"whatsapp_booking_intents">) {
  return {
    id: row.id,
    schoolId: row.school_id,
    conversationId: row.conversation_id,
    offeringId: row.offering_id,
    slotId: row.slot_id,
    participantName: row.participant_name,
    participantAge: row.participant_age,
    state: row.state,
    expiresAt: new Date(row.expires_at),
  };
}
export type WhatsAppBookingIntent = ReturnType<typeof intentFromRow>;

async function ensureNotExpired(row: Tables<"whatsapp_booking_intents"> | null, now: Date) {
  if (!row) return null;
  if (new Date(row.expires_at) > now) return intentFromRow(row);
  await createAdminClient()
    .from("whatsapp_booking_intents")
    .update({ state: "expired" })
    .eq("id", row.id)
    .eq("state", "pending")
    .lte("expires_at", now.toISOString())
    .throwOnError();
  return null;
}

export async function getPendingBookingIntent(conversationId: string, now = new Date()) {
  const { data } = await createAdminClient()
    .from("whatsapp_booking_intents")
    .select()
    .eq("conversation_id", conversationId)
    .eq("state", "pending")
    .maybeSingle()
    .throwOnError();
  return ensureNotExpired(data, now);
}
