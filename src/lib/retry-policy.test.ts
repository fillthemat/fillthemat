import { describe, expect, it } from "vitest";
import { InternalFailure, retryDecision } from "./retry-policy";

const now = new Date("2020-01-01T12:00:00Z");

describe("retry policy", () => {
  it.each([
    "whatsapp_booking_intent_insert_failed",
    "contact_failed",
    "landing_session_failed",
    "lead_failed",
    "contact_upsert_failed",
    "participant_upsert_failed",
    "occurrence_missing",
    "booking_insert_failed",
    "worker_crashed",
    "unrecognised_reason",
  ])("keeps %s retryable within the shared cap", (reason) => {
    expect(retryDecision({ kind: "internal", reason }, 1, now)).toEqual({
      action: "retry",
      at: new Date("2020-01-01T12:00:10Z"),
    });
    expect(retryDecision({ kind: "internal", reason }, 5, now)).toEqual({
      action: "stop",
      cause: "attempts_exhausted",
    });
  });
  it("carries a structured internal reason separately from private error prose", () => {
    const failure = new InternalFailure(
      "school_missing",
      "Private context must not be classified or logged",
    );
    expect(failure.reason).toBe("school_missing");
    expect(retryDecision(failure, 1, now)).toEqual({
      action: "stop",
      cause: "permanent",
    });
  });
  it.each([
    ["new_internal_reason", 1, "2020-01-01T12:00:10Z"],
    ["whatsapp_conversation_resolution_failed", 2, "2020-01-01T12:00:20Z"],
    ["whatsapp_job_failed", 3, "2020-01-01T12:00:40Z"],
    ["whatsapp_job_failed", 4, "2020-01-01T12:01:20Z"],
  ] as const)(
    "retries %s after execution %i at %s",
    (reason, executions, at) => {
      expect(
        retryDecision({ kind: "internal", reason }, executions, now),
      ).toEqual({
        action: "retry",
        at: new Date(at),
      });
    },
  );
  it.each([
    ["unknown_phone_number", 1, "permanent"],
    ["school_missing", 1, "permanent"],
    ["unknown_phone_number", 5, "permanent"],
    ["whatsapp_job_failed", 5, "attempts_exhausted"],
    ["new_internal_reason", 6, "attempts_exhausted"],
  ] as const)(
    "stops %s at execution %i with cause %s",
    (reason, executions, cause) => {
      expect(
        retryDecision({ kind: "internal", reason }, executions, now),
      ).toEqual({
        action: "stop",
        cause,
      });
    },
  );
});
