export type InboundWhatsAppStatus = {
  status: "sent" | "delivered" | "read" | "failed";
  wamid: string;
  recipientId: string | null;
  timestamp: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorSubcode?: number | null;
  errorDetails?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTimestamp(value: unknown): number | null {
  const parsed =
    typeof value === "string" || typeof value === "number"
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

const KNOWN_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/**
 * Normalize a Meta webhook payload into delivery-status updates.
 *
 * Iterates `entry[] -> changes[] -> value.statuses[]` defensively as arrays so
 * a malformed/inbound payload yields an empty list (which the route acks).
 * `statuses[].id` is the wamid of OUR outbound message and correlates via
 * `whatsapp_deliveries.provider_id`.
 */
export function parseInboundWhatsAppStatuses(
  payload: unknown,
): InboundWhatsAppStatus[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];

  const out: InboundWhatsAppStatus[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      if (!Array.isArray(value.statuses)) continue;
      for (const status of value.statuses) {
        if (!isRecord(status)) continue;
        const statusName = status.status;
        if (typeof statusName !== "string" || !KNOWN_STATUSES.has(statusName)) {
          continue;
        }
        const wamid = typeof status.id === "string" ? status.id : "";
        if (!wamid) continue;

        let errorCode: string | null = null;
        let errorMessage: string | null = null;
        let errorSubcode: number | null = null;
        let errorDetails: string | null = null;
        const errors = status.errors;
        if (Array.isArray(errors)) {
          for (const error of errors) {
            if (!isRecord(error)) continue;
            errorSubcode = toTimestamp(error.error_subcode);
            errorDetails =
              isRecord(error.error_data) &&
              typeof error.error_data.details === "string"
                ? error.error_data.details
                : null;
            errorCode =
              typeof error.code === "string" || typeof error.code === "number"
                ? String(error.code)
                : errorCode;
            errorMessage =
              typeof error.title === "string"
                ? error.title
                : typeof error.message === "string"
                  ? error.message
                  : errorMessage;
            if (errorCode) break;
          }
        }

        out.push({
          status: statusName as InboundWhatsAppStatus["status"],
          wamid,
          recipientId:
            typeof status.recipient_id === "string"
              ? status.recipient_id
              : null,
          timestamp: toTimestamp(status.timestamp),
          errorCode,
          errorMessage,
          errorSubcode,
          errorDetails,
        });
      }
    }
  }
  return out;
}
