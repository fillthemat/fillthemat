import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

type DeliveryEvent = { type: string; data?: object | null };

/** Applies verified events. Dead deliveries stay terminal, unrelated events are no-ops. */
export async function recordResendDeliveryEvent(event: DeliveryEvent): Promise<void> {
  const providerId = event.data && "email_id" in event.data ? String(event.data.email_id) : null;
  if (!providerId) return;
  const state =
    event.type === "email.delivered"
      ? "delivered"
      : event.type === "email.bounced"
        ? "bounced"
        : event.type === "email.complained"
          ? "complained"
          : null;
  if (!state) return;
  await createAdminClient()
    .from("email_deliveries")
    .update({ state })
    .eq("provider_id", providerId)
    .neq("state", "dead")
    .throwOnError();
}
