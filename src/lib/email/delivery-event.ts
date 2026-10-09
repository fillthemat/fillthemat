import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { emailDeliveries } from "@/db/schema";

type DeliveryEvent = { type: string; data?: object | null };
type DeliveryEventResult = { status: "recorded" } | { status: "ignored" };

/** Applies a verified provider event; unrelated events are acknowledged unchanged. */
export async function recordResendDeliveryEvent(
  event: DeliveryEvent,
): Promise<DeliveryEventResult> {
  const providerId =
    event.data && "email_id" in event.data ? String(event.data.email_id) : null;
  if (!providerId) return { status: "ignored" };

  const state =
    event.type === "email.delivered"
      ? "delivered"
      : event.type === "email.bounced"
        ? "bounced"
        : event.type === "email.complained"
          ? "complained"
          : null;
  if (!state) return { status: "ignored" };

  await getDb()
    .update(emailDeliveries)
    .set({ state, updatedAt: new Date() })
    .where(eq(emailDeliveries.providerId, providerId));
  return { status: "recorded" };
}
