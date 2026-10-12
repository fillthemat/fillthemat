import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { bookings, poppySessions, schools } from "@/db/schema";
import { buildBookingTerms } from "@/lib/ai/tools/prepare-booking";
import { isAgeEligible, listOpenSlots } from "@/lib/schedule/occurrences";
import { loadSchoolCatalog } from "@/lib/schools/public";
import { contactSchema, participantSchema } from "@/lib/validation";
import { readPoppyJson } from "./conversation-requests";
import { PoppyError, poppyErrorResponse } from "./errors";
import {
  openBookingOperation,
  proposeBookingOperation,
  supportsOperations,
} from "./operations";
import { checkPoppyRequest } from "./protected-request";

async function bookingCatalog(schoolId: string) {
  const [school] = await getDb()
    .select()
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  if (!school) throw new PoppyError("not_found", 404);
  const catalog = await loadSchoolCatalog(schoolId);
  const now = new Date();
  const available = catalog.offerings
    .filter((offering) => offering.active)
    .flatMap((offering) =>
      listOpenSlots({
        offeringId: offering.id,
        timezone: school.timezone,
        windows: catalog.windows,
        occurrences: catalog.occurrences,
        now,
      }).map((slot) => ({ offering, slot })),
    )
    .sort((a, b) => a.slot.startAt.getTime() - b.slot.startAt.getTime());
  return { school, available };
}

export const poppyBookingRequestSchema = z
  .object({
    occurrence_id: z.string().min(1).max(200),
    participant: participantSchema,
    contact: contactSchema,
  })
  .strict();

export async function poppyCreateBookingEndpoint(
  request: Request,
  schoolId: string,
) {
  const authorization = await checkPoppyRequest(request, schoolId);
  if (!authorization.ok) return authorization.response;
  try {
    const { principal } = authorization;
    if (!supportsOperations(principal.extensions))
      throw new PoppyError("extension_required", 403, undefined, {
        extension: "operations",
      });
    const parsed = poppyBookingRequestSchema.safeParse(
      await readPoppyJson(request),
    );
    if (!parsed.success) throw new PoppyError("invalid_request");
    const existing = await openBookingOperation(principal, parsed.data);
    if (existing)
      return Response.json(
        { operation: existing },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    const { school, available } = await bookingCatalog(schoolId);
    const occurrence = available.find(
      ({ slot }) => slot.slotId === parsed.data.occurrence_id,
    );
    if (!occurrence) throw new PoppyError("slot_unavailable", 409);
    if (!isAgeEligible(parsed.data.participant.age, occurrence.offering))
      throw new PoppyError("ineligible_age");
    const terms = buildBookingTerms(
      school,
      occurrence.offering,
      occurrence.slot,
      parsed.data.participant,
      parsed.data.contact,
    );
    const operation = await proposeBookingOperation({
      schoolId,
      sessionId: principal.sessionId,
      terms,
    });
    return Response.json(
      { operation },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return poppyErrorResponse(error, true);
  }
}

export async function poppyBookingStatusEndpoint(
  request: Request,
  schoolId: string,
  bookingId: string,
) {
  const authorization = await checkPoppyRequest(request, schoolId);
  if (!authorization.ok) return authorization.response;
  try {
    if (!z.uuid().safeParse(bookingId).success)
      throw new PoppyError("booking_not_found", 404);
    const { principal } = authorization;
    // Status is client + User owned, not Session owned like an Operation.
    // Only snapshot times and status are exposed, never Contact information.
    const [booking] = await getDb()
      .select({
        id: bookings.id,
        status: bookings.status,
        start: bookings.startAt,
        end: bookings.endAt,
        timezone: bookings.timezoneSnapshot,
      })
      .from(bookings)
      .innerJoin(
        poppySessions,
        and(
          eq(bookings.schoolId, poppySessions.schoolId),
          eq(bookings.poppySessionId, poppySessions.id),
        ),
      )
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.schoolId, schoolId),
          eq(bookings.channel, "poppy"),
          eq(bookings.poppyClientId, principal.clientId),
          eq(poppySessions.clientId, principal.clientId),
          eq(poppySessions.userId, principal.userId),
        ),
      )
      .limit(1);
    if (!booking) throw new PoppyError("booking_not_found", 404);
    return Response.json(
      {
        booking_id: booking.id,
        status: booking.status,
        occurrence: {
          start: booking.start.toISOString(),
          end: booking.end.toISOString(),
          time_zone: booking.timezone,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return poppyErrorResponse(error, true);
  }
}

export async function poppyTrialOccurrencesEndpoint(
  request: Request,
  schoolId: string,
) {
  const authorization = await checkPoppyRequest(request, schoolId);
  if (!authorization.ok) return authorization.response;
  try {
    const { available } = await bookingCatalog(schoolId);
    return Response.json(
      {
        occurrences: available.map(({ offering, slot }) => ({
          occurrence_id: slot.slotId,
          start: slot.startAt.toISOString(),
          end: slot.endAt.toISOString(),
          time_zone: slot.timezone,
          remaining_capacity: slot.remaining,
          offering: {
            id: offering.id,
            name: offering.name,
            description: offering.description,
            minimum_age: offering.minimumAge,
            maximum_age: offering.maximumAge,
          },
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return poppyErrorResponse(error, true);
  }
}
