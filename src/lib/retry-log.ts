import type { TerminalCause } from "./retry-policy";

/** Call only after an atomic transition returned a changed row. Never pass error prose. */
export function logDeadTransition(event: {
  queue: "whatsapp_job" | "whatsapp_delivery" | "email_delivery";
  id: string;
  schoolId: string | null;
  reason: string;
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
      executions: event.executions,
      runId: event.runId,
    }),
  );
}
