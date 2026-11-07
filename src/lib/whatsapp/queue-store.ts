import "server-only";
import { z } from "zod";
import type { Database } from "@/db/types";
import { createAdminClient } from "@/lib/supabase/admin";

type JobRow = Database["public"]["Tables"]["whatsapp_jobs"]["Row"];
type DeliveryRow = Database["public"]["Tables"]["whatsapp_deliveries"]["Row"];
const terminalCause = z.enum(["permanent", "attempts_exhausted", "stale"]).nullable();
const buttons = z.array(z.object({ id: z.string(), title: z.string() })).nullable();

// Preserve database microseconds in claim fences. Only business deadlines become Dates.
export function jobFromRow(row: JobRow) {
  return {
    id: row.id,
    schoolId: row.school_id,
    phoneNumberId: row.phone_number_id,
    kind: row.kind,
    payload: row.payload,
    state: row.state,
    attempts: row.attempts,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    lastError: row.last_error,
    failureReason: row.failure_reason,
    terminalCause: terminalCause.parse(row.terminal_cause),
  };
}
export type WhatsAppJob = ReturnType<typeof jobFromRow>;

export function deliveryFromRow(row: DeliveryRow) {
  return {
    id: row.id,
    schoolId: row.school_id,
    bookingId: row.booking_id,
    recipientWaId: row.recipient_wa_id,
    phoneNumberId: row.phone_number_id,
    state: row.state,
    attempts: row.attempts,
    templateName: row.template_name,
    templateParams: row.template_params,
    body: row.body,
    interactiveButtons: buttons.parse(row.interactive_buttons),
    windowExpiresAt: row.window_expires_at ? new Date(row.window_expires_at) : null,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    lastError: row.last_error,
    failureReason: row.failure_reason,
    failureCode: row.failure_code,
    terminalCause: terminalCause.parse(row.terminal_cause),
  };
}
export type WhatsAppDelivery = ReturnType<typeof deliveryFromRow>;

export async function updateJobClaim(
  claim: WhatsAppJob,
  values: Database["public"]["Tables"]["whatsapp_jobs"]["Update"],
) {
  if (!claim.claimedAt || !claim.claimedBy) return null;
  const { data } = await createAdminClient()
    .from("whatsapp_jobs")
    .update(values)
    .eq("id", claim.id)
    .eq("state", "claimed")
    .eq("claimed_by", claim.claimedBy)
    .eq("claimed_at", claim.claimedAt)
    .eq("attempts", claim.attempts)
    .select()
    .maybeSingle()
    .throwOnError();
  return data;
}

export async function updateDeliveryClaim(
  claim: WhatsAppDelivery,
  values: Database["public"]["Tables"]["whatsapp_deliveries"]["Update"],
) {
  if (!claim.claimedAt || !claim.claimedBy) return null;
  const { data } = await createAdminClient()
    .from("whatsapp_deliveries")
    .update(values)
    .eq("id", claim.id)
    .eq("state", "claimed")
    .eq("claimed_by", claim.claimedBy)
    .eq("claimed_at", claim.claimedAt)
    .eq("attempts", claim.attempts)
    .select()
    .maybeSingle()
    .throwOnError();
  return data;
}
