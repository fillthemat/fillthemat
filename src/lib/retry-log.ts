import type { TerminalCause } from "@/db/schema";

export function deadEventFrom(
  row: {
    id: string;
    schoolId: string | null;
    failureReason: string | null;
    failureCode?: number | null;
    terminalCause: TerminalCause | null;
    attempts: number;
  },
  queue: "whatsapp_job" | "whatsapp_delivery" | "email_delivery",
  runId: string,
) {
  return {
    queue,
    id: row.id,
    schoolId: row.schoolId,
    reason: row.failureReason ?? "unknown_failure",
    code: row.failureCode,
    terminalCause: row.terminalCause ?? "attempts_exhausted",
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
      reason: /^[a-z][a-z_]{0,79}$/.test(event.reason)
        ? event.reason
        : "unknown_failure",
      terminalCause: event.terminalCause,
      ...(event.code != null && Number.isInteger(event.code)
        ? { code: event.code }
        : {}),
      executions: event.executions,
      runId: event.runId,
    }),
  );
}
