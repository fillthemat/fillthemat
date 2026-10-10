import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { emailDeliveries } from "@/db/schema";

type DeliveryEvent = { type: string; data?: object | null };

/** Applies a verified provider event; unrelated events are acknowledged unchanged. */
export async function recordResendDeliveryEvent(
  event: DeliveryEvent,
): Promise<void> {
  const providerId =
    event.data && "email_id" in event.data ? String(event.data.email_id) : null;
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

  await getDb()
    .update(emailDeliveries)
    .set({ state, updatedAt: new Date() })
    .where(eq(emailDeliveries.providerId, providerId));
}
