import type { TerminalCause } from "./retry-policy";

export function deadEventFrom(
  row: { id: string; attempts: number } & (
    | {
        schoolId: string | null;
        failureReason: string | null;
        failureCode?: number | null;
        terminalCause: TerminalCause | null;
      }
    | {
        school_id: string | null;
        failure_reason: string | null;
        failure_code?: number | null;
        terminal_cause: string | null;
      }
  ),
  queue: "whatsapp_job" | "whatsapp_delivery" | "email_delivery",
  runId: string,
) {
  const fields =
    "school_id" in row
      ? {
          schoolId: row.school_id,
          failureReason: row.failure_reason,
          failureCode: row.failure_code,
          terminalCause: row.terminal_cause,
        }
      : row;
  const terminalCause: TerminalCause =
    fields.terminalCause === "permanent"
      ? "permanent"
      : fields.terminalCause === "stale"
        ? "stale"
        : "attempts_exhausted";
  return {
    queue,
    id: row.id,
    schoolId: fields.schoolId,
    reason: fields.failureReason ?? "unknown_failure",
    code: fields.failureCode,
    terminalCause,
    executions: row.attempts,
    runId,
  };
}

/** Call only after an atomic transition returned a changed row. Never pass error prose. */
export function logDeadTransition(event: {
  queue: "whatsapp_job" | "whatsapp_delivery" | "email_delivery";
  id: string;
  schoolId: string | null;
  reason: string;
  code?: number | null;
  terminalCause: TerminalCause;
  executions: number;
  runId: string;
}): void {
  // Explicitly select fields: passing a DB row must not leak its payload.
  console.error(
    JSON.stringify({
      event: "queue.dead",
      queue: event.queue,
      id: event.id,
      schoolId: event.schoolId,
      reason: /^[a-z][a-z_]{0,79}$/.test(event.reason) ? event.reason : "unknown_failure",
      terminalCause: event.terminalCause,
      ...(event.code != null && Number.isInteger(event.code) ? { code: event.code } : {}),
      executions: event.executions,
      runId: event.runId,
    }),
  );
}
