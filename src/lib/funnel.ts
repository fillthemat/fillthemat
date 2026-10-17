export const FUNNEL_EVENTS = {
  sessionQualified: "session_qualified",
  noMatchingOffering: "no_matching_offering",
  noOpenSlot: "no_open_slot",
  leadCaptured: "lead_captured",
  confirmationFailure: "confirmation_failure",
  bookingConfirmed: "booking_confirmed",
  bookingCancelled: "booking_cancelled",
  reminderDelivery: "reminder_delivery",
  showed: "showed",
  noShow: "no_show",
  chatPrepare: "chat_prepare",
} as const;

export type FunnelEventType = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

export function privacySafeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const blocked = new Set([
    "email",
    "phone",
    "name",
    "participantName",
    "contactName",
    "text",
    "message",
    "prompt",
    "output",
  ]);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (blocked.has(key)) continue;
    if (typeof value === "string" && value.length > 200) continue;
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}
