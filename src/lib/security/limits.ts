import { createAdminClient } from "@/lib/supabase/admin";

export const MAX_BOOKINGS_PER_EMAIL_PER_DAY = 6;
export const MAX_OUTBOUND_RECIPIENTS_PER_DAY = 12;
export {
  MAX_CHAT_MESSAGES_PER_CONVERSATION,
  MAX_USER_MESSAGE_CHARS,
  MAX_REQUEST_BYTES,
  MAX_AGENT_STEPS,
  requestBodyTooLarge,
} from "./request-limits";

// WhatsApp budgets are distinct from the email delivery budget.
export const MAX_BOOKINGS_PER_WA_ID_PER_DAY = 6;
export const MAX_WHATSAPP_OUTBOUND_PER_WA_ID_PER_DAY = 12;

export async function emailBookingQuotaExceeded(
  schoolId: string,
  email: string,
  now = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { count, error } = await createAdminClient()
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("school_id", schoolId)
    .eq("contact_email_snapshot", email)
    .gte("created_at", since.toISOString());
  if (error) throw error;
  return (count ?? 0) >= MAX_BOOKINGS_PER_EMAIL_PER_DAY;
}

export async function recipientQuotaExceeded(
  schoolId: string,
  recipient: string,
  now = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { count, error } = await createAdminClient()
    .from("email_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("school_id", schoolId)
    .eq("recipient", recipient)
    .gte("created_at", since.toISOString());
  if (error) throw error;
  return (count ?? 0) >= MAX_OUTBOUND_RECIPIENTS_PER_DAY;
}

export async function whatsappBookingQuotaExceeded(
  schoolId: string,
  waId: string,
  now = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { count, error } = await createAdminClient()
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("school_id", schoolId)
    .eq("contact_phone_snapshot", waId)
    .gte("created_at", since.toISOString());
  if (error) throw error;
  return (count ?? 0) >= MAX_BOOKINGS_PER_WA_ID_PER_DAY;
}

export async function whatsappOutboundQuotaExceeded(
  schoolId: string,
  waId: string,
  now = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { count, error } = await createAdminClient()
    .from("whatsapp_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("school_id", schoolId)
    .eq("recipient_wa_id", waId)
    .gte("created_at", since.toISOString());
  if (error) throw error;
  return (count ?? 0) >= MAX_WHATSAPP_OUTBOUND_PER_WA_ID_PER_DAY;
}
