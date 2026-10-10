import { describe, expect, it } from "vitest";
import { InternalFailure, retryDecision } from "./retry-policy";

const now = new Date("2020-01-01T12:00:00Z");

describe("Meta send retry policy (§1 decision matrix)", () => {
  it.each([0, 4, 5])(
    "stops a stale booking confirmation ahead of the execution budget (%s)",
    (executions) => {
      expect(
        retryDecision(
          { kind: "internal", reason: "booking_confirmation_stale" },
          executions,
          now,
        ),
      ).toEqual({ action: "stop", cause: "stale" });
    },
  );
  it.each([
    4,
    80007,
    130429,
    131056,
    1,
    2,
    131000,
    131016,
    133004,
    131057,
    999999,
    null,
  ])("bounds transient or unknown code %s to five executions", (code) => {
    const failure = {
      ok: false,
      kind: "whatsapp_error",
      code,
      subcode: 190,
      details: null,
      status: 500,
      message: "invalid parameter",
    } as const;
    expect(retryDecision(failure, 1, now)).toEqual({
      action: "retry",
      at: new Date("2020-01-01T12:00:10Z"),
    });
    expect(retryDecision(failure, 5, now)).toEqual({
      action: "stop",
      cause: "attempts_exhausted",
    });
  });
  it.each(["school_not_approved", "window_closed", "missing_credentials"])(
    "stops delivery preflight %s",
    (reason) => {
      expect(retryDecision({ kind: "internal", reason }, 0, now)).toEqual({
        action: "stop",
        cause: "permanent",
      });
    },
  );
  it("stops missing credentials but bounds HTTP, malformed and network outcomes", () => {
    expect(
      retryDecision(
        { ok: false, kind: "missing_credentials", message: "private" },
        0,
        now,
      ),
    ).toEqual({ action: "stop", cause: "permanent" });
    for (const failure of [
      { ok: false, kind: "network_error", message: "private" },
      { ok: false, kind: "http_error", status: 401, message: "private" },
      {
        ok: false,
        kind: "malformed_response",
        status: 200,
        message: "private",
      },
    ] as const) {
      expect(retryDecision(failure, 4, now)).toEqual({
        action: "retry",
        at: new Date("2020-01-01T12:01:20Z"),
      });
      expect(retryDecision(failure, 5, now)).toEqual({
        action: "stop",
        cause: "attempts_exhausted",
      });
    }
  });
  it("uses explicit malformed-request details for ambiguous Meta code 1, never the message", () => {
    expect(
      retryDecision(
        {
          ok: false,
          kind: "whatsapp_error",
          code: 1,
          subcode: null,
          details: "Invalid parameter",
          status: 400,
          message: "private",
        },
        1,
        now,
      ),
    ).toEqual({ action: "stop", cause: "permanent" });
  });
  it.each([
    131047,
    131026,
    0,
    3,
    10,
    190,
    ...Array.from({ length: 100 }, (_, i) => 200 + i),
    131005,
    33,
    100,
    131008,
    131009,
    131021,
    131051,
    135000,
    132000,
    132001,
    132005,
    132007,
    132012,
    132015,
    132016,
    368,
    130497,
    131031,
    131037,
    131042,
    131045,
    133010,
    130403,
    131050,
    131048,
    131064,
    131049,
    131063,
    130472,
  ])("stops unchanged sends for permanent code %i", (code) => {
    expect(
      retryDecision(
        {
          ok: false,
          kind: "whatsapp_error",
          code,
          subcode: null,
          details: null,
          status: 400,
          message: "private provider prose",
        },
        1,
        now,
      ),
    ).toEqual({ action: "stop", cause: "permanent" });
  });
});

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
