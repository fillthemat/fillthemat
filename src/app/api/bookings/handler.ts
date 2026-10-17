import { randomUUID } from "node:crypto";
import type { attemptPendingForBooking } from "@/lib/email/deliveries";
import type {
  BookSlotResult,
  bookSlot,
  findBookingByIdempotencyKey,
} from "@/lib/schedule/book-slot";
import type { getPublicSchoolBySlug } from "@/lib/schools/public";
import type { emailBookingQuotaExceeded, recipientQuotaExceeded } from "@/lib/security/limits";
import type { verifyTurnstile } from "@/lib/security/turnstile";
import { getRequestIp } from "@/lib/request";
import { requestBodyTooLarge } from "@/lib/security/limits";
import { bookingRequestSchema } from "@/lib/validation";

export type BookingFailure = {
  event: "request.failed" | "delivery.degraded";
  requestId: string;
  method: "POST";
  route: "/api/bookings";
  operation: string;
  status: number;
  error: string;
  schoolId?: string;
  databaseCode?: string;
  diagnostic: { kind: "database"; code: string } | "unknown";
  deploymentEnvironment?: "production" | "preview" | "development";
  deploymentId?: string;
};

type Dependencies = {
  getPublicSchoolBySlug: typeof getPublicSchoolBySlug;
  verifyTurnstile: typeof verifyTurnstile;
  findBookingByIdempotencyKey: typeof findBookingByIdempotencyKey;
  emailBookingQuotaExceeded: typeof emailBookingQuotaExceeded;
  recipientQuotaExceeded: typeof recipientQuotaExceeded;
  bookSlot: typeof bookSlot;
  attemptPendingForBooking: typeof attemptPendingForBooking;
  logFailure: (record: BookingFailure) => void;
};

// Exact reviewed SQLSTATEs only. Never serialize messages, stacks, queries or
// arbitrary provider codes, including those carried by a wrapped cause.
const databaseCodes = new Set([
  "42703",
  "42P01",
  "23505",
  "23503",
  "23502",
  "40001",
  "40P01",
  "53300",
  "57014",
  "08006",
]);
function databaseCode(error: unknown): string | undefined {
  const visited = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8; depth++) {
    if (typeof current !== "object" || current === null || visited.has(current)) return;
    visited.add(current);
    if ("code" in current && typeof current.code === "string" && databaseCodes.has(current.code))
      return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
}

export function createBookingHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const requestId = randomUUID();
    let operation = "validation";
    let schoolId: string | undefined;
    const report = (error: string, status: number, exception?: unknown, degraded = false) => {
      const deployment = process.env.VERCEL_ENV;
      const diagnosticCode = databaseCode(exception);
      const record: BookingFailure = {
        event: degraded ? "delivery.degraded" : "request.failed",
        requestId,
        method: "POST",
        route: "/api/bookings",
        operation,
        status,
        error,
        diagnostic: diagnosticCode ? { kind: "database", code: diagnosticCode } : "unknown",
        ...(schoolId ? { schoolId } : {}),
        ...(diagnosticCode ? { databaseCode: diagnosticCode } : {}),
        ...(deployment === "production" || deployment === "preview" || deployment === "development"
          ? { deploymentEnvironment: deployment }
          : {}),
        ...(process.env.VERCEL_DEPLOYMENT_ID
          ? { deploymentId: process.env.VERCEL_DEPLOYMENT_ID }
          : {}),
      };
      try {
        dependencies.logFailure(record);
      } catch {
        // Retain the safe diagnostic if the configured sink fails. Neither sink
        // may turn a committed booking (or an expected refusal) into a failure.
        try {
          console.error(JSON.stringify(record));
        } catch {
          // No functioning log sink remains; preserve the request outcome.
        }
      }
    };
    const refuse = (error: string, status: number, exception?: unknown) => {
      report(error, status, exception);
      return Response.json({ error, requestId }, { status });
    };
    try {
      if (requestBodyTooLarge(request.headers.get("content-length")))
        return refuse("too_large", 413);
      let json: unknown;
      try {
        json = await request.json();
      } catch (error) {
        if (error instanceof SyntaxError) return refuse("invalid", 400);
        throw error;
      }
      const parsed = bookingRequestSchema.safeParse(json);
      if (!parsed.success) return refuse("invalid", 400);
      const body = parsed.data;
      operation = "school_lookup";
      const school = await dependencies.getPublicSchoolBySlug(body.schoolSlug);
      if (!school) return refuse("not_found", 404);
      schoolId = school.id;
      operation = "verification";
      if (!(await dependencies.verifyTurnstile(body.turnstileToken, getRequestIp(request.headers))))
        return refuse("verification_failed", 403);
      operation = "booking.idempotency_lookup";
      const existing = await dependencies.findBookingByIdempotencyKey(
        school.id,
        body.idempotencyKey,
      );
      let result: BookSlotResult;
      if (existing) {
        result = { ok: true, booking: existing, idempotent: true };
      } else {
        operation = "email_quota";
        if (await dependencies.emailBookingQuotaExceeded(school.id, body.contact.email))
          return refuse("rate_limited", 429);
        operation = "recipient_quota";
        if (await dependencies.recipientQuotaExceeded(school.id, body.contact.email))
          return refuse("rate_limited", 429);
        operation = "booking.create";
        result = await dependencies.bookSlot({
          school,
          offeringId: body.offeringId,
          slotId: body.slotId,
          idempotencyKey: body.idempotencyKey,
          contact: body.contact,
          participant: body.participant,
          landingSessionToken: body.landingSessionToken,
          conversationResumeToken: body.conversationResumeToken,
        });
      }
      if (!result.ok) {
        const status = result.code === "ineligible" || result.code === "invalid_slot" ? 400 : 409;
        return refuse(result.code === "already_booked" ? "acknowledged" : result.code, status);
      }
      if (!result.idempotent) {
        operation = "booking.confirmation_delivery";
        try {
          await dependencies.attemptPendingForBooking(result.booking.id);
        } catch (error) {
          // The transaction already committed and queued delivery. A failed
          // inline attempt must not invite another booking; the worker retries.
          report("delivery_retry_pending", 200, error, true);
        }
      }
      return Response.json({
        bookingId: result.booking.id,
        status: result.booking.status,
        startAt: result.booking.startAt,
        offeringName: result.booking.offeringNameSnapshot,
        participantName: result.booking.participantNameSnapshot,
        idempotent: result.idempotent,
      });
    } catch (error) {
      return refuse("internal_error", 500, error);
    }
  };
}
