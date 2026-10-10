import type { WhatsAppSendFailure } from "./whatsapp/client";

/** Started executions, including crashed work, share one budget across runs. */
export const MAX_EXECUTIONS = 5;

// Extend this discriminated union with provider outcomes, not error prose.
export type RetryFailure =
  | { kind: "internal"; reason: string }
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
    ].includes(failure.reason);
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
): RetryDecision {
  if (permanentFailure(failure)) {
    return { action: "stop", cause: "permanent" };
  }
  if (executions >= MAX_EXECUTIONS) {
    return { action: "stop", cause: "attempts_exhausted" };
  }
  const delayMs = 10_000 * 2 ** Math.max(0, executions - 1);
  return { action: "retry", at: new Date(now.getTime() + delayMs) };
}
