import { afterEach, describe, expect, it, vi } from "vitest";
import { submitBooking } from "@/components/booking-submission";
import { createBookingHandler } from "./handler";

const body = {
  schoolSlug: "demo",
  offeringId: "00000000-0000-4000-8000-000000000001",
  slotId: "trial-occurrence",
  idempotencyKey: "00000000-0000-4000-8000-000000000002",
  contact: {
    name: "SENTINEL_NAME",
    email: "sentinel@example.test",
    phone: "SENTINEL_PHONE",
  },
  participant: { name: "SENTINEL_PARTICIPANT", age: 12 },
  turnstileToken: "SENTINEL_TOKEN",
  landingSessionToken: "SENTINEL_SESSION",
  conversationResumeToken: "SENTINEL_RESUME",
};

function request(payload: string = JSON.stringify(body), headers = {}) {
  return new Request("https://example.test/api/bookings", {
    method: "POST",
    body: payload,
    headers: {
      "content-type": "application/json",
      "x-request-id": "SENTINEL_INBOUND",
      "x-forwarded-for": "SENTINEL_IP",
      authorization: "Bearer SENTINEL_BEARER",
      cookie: "session=SENTINEL_COOKIE",
      ...headers,
    },
  });
}

describe("booking HTTP failures", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("logs the standard diagnostic and trusted deployment context", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "deployment-test-id");
    const { dependencies, handler } = setup();
    dependencies.bookSlot.mockRejectedValue(
      new Error("private", {
        cause: { code: "42703" },
      }),
    );
    const response = await handler(request());
    const json = await response.json();
    expect(dependencies.logFailure).toHaveBeenCalledExactlyOnceWith({
      event: "request.failed",
      operation: "booking.create",
      requestId: json.requestId,
      method: "POST",
      route: "/api/bookings",
      status: 500,
      error: "internal_error",
      diagnostic: { kind: "database", code: "42703" },
      databaseCode: "42703",
      schoolId: "school-internal-id",
      deploymentEnvironment: "preview",
      deploymentId: "deployment-test-id",
    });
  });
  it("carries the unexpected failure's log request ID into the client support message", async () => {
    const { dependencies, handler } = setup();
    dependencies.bookSlot.mockRejectedValue(
      new Error("SENTINEL_SQL", {
        cause: {
          code: "42703",
          query: "SENTINEL_QUERY",
          params: ["SENTINEL_CONTACT"],
        },
      }),
    );
    const setError = vi.fn();
    const onBooked = vi.fn();
    await submitBooking({
      key: { current: body.idempotencyKey },
      buildBody: () => body,
      fetcher: vi.fn().mockImplementation(() => handler(request())),
      setPending: vi.fn(),
      setError,
      resetVerification: vi.fn(),
      onBooked,
    });
    const record = dependencies.logFailure.mock.calls[0][0];
    expect(record.databaseCode).toBe("42703");
    expect(setError).toHaveBeenLastCalledWith(
      expect.stringContaining(`Support reference: ${record.requestId}.`),
    );
    expect(JSON.stringify([record, setError.mock.calls])).not.toContain("SENTINEL");
    expect(onBooked).not.toHaveBeenCalled();
  });

  it("keeps request contexts separate across concurrent failures", async () => {
    const { dependencies, handler } = setup();
    dependencies.getPublicSchoolBySlug.mockResolvedValue(null);
    const responses = await Promise.all([handler(request()), handler(request())]);
    const envelopes = await Promise.all(responses.map((response) => response.json()));
    expect(envelopes[0].requestId).not.toBe(envelopes[1].requestId);
    expect(dependencies.logFailure.mock.calls.map(([record]) => record.requestId)).toEqual(
      envelopes.map((envelope) => envelope.requestId),
    );
    expect(dependencies.logFailure.mock.calls.every(([record]) => !record.schoolId)).toBe(true);
  });

  it("preserves the recipient quota refusal", async () => {
    const { dependencies, handler } = setup();
    dependencies.recipientQuotaExceeded.mockResolvedValue(true);
    const response = await handler(request());
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("rate_limited");
    expect(dependencies.logFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ operation: "recipient_quota" }),
    );
    expect(dependencies.bookSlot).not.toHaveBeenCalled();
  });

  it("does not emit arbitrary diagnostic codes or cycle through causes", async () => {
    const { dependencies, handler } = setup();
    const error: { code: string; cause?: unknown } = { code: "SENTINEL_CODE" };
    error.cause = error;
    dependencies.bookSlot.mockRejectedValue(error);
    expect((await handler(request())).status).toBe(500);
    expect(dependencies.logFailure.mock.calls[0][0]).not.toHaveProperty("databaseCode");
    expect(dependencies.logFailure.mock.calls[0][0].diagnostic).toBe("unknown");
    expect(JSON.stringify(dependencies.logFailure.mock.calls)).not.toContain("SENTINEL");
  });
  it("omits unavailable deployment fields and maps code-shaped non-allowlisted codes to unknown", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");
    const { dependencies, handler } = setup();
    dependencies.bookSlot.mockRejectedValue({ code: "ABCDE" });
    expect((await handler(request())).status).toBe(500);
    const record = dependencies.logFailure.mock.calls[0][0];
    expect(record.diagnostic).toBe("unknown");
    expect(record).not.toHaveProperty("databaseCode");
    expect(record).not.toHaveProperty("deploymentEnvironment");
    expect(record).not.toHaveProperty("deploymentId");
  });
  function setup() {
    const dependencies = {
      getPublicSchoolBySlug: vi.fn().mockResolvedValue({ id: "school-internal-id" }),
      verifyTurnstile: vi.fn().mockResolvedValue(true),
      findBookingByIdempotencyKey: vi.fn().mockResolvedValue(null),
      emailBookingQuotaExceeded: vi.fn().mockResolvedValue(false),
      recipientQuotaExceeded: vi.fn().mockResolvedValue(false),
      bookSlot: vi.fn().mockResolvedValue({
        ok: true,
        idempotent: false,
        booking: {
          id: "booking-id",
          status: "confirmed",
          startAt: new Date("2026-10-12T10:00:00Z"),
          offeringNameSnapshot: "Trial",
          participantNameSnapshot: "Participant",
        },
      }),
      attemptPendingForBooking: vi.fn().mockResolvedValue(undefined),
      logFailure: vi.fn(),
    };
    return { dependencies, handler: createBookingHandler(dependencies) };
  }

  it("returns an existing booking before quotas can refuse its retry", async () => {
    const { dependencies, handler } = setup();
    const result = await dependencies.bookSlot();
    dependencies.bookSlot.mockClear();
    dependencies.findBookingByIdempotencyKey.mockResolvedValue(result.booking);
    dependencies.emailBookingQuotaExceeded.mockResolvedValue(true);
    dependencies.recipientQuotaExceeded.mockResolvedValue(true);
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      bookingId: "booking-id",
      idempotent: true,
    });
    expect(dependencies.findBookingByIdempotencyKey).toHaveBeenCalledExactlyOnceWith(
      "school-internal-id",
      body.idempotencyKey,
    );
    expect(dependencies.emailBookingQuotaExceeded).not.toHaveBeenCalled();
    expect(dependencies.recipientQuotaExceeded).not.toHaveBeenCalled();
    expect(dependencies.bookSlot).not.toHaveBeenCalled();
    expect(dependencies.attemptPendingForBooking).not.toHaveBeenCalled();
  });

  it.each([
    ["too_large", 413],
    ["invalid", 400],
    ["not_found", 404],
    ["verification_failed", 403],
    ["rate_limited", 429],
    ["acknowledged", 409],
    ["ineligible", 400],
    ["invalid_slot", 400],
    ["slot_unavailable", 409],
    ["school_not_public", 409],
  ])("preserves the %s refusal and emits one correlated record", async (code, status) => {
    const { dependencies: d, handler } = setup();
    let input = request();
    if (code === "too_large") input = request(undefined, { "content-length": "999999999" });
    else if (code === "invalid") input = request("{}");
    else if (code === "not_found") d.getPublicSchoolBySlug.mockResolvedValue(null);
    else if (code === "verification_failed") d.verifyTurnstile.mockResolvedValue(false);
    else if (code === "rate_limited") d.emailBookingQuotaExceeded.mockResolvedValue(true);
    else
      d.bookSlot.mockResolvedValue({
        ok: false,
        code: code === "acknowledged" ? "already_booked" : code,
      });
    const response = await handler(input);
    const json = await response.json();
    expect(response.status).toBe(status);
    expect(json).toEqual({ error: code, requestId: expect.any(String) });
    expect(d.logFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        error: code,
        status,
        requestId: json.requestId,
      }),
    );
    expect(JSON.stringify(d.logFailure.mock.calls)).not.toContain("SENTINEL");
    expect(d.attemptPendingForBooking).not.toHaveBeenCalled();
  });

  it("treats malformed JSON as invalid and ignores inbound correlation IDs", async () => {
    const { dependencies, handler } = setup();
    const response = await handler(request("{"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(dependencies.getPublicSchoolBySlug).not.toHaveBeenCalled();
  });

  it.each([
    "verifyTurnstile",
    "findBookingByIdempotencyKey",
    "emailBookingQuotaExceeded",
    "recipientQuotaExceeded",
    "bookSlot",
  ] as const)("catches unexpected %s failures with resolved school context", async (stage) => {
    const { dependencies, handler } = setup();
    dependencies[stage].mockRejectedValue(new Error("SENTINEL_SECRET"));
    const response = await handler(request());
    expect(response.status).toBe(500);
    expect(dependencies.logFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        schoolId: "school-internal-id",
        error: "internal_error",
      }),
    );
    expect(
      JSON.stringify([await response.json(), dependencies.logFailure.mock.calls]),
    ).not.toContain("SENTINEL");
  });

  it.each([false, true])(
    "preserves successful booking output (idempotent: %s)",
    async (idempotent) => {
      const { dependencies, handler } = setup();
      const result = await dependencies.bookSlot();
      dependencies.bookSlot.mockResolvedValue({ ...result, idempotent });
      const response = await handler(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        bookingId: "booking-id",
        status: "confirmed",
        startAt: "2026-10-12T10:00:00.000Z",
        offeringName: "Trial",
        participantName: "Participant",
        idempotent,
      });
      expect(dependencies.attemptPendingForBooking).toHaveBeenCalledTimes(idempotent ? 0 : 1);
      expect(dependencies.logFailure).not.toHaveBeenCalled();
    },
  );

  it("reports degraded delivery without claiming a committed booking failed", async () => {
    const { dependencies, handler } = setup();
    dependencies.attemptPendingForBooking.mockRejectedValue(
      Object.assign(new Error("SENTINEL_PROVIDER"), { code: "SENTINEL_CODE" }),
    );
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect((await response.json()).bookingId).toBe("booking-id");
    expect(dependencies.logFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: "delivery.degraded",
        operation: "booking.confirmation_delivery",
        error: "delivery_retry_pending",
        diagnostic: "unknown",
        status: 200,
      }),
    );
    expect(JSON.stringify(dependencies.logFailure.mock.calls)).not.toContain("SENTINEL");
  });
  it("preserves a saved booking and safely falls back when the logger throws", async () => {
    const { dependencies, handler } = setup();
    dependencies.attemptPendingForBooking.mockRejectedValue(new Error("SENTINEL_PROVIDER"));
    dependencies.logFailure.mockImplementation(() => {
      throw new Error("SENTINEL_LOGGER");
    });
    const fallbackLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handler(request());
      expect(response.status).toBe(200);
      expect((await response.json()).bookingId).toBe("booking-id");
      expect(dependencies.logFailure).toHaveBeenCalledTimes(1);
      expect(fallbackLog).toHaveBeenCalledExactlyOnceWith(expect.any(String));
      expect(JSON.parse(fallbackLog.mock.calls[0][0])).toMatchObject({
        event: "delivery.degraded",
        error: "delivery_retry_pending",
        diagnostic: "unknown",
      });
      expect(JSON.stringify(fallbackLog.mock.calls)).not.toContain("SENTINEL");
    } finally {
      fallbackLog.mockRestore();
    }
  });
  it.each(["invalid", "internal_error", "delivery_retry_pending"])(
    "preserves the %s outcome even when both log sinks throw",
    async (error) => {
      const { dependencies, handler } = setup();
      dependencies.logFailure.mockImplementation(() => {
        throw new Error("SENTINEL_LOGGER");
      });
      if (error === "internal_error")
        dependencies.bookSlot.mockRejectedValue(new Error("SENTINEL_DB"));
      if (error === "delivery_retry_pending")
        dependencies.attemptPendingForBooking.mockRejectedValue(new Error("SENTINEL_PROVIDER"));
      const fallbackLog = vi.spyOn(console, "error").mockImplementation(() => {
        throw new Error("SENTINEL_FALLBACK");
      });
      try {
        const response = await handler(request(error === "invalid" ? "{}" : undefined));
        expect(response.status).toBe(
          error === "invalid" ? 400 : error === "internal_error" ? 500 : 200,
        );
        const envelope = await response.json();
        if (error === "delivery_retry_pending") expect(envelope.bookingId).toBe("booking-id");
        else
          expect(envelope).toMatchObject({
            error,
            requestId: expect.any(String),
          });
        expect(dependencies.logFailure).toHaveBeenCalledTimes(1);
        expect(fallbackLog).toHaveBeenCalledTimes(1);
      } finally {
        fallbackLog.mockRestore();
      }
    },
  );
  it("correlates a wrapped database failure without exposing exception data", async () => {
    const logFailure = vi.fn();
    const handler = createBookingHandler({
      getPublicSchoolBySlug: vi.fn().mockRejectedValue(
        new Error("SENTINEL_SQL", {
          cause: Object.assign(new Error("SENTINEL_PARAMETERS"), {
            code: "42703",
          }),
        }),
      ),
      verifyTurnstile: vi.fn(),
      findBookingByIdempotencyKey: vi.fn(),
      emailBookingQuotaExceeded: vi.fn(),
      recipientQuotaExceeded: vi.fn(),
      bookSlot: vi.fn(),
      attemptPendingForBooking: vi.fn(),
      logFailure,
    });
    const response = await handler(request());
    const json = await response.json();
    expect(response.status).toBe(500);
    expect(json).toEqual({
      error: "internal_error",
      requestId: expect.any(String),
    });
    expect(json.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(logFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        requestId: json.requestId,
        method: "POST",
        route: "/api/bookings",
        operation: "school_lookup",
        status: 500,
        error: "internal_error",
        databaseCode: "42703",
      }),
    );
    expect(JSON.stringify([json, logFailure.mock.calls])).not.toContain("SENTINEL");
  });
});
