import { and, eq } from "drizzle-orm";
import { getDb, type Transaction, type TransactionOptions, withTransaction } from "@/db";
import { type WhatsAppBookingIntent, whatsappBookingIntents } from "@/db/schema";

/** How long a prepared booking stays confirmable before it needs re-picking. */
export const WHATSAPP_BOOKING_INTENT_TTL_MS = 30 * 60 * 1000;

export type BookingIntentInput = {
  schoolId: string;
  conversationId: string;
  offeringId: string;
  slotId: string;
  participantName: string | null;
  participantAge: number | null;
  now?: Date;
};

/**
 * Persist/refresh the one active pending intent for a conversation. Any prior
 * pending intent is superseded first so the partial unique index
 * (`conversation_id` WHERE state = 'pending') stays satisfiable and stale
 * intents can never be confirmed after a newer pick.
 *
 * The agent NEVER writes this — the platform calls it after a successful
 * `prepare_booking` tool capture.
 * An optional transaction includes the intent in the caller's Turn commit.
 */
export async function upsertPendingBookingIntent(
  input: BookingIntentInput,
  options: TransactionOptions = {},
): Promise<WhatsAppBookingIntent> {
  const now = input.now ?? new Date();
  const write = async (tx: Transaction) => {
    await tx
      .update(whatsappBookingIntents)
      .set({ state: "superseded", updatedAt: now })
      .where(
        and(
          eq(whatsappBookingIntents.conversationId, input.conversationId),
          eq(whatsappBookingIntents.state, "pending"),
        ),
      );

    const [intent] = await tx
      .insert(whatsappBookingIntents)
      .values({
        schoolId: input.schoolId,
        conversationId: input.conversationId,
        offeringId: input.offeringId,
        slotId: input.slotId,
        participantName: input.participantName,
        participantAge: input.participantAge,
        state: "pending",
        expiresAt: new Date(now.getTime() + WHATSAPP_BOOKING_INTENT_TTL_MS),
      })
      .returning();
    if (!intent) throw new Error("whatsapp_booking_intent_insert_failed");
    return intent;
  };
  return withTransaction(write, options);
}

/** Mark an expired row expired and return null (intents are short-lived). */
async function ensureNotExpired(
  intent: WhatsAppBookingIntent,
  now: Date,
): Promise<WhatsAppBookingIntent | null> {
  if (intent.expiresAt > now) return intent;
  const db = getDb();
  if (intent.state === "pending") {
    await db
      .update(whatsappBookingIntents)
      .set({ state: "expired", updatedAt: now })
      .where(eq(whatsappBookingIntents.id, intent.id));
  }
  return null;
}

/** The current pending intent for a conversation, if any and not expired. */
export async function getPendingBookingIntent(
  conversationId: string,
  now = new Date(),
): Promise<WhatsAppBookingIntent | null> {
  const db = getDb();
  const [intent] = await db
    .select()
    .from(whatsappBookingIntents)
    .where(
      and(
        eq(whatsappBookingIntents.conversationId, conversationId),
        eq(whatsappBookingIntents.state, "pending"),
      ),
    )
    .limit(1);
  if (!intent) return null;
  return ensureNotExpired(intent, now);
}

/**
 * A pending intent addressed by id (used by the `confirm_booking:<id>` reply
 * button). Validates it is still pending and only returns it when it belongs
 * to the given school (defense against cross-school id guessing).
 */
export async function getPendingBookingIntentById(
  intentId: string,
  schoolId: string,
  now = new Date(),
): Promise<WhatsAppBookingIntent | null> {
  const db = getDb();
  const [intent] = await db
    .select()
    .from(whatsappBookingIntents)
    .where(
      and(
        eq(whatsappBookingIntents.id, intentId),
        eq(whatsappBookingIntents.schoolId, schoolId),
        eq(whatsappBookingIntents.state, "pending"),
      ),
    )
    .limit(1);
  if (!intent) return null;
  return ensureNotExpired(intent, now);
}

/** Transition a pending intent to confirmed once `bookSlot` succeeds. */
export async function markBookingIntentConfirmed(intentId: string): Promise<void> {
  const db = getDb();
  await db
    .update(whatsappBookingIntents)
    .set({ state: "confirmed", updatedAt: new Date() })
    .where(
      and(eq(whatsappBookingIntents.id, intentId), eq(whatsappBookingIntents.state, "pending")),
    );
}
