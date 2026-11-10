const AFFIRMATIVE_ANSWERS = new Set(["yes", "confirm", "yep", "ok", "sure"]);

/**
 * Parse a `confirm_booking:<intentId>` reply-button id back to the intent id.
 * Returns null for anything else (including the "choose another time" button).
 */
export function parseConfirmBookingButton(text: string | null): string | null {
  const trimmed = (text ?? "").trim();
  // SQL owns button construction; this is the inbound wire-protocol parser.
  const match = /^confirm_booking:(.*)$/.exec(trimmed);
  if (!match) return null;
  const intentId = match[1]!.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intentId)
    ? intentId
    : null;
}

/**
 * Exact-affirmative text fallback (deterministic, no whitespace surprises):
 * only these lower-cased tokens confirm; everything else routes to the agent.
 */
export function isAffirmativeConfirmation(text: string | null): boolean {
  return AFFIRMATIVE_ANSWERS.has((text ?? "").trim().toLowerCase());
}
