/** Started executions, including crashed work, share one budget across runs. */
export const MAX_EXECUTIONS = 5;

// Extend this discriminated union with provider outcomes, not error prose.
export type RetryFailure = { kind: "internal"; reason: string };
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
  if (
    failure.reason === "unknown_phone_number" ||
    failure.reason === "school_missing"
  ) {
    return { action: "stop", cause: "permanent" };
  }
  if (executions >= MAX_EXECUTIONS) {
    return { action: "stop", cause: "attempts_exhausted" };
  }
  const delayMs = 10_000 * 2 ** Math.max(0, executions - 1);
  return { action: "retry", at: new Date(now.getTime() + delayMs) };
}
