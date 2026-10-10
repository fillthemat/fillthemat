import type { WhatsAppSendFailure } from "./whatsapp/client";

/** Started executions, including crashed work, share one budget across runs. */
export const MAX_EXECUTIONS = 5;

// Extend this discriminated union with provider outcomes, not error prose.
export type RetryFailure =
  | { kind: "internal"; reason: string }
  | { kind: "email_error"; name: string; status: number | null }
  | WhatsAppSendFailure;

// Meta matrix in docs/decisions/whatsapp-retry-limits-research.md §1.
// Unknown codes deliberately remain bounded retries, not an allowlist of retries.
const permanentMetaCodes = new Set([
  131047, 131026, 0, 3, 10, 190, 131005, 33, 100, 131008, 131009, 131021,
  131051, 135000, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 368,
  130497, 131031, 131037, 131042, 131045, 133010, 130403, 131050, 131048,
  131064, 131049, 131063, 130472,
]);

function permanentFailure(failure: RetryFailure): boolean {
  if (failure.kind === "internal") {
    return [
      "unknown_phone_number",
      "school_missing",
      "school_not_approved",
      "window_closed",
      "missing_credentials",
      "missing_booking",
      "missing_lead",
      "missing_contact",
      "unknown_email_kind",
    ].includes(failure.reason);
  }
  if (failure.kind === "email_error") {
    return (
      [400, 401, 403, 404, 405, 413, 422].includes(failure.status ?? 0) ||
      [
        "validation_error",
        "invalid_parameter",
        "missing_required_field",
        "missing_required_parameter",
        "invalid_api_key",
        "missing_api_key",
        "restricted_api_key",
        "suspended_api_key",
        "invalid_permission",
        "invalid_from_address",
        "invalid_to_address",
        "invalid_idempotency_key",
        "invalid_idempotent_request",
        "invalid_attachment",
        "not_found",
        "method_not_allowed",
      ].includes(failure.name)
    );
  }
  if (failure.kind === "whatsapp_error" && failure.code != null) {
    return (
      permanentMetaCodes.has(failure.code) ||
      (failure.code >= 200 && failure.code <= 299) ||
      (failure.code === 1 &&
        /\b(invalid parameter|missing required parameter|malformed request)\b/i.test(
          failure.details ?? "",
        ))
    );
  }
  return failure.kind === "missing_credentials";
}
/** Named internal failures retain a machine reason without parsing Error.message. */
export class InternalFailure extends Error {
  readonly kind = "internal";
  constructor(
    readonly reason: string,
    message = reason,
  ) {
    super(message);
    this.name = "InternalFailure";
  }
}
export type TerminalCause = "permanent" | "attempts_exhausted";
export type RetryDecision =
  | { action: "stop"; cause: TerminalCause }
  | { action: "retry"; at: Date };

export function retryDecision(
  failure: RetryFailure,
  executions: number,
  now: Date,
  channel: "whatsapp" | "email" = "whatsapp",
): RetryDecision {
  if (permanentFailure(failure)) {
    return { action: "stop", cause: "permanent" };
  }
  if (executions >= MAX_EXECUTIONS) {
    return { action: "stop", cause: "attempts_exhausted" };
  }
  const delayMs =
    channel === "email"
      ? Math.min(60, 2 ** Math.max(0, executions - 1)) * 60_000
      : 10_000 * 2 ** Math.max(0, executions - 1);
  return { action: "retry", at: new Date(now.getTime() + delayMs) };
}
