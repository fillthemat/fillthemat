import { describe, expect, it } from "vitest";
import { emailRetryDecision as retryDecision } from "@/lib/retry-policy";

const now = new Date("2025-01-01T00:00:00Z");
describe("email retry policy", () => {
  it("stops validation and credential failures without interpreting prose", () => {
    expect(
      retryDecision(
        { kind: "email_error", name: "validation_error", status: 422 },
        1,
        now,
      ),
    ).toEqual({ action: "stop", cause: "permanent" });
  });
  it.each([
    "invalid_idempotency_key",
    "validation_error",
    "missing_api_key",
    "restricted_api_key",
    "suspended_api_key",
    "invalid_permission",
    "not_found",
    "method_not_allowed",
    "invalid_idempotent_request",
    "invalid_attachment",
    "invalid_parameter",
    "missing_required_field",
    "missing_required_parameter",
    "invalid_to_address",
  ])(
    "stops named permanent email error %s even without HTTP status",
    (name) => {
      expect(
        retryDecision({ kind: "email_error", name, status: null }, 1, now),
      ).toEqual({ action: "stop", cause: "permanent" });
    },
  );
  it.each([400, 401, 403, 404, 405, 413, 422])(
    "stops deterministic HTTP %i",
    (status) => {
      expect(
        retryDecision(
          { kind: "email_error", name: "unrecognised", status },
          1,
          now,
        ),
      ).toEqual({ action: "stop", cause: "permanent" });
    },
  );
  it.each([
    ["concurrent_idempotent_requests", 409],
    ["resource_locked", 409],
    ["rate_limit_exceeded", 429],
    ["daily_quota_exceeded", 429],
    ["monthly_quota_exceeded", 429],
    ["application_error", 500],
    ["service_unavailable", 503],
    ["unrecognised", null],
  ])(
    "bounds transient/unknown %s without changing minute cadence",
    (name, status) => {
      const failure = {
        kind: "email_error" as const,
        name: String(name),
        status: typeof status === "number" ? status : null,
      };
      expect(retryDecision(failure, 1, now)).toEqual({
        action: "retry",
        at: new Date("2025-01-01T00:01:00Z"),
      });
      expect(retryDecision(failure, 4, now)).toEqual({
        action: "retry",
        at: new Date("2025-01-01T00:08:00Z"),
      });
      expect(retryDecision(failure, 5, now)).toEqual({
        action: "stop",
        cause: "attempts_exhausted",
      });
    },
  );
});
