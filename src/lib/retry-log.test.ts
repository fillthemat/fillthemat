import { expect, it } from "vitest";
import { deadEventFrom } from "./retry-log";

it("builds the same public dead event from legacy and Supabase queue rows", () => {
  const event = deadEventFrom(
    {
      id: "delivery",
      attempts: 5,
      school_id: "school",
      failure_reason: "worker_crashed",
      failure_code: 123,
      terminal_cause: "attempts_exhausted",
    },
    "email_delivery",
    "run",
  );
  expect(event).toEqual(
    deadEventFrom(
      {
        id: "delivery",
        attempts: 5,
        schoolId: "school",
        failureReason: "worker_crashed",
        failureCode: 123,
        terminalCause: "attempts_exhausted",
      },
      "email_delivery",
      "run",
    ),
  );
  expect(event).toMatchObject({
    queue: "email_delivery",
    id: "delivery",
    schoolId: "school",
    reason: "worker_crashed",
    code: 123,
    terminalCause: "attempts_exhausted",
    executions: 5,
    runId: "run",
  });
});

it.each(["permanent", "stale", "attempts_exhausted"])(
  "retains the %s cause on a Supabase row",
  (cause) => {
    expect(
      deadEventFrom(
        { id: "id", school_id: null, failure_reason: null, terminal_cause: cause, attempts: 1 },
        "whatsapp_job",
        "run",
      ),
    ).toMatchObject({ terminalCause: cause, reason: "unknown_failure" });
  },
);
