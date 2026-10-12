import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

// Exercise the actual HTTP adapter and production console sink, with only
// domain/vendor boundaries replaced (no database or live vendors).
const dependencies = vi.hoisted(() => ({
  getPublicSchoolBySlug: vi.fn(),
  verifyTurnstile: vi.fn(),
  findBookingByIdempotencyKey: vi.fn(),
  emailBookingQuotaExceeded: vi.fn(),
  recipientQuotaExceeded: vi.fn(),
  bookSlot: vi.fn(),
  attemptPendingForBooking: vi.fn(),
}));
vi.mock("@/lib/schools/public", () => ({
  getPublicSchoolBySlug: dependencies.getPublicSchoolBySlug,
}));
vi.mock("@/lib/security/turnstile", () => ({
  verifyTurnstile: dependencies.verifyTurnstile,
}));
vi.mock("@/lib/security/limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/limits")>()),
  emailBookingQuotaExceeded: dependencies.emailBookingQuotaExceeded,
  recipientQuotaExceeded: dependencies.recipientQuotaExceeded,
}));
vi.mock("@/lib/schedule/book-slot", () => ({
  bookSlot: dependencies.bookSlot,
  findBookingByIdempotencyKey: dependencies.findBookingByIdempotencyKey,
}));
vi.mock("@/lib/email/deliveries", () => ({
  attemptPendingForBooking: dependencies.attemptPendingForBooking,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_DEPLOYMENT_ID", "deployment-test-id");
  dependencies.getPublicSchoolBySlug.mockResolvedValue({ id: "school-id" });
  dependencies.verifyTurnstile.mockResolvedValue(true);
  dependencies.findBookingByIdempotencyKey.mockResolvedValue(null);
  dependencies.emailBookingQuotaExceeded.mockResolvedValue(false);
  dependencies.recipientQuotaExceeded.mockResolvedValue(false);
  dependencies.bookSlot.mockResolvedValue({
    ok: true,
    idempotent: false,
    booking: { id: "booking-id", status: "booked" },
  });
  dependencies.attemptPendingForBooking.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each(["unexpected", "degraded"])(
  "emits %s booking diagnostics as one parseable JSON string, not label-plus-object text",
  async (outcome) => {
    const exception = new Error("SENTINEL_PRIVATE_SQL\nSENTINEL_PROVIDER", {
      cause: { code: "42703", params: ["SENTINEL_SECRET"] },
    });
    if (outcome === "unexpected")
      dependencies.bookSlot.mockRejectedValue(exception);
    else dependencies.attemptPendingForBooking.mockRejectedValue(exception);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(
      new Request("https://example.test/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
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
        }),
      }),
    );
    const unexpected = outcome === "unexpected";
    expect(response.status).toBe(unexpected ? 500 : 200);
    const envelope = await response.json();
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.any(String));
    const line = log.mock.calls[0][0];
    expect(line).not.toContain("\n");
    expect(line).not.toContain("SENTINEL");
    const record = JSON.parse(line);
    expect(record).toEqual({
      event: unexpected ? "request.failed" : "delivery.degraded",
      operation: unexpected
        ? "booking.create"
        : "booking.confirmation_delivery",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      method: "POST",
      route: "/api/bookings",
      status: unexpected ? 500 : 200,
      error: unexpected ? "internal_error" : "delivery_retry_pending",
      diagnostic: { kind: "database", code: "42703" },
      databaseCode: "42703",
      schoolId: "school-id",
      deploymentEnvironment: "preview",
      deploymentId: "deployment-test-id",
    });
    if (unexpected)
      expect(envelope).toEqual({
        error: "internal_error",
        requestId: record.requestId,
      });
    else expect(envelope.bookingId).toBe("booking-id");
  },
);
