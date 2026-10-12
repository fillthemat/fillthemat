import { createHash } from "node:crypto";

export const CONFIRM_BUTTON_PREFIX = "confirm_booking:";
export const CHOOSE_ANOTHER_TIME_BUTTON_ID = "choose_another_time";
// Keep the original outbox key so replaying a pre-upgrade booking cannot send
// a second confirmation. The delivery is now plain text, not a template.
export const BOOKING_CONFIRMATION_DELIVERY_PREFIX =
  "booking-confirmation-template/";

const AFFIRMATIVE_ANSWERS = new Set(["yes", "confirm", "yep", "ok", "sure"]);

/** Build the reply-button id embedded in the interactive confirmation message. */
export function confirmBookingButtonId(intentId: string): string {
  return `${CONFIRM_BUTTON_PREFIX}${intentId}`;
}

/**
 * Parse a `confirm_booking:<intentId>` reply-button id back to the intent id.
 * Returns null for anything else (including the "choose another time" button).
 */
export function parseConfirmBookingButton(text: string | null): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed.startsWith(CONFIRM_BUTTON_PREFIX)) return null;
  const intentId = trimmed.slice(CONFIRM_BUTTON_PREFIX.length).trim();
  // The intent id is a UUID; a loose length guard keeps garbage cheap to reject
  // before it reaches `getPendingBookingIntentById`.
  return intentId.length >= 16 && intentId.length <= 64 ? intentId : null;
}

/**
 * Exact-affirmative text fallback (deterministic, no whitespace surprises):
 * only these lower-cased tokens confirm; everything else routes to the agent.
 */
export function isAffirmativeConfirmation(text: string | null): boolean {
  return AFFIRMATIVE_ANSWERS.has((text ?? "").trim().toLowerCase());
}

/**
 * Deterministic v5 UUID used as the platform-minted `bookSlot` idempotency key.
 *
 * Deriving it from `(schoolId, wamid)` means a Meta webhook retry or a worker
 * retry of the same confirmation message mints the *same* UUID, so `bookSlot`'s
 * `(school_id, idempotency_key)` replay guard is airtight instead of racing a
 * fresh `randomUUID()` on every retry. Per decision F/D7 the wamid remains the
 * webhook-layer dedupe key; this UUID is the transaction-level replay key.
 */
export function bookingConfirmationIdempotencyKey(
  schoolId: string,
  wamid: string,
): string {
  return uuidV5(`${schoolId}:${wamid}`);
}

const UUID_V5_URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

function uuidV5(name: string): string {
  const namespace = Buffer.from(UUID_V5_URL_NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(namespace)
    .update(name, "utf8")
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // UUID version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
