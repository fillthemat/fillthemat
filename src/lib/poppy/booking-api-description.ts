import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { schools } from "@/db/schema";
import { isSchoolPoppyOn } from "./issuer";
import { poppyAppOrigin } from "./urls";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: "string" };
const dateTime = { type: "string", format: "date-time" };
const nullableText = { type: ["string", "null"] };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  required: Object.keys(properties),
  properties,
});
const jsonResponse = (description: string, schema: unknown) => ({
  description,
  content: { "application/json": { schema } },
});
const body = (schema: unknown) => ({
  required: true,
  content: { "application/json": { schema } },
});
const idParameter = (name: string, format?: string) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string", ...(format ? { format } : {}) },
});
const errors = {
  "400": jsonResponse("Invalid request", ref("Error")),
  "401": jsonResponse("Invalid Session Token or DPoP proof", ref("Error")),
  "404": jsonResponse("Not found or not owned by this caller", ref("Error")),
  "503": jsonResponse(
    "Temporary failure; retry with a fresh DPoP proof",
    ref("Error"),
  ),
};

/** Public description; API calls themselves require a Session Token and proof. */
export async function readBookingApiDescription(schoolId: string) {
  if (!(await isSchoolPoppyOn(schoolId))) return null;
  const [school] = await getDb()
    .select({ name: schools.name })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  if (!school) return null;
  return {
    openapi: "3.1.0",
    info: { title: `${school.name} trial booking API`, version: "1.0.0" },
    servers: [{ url: `${poppyAppOrigin()}/poppy/schools/${schoolId}` }],
    security: [{ SessionToken: [], DPoPProof: [] }],
    paths: {
      "/trial-occurrences": {
        get: {
          operationId: "listTrialOccurrences",
          summary: "List bookable Trial Occurrences",
          description:
            "Upcoming trials with remaining capacity and active Trial Offering eligibility. Listing does not reserve capacity.",
          responses: {
            ...errors,
            "200": jsonResponse(
              "Available trials",
              object({
                occurrences: { type: "array", items: ref("TrialOccurrence") },
              }),
            ),
          },
        },
      },
      "/bookings": {
        post: {
          operationId: "proposeBooking",
          summary: "Propose a booking; never books immediately",
          description:
            "Requires client Operations v1 support. Returns an Operation requiring explicit user approval. Confirm its exact revision at POST /operations/{operationId}/confirm. Reuses identical open actions in this Session, including conversation proposals. No capacity is reserved. A new Session cannot confirm the original Session's Operation.",
          requestBody: body(ref("BookingRequest")),
          responses: {
            ...errors,
            "202": jsonResponse(
              "Booking Operation awaiting user approval",
              object({ operation: ref("Operation") }),
            ),
            "403": jsonResponse(
              "extension_required (operations)",
              ref("Error"),
            ),
            "409": jsonResponse("Trial Occurrence unavailable", ref("Error")),
            "413": jsonResponse("JSON body exceeds 32768 bytes", ref("Error")),
            "429": {
              ...jsonResponse("Proposal budget exhausted", ref("Error")),
              headers: {
                "Retry-After": {
                  schema: { type: "integer" },
                  description: "Seconds until retry",
                },
              },
            },
          },
        },
      },
      "/bookings/{bookingId}": {
        parameters: [idParameter("bookingId", "uuid")],
        get: {
          operationId: "getBookingStatus",
          summary: "Read booking status and occurrence time",
          description:
            "Only the creating client and User at this School can read status, including from a new Session. No lookup by email.",
          responses: {
            ...errors,
            "200": jsonResponse("Booking status", ref("BookingStatus")),
          },
        },
      },
      "/operations/{operationId}": {
        parameters: [idParameter("operationId")],
        get: {
          operationId: "getOperation",
          summary: "Read an Operation in its originating Session",
          responses: {
            ...errors,
            "403": jsonResponse("extension_required", ref("Error")),
            "200": jsonResponse("Current Operation", ref("Operation")),
          },
        },
      },
      "/operations/{operationId}/confirm": {
        parameters: [idParameter("operationId")],
        post: {
          operationId: "confirmOperation",
          summary: "Confirm the exact user-approved revision at most once",
          description:
            "The Personal Agent must show the School and complete summary to its user and obtain approval. Conversation text never confirms. Repeated confirmation returns current state without another booking. Uncertain effects remain in_progress; read until final. Successful result.data.booking_id identifies the booking.",
          requestBody: body(
            object({
              revision: { type: "integer", minimum: 1 },
              approved_by: {
                type: "string",
                enum: ["user", "standing_permission"],
              },
            }),
          ),
          responses: {
            ...errors,
            "200": jsonResponse(
              "Current Operation (may still be in_progress)",
              ref("Operation"),
            ),
            "403": jsonResponse(
              "user_approval_required or extension_required",
              ref("Error"),
            ),
            "409": jsonResponse(
              "terms_changed; approve the returned revision",
              object({ error: text, operation: ref("Operation") }),
            ),
          },
        },
      },
      "/operations/{operationId}/cancel": {
        parameters: [idParameter("operationId")],
        post: {
          operationId: "cancelOperation",
          summary: "Decline a proposed Operation, not an already booked trial",
          responses: {
            ...errors,
            "403": jsonResponse("extension_required", ref("Error")),
            "200": jsonResponse("Current Operation", ref("Operation")),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        SessionToken: {
          type: "http",
          scheme: "DPoP",
          description:
            "Authorization: DPoP <opaque Session Token> from this School's Poppy issuer; never Bearer.",
        },
        DPoPProof: {
          type: "apiKey",
          in: "header",
          name: "DPoP",
          description:
            "Fresh signed RFC 9449 proof bound to the Session key, method, configured URL (without query/fragment), and access-token hash (ath).",
        },
      },
      schemas: {
        Error: { ...object({ error: text }), additionalProperties: true },
        Participant: object({
          name: { ...text, minLength: 1, maxLength: 80 },
          age: { type: "integer", minimum: 0, maximum: 99 },
        }),
        Contact: object({
          name: { ...text, minLength: 1, maxLength: 80 },
          email: { ...text, format: "email", minLength: 3, maxLength: 254 },
          phone: { ...text, minLength: 7, maxLength: 32 },
        }),
        BookingRequest: {
          ...object({
            occurrence_id: { ...text, minLength: 1, maxLength: 200 },
            participant: ref("Participant"),
            contact: ref("Contact"),
          }),
          additionalProperties: false,
        },
        OccurrenceTime: object({
          start: dateTime,
          end: dateTime,
          time_zone: text,
        }),
        TrialOccurrence: object({
          occurrence_id: text,
          start: dateTime,
          end: dateTime,
          time_zone: text,
          remaining_capacity: { type: "integer", minimum: 1 },
          offering: object({
            id: { ...text, format: "uuid" },
            name: text,
            description: nullableText,
            minimum_age: { type: ["integer", "null"] },
            maximum_age: { type: ["integer", "null"] },
          }),
        }),
        BookingStatus: object({
          booking_id: { ...text, format: "uuid" },
          status: {
            type: "string",
            enum: ["booked", "cancelled", "showed", "no_show"],
          },
          occurrence: ref("OccurrenceTime"),
        }),
        Operation: {
          ...object({
            operation_id: text,
            revision: { type: "integer", minimum: 1 },
            state: {
              type: "string",
              enum: [
                "proposed",
                "in_progress",
                "succeeded",
                "failed",
                "cancelled",
                "expired",
              ],
            },
            summary: text,
            user_approval_required: { type: "boolean" },
            expires_at: dateTime,
            terms: {
              type: "object",
              description:
                "Exact School, Offering, occurrence, Participant, Contact, pricing, guidance and location to be approved.",
            },
            confirmation: {
              anyOf: [
                { type: "null" },
                object({
                  revision: { type: "integer" },
                  approved_by: {
                    type: "string",
                    enum: ["user", "standing_permission"],
                  },
                  confirmed_at: dateTime,
                }),
              ],
            },
            result: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  required: ["summary"],
                  properties: {
                    summary: text,
                    data: { type: "object", additionalProperties: true },
                  },
                },
              ],
            },
          }),
        },
      },
    },
  };
}
