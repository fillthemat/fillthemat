import { createAdminClient } from "@/lib/supabase/admin";
import type { WhatsAppDelivery } from "./queue-store";

// Cross-outbox death/confirmation hooks now live beside the SQL queue functions.
export async function bookingConfirmationIsStale(
  delivery: WhatsAppDelivery,
  now: Date,
): Promise<boolean> {
  if (!delivery.bookingId || delivery.templateName !== "booking_confirmation") return false;
  const { data } = await createAdminClient()
    .from("bookings")
    .select("start_at")
    .eq("id", delivery.bookingId)
    .eq("school_id", delivery.schoolId)
    .maybeSingle()
    .throwOnError();
  return Boolean(data && new Date(data.start_at) <= now);
}
