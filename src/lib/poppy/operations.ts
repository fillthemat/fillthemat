import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Transaction, withTransaction } from "@/db";
import {
  type PoppyOperation,
  poppyOperationRevisions,
  poppyOperations,
  poppySessions,
  schools,
} from "@/db/schema";
import type { BookingTerms } from "@/lib/ai/tools/prepare-booking";
import { bookSlot } from "@/lib/schedule/book-slot";
import {
  emailBookingQuotaExceeded,
  recipientQuotaExceeded,
} from "@/lib/security/limits";
import { contactSchema, participantSchema } from "@/lib/validation";
import { consumeProposalBudget, reserveBookingBudgets } from "./budgets";
import { PoppyError } from "./errors";
import type { PoppyPrincipal } from "./protected-request";

export const POPPY_OPERATION_LIFETIME_MS = 30 * 60 * 1000;

export function supportsOperations(extensions: Record<string, unknown>) {
  const operations = extensions.operations;
  return (
    typeof operations === "object" &&
    operations !== null &&
    "version" in operations &&
    operations.version === "1"
  );
}

export function publicOperation(row: PoppyOperation) {
  return {
    operation_id: row.id,
    revision: row.revision,
    state: row.state,
    summary: row.summary,
    terms: row.terms,
    expires_at: row.expiresAt.toISOString(),
    user_approval_required: row.userApprovalRequired,
    confirmation: row.confirmation,
    result: row.result,
  };
}

function bookingSummary(terms: BookingTerms) {
  return `Book ${terms.offering.name} at ${terms.school.name} for ${terms.participant.name}, age ${terms.participant.age}, from ${terms.occurrence.start} to ${terms.occurrence.end} (${terms.occurrence.time_zone}). Contact: ${terms.contact.name}, ${terms.contact.phone}, ${terms.contact.email}. Location: ${terms.location || "not specified"}. Pricing: ${terms.pricing || "not specified; no payment is collected"}. Trial guidance: ${terms.guidance || "none specified"}. Approval is for this booking only, not marketing or follow-ups.`;
}

/** Called inside the Turn commit. The originating receipt, not the polling
 * Session, supplies ownership. This seam also accepts API proposals later. */
export async function proposeBookingOperation(
  input: {
    schoolId: string;
    sessionId: string;
    conversationId?: string;
    terms: BookingTerms;
    now?: Date;
  },
  options: { transaction?: Transaction } = {},
) {
  return withTransaction(async (tx) => {
    const now = input.now ?? new Date();
    // Serializes conversation/API proposals within this Session without a
    // large index on URL + opaque User identity.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.sessionId}, 0))`,
    );
    const open = await tx
      .select()
      .from(poppyOperations)
      .where(
        and(
          eq(poppyOperations.schoolId, input.schoolId),
          eq(poppyOperations.sessionId, input.sessionId),
          eq(poppyOperations.kind, "booking"),
          inArray(poppyOperations.state, ["proposed", "in_progress"]),
        ),
      )
      .for("update");
    const same = open.find((row) => isDeepStrictEqual(row.terms, input.terms));
    if (same && (same.state === "in_progress" || same.expiresAt > now))
      return publicOperation(same);
    const current = input.conversationId
      ? open.find(
          (row) =>
            row.state === "proposed" &&
            row.conversationId === input.conversationId &&
            row.expiresAt > now,
        )
      : undefined;
    const values = {
      revision: (current?.revision ?? 0) + 1,
      summary: bookingSummary(input.terms),
      terms: input.terms,
      expiresAt: new Date(now.getTime() + POPPY_OPERATION_LIFETIME_MS),
      updatedAt: now,
    };
    await consumeProposalBudget(input, tx, now);
    const [row] = current
      ? await tx
          .update(poppyOperations)
          .set(values)
          .where(eq(poppyOperations.id, current.id))
          .returning()
      : await tx
          .insert(poppyOperations)
          .values({
            ...values,
            id: `op_${randomUUID()}`,
            schoolId: input.schoolId,
            sessionId: input.sessionId,
            conversationId: input.conversationId,
            kind: "booking",
            state: "proposed",
          })
          .returning();
    if (!row) throw new Error("operation_write_failed");
    await tx.insert(poppyOperationRevisions).values({
      operationId: row.id,
      revision: row.revision,
      summary: row.summary,
      terms: row.terms,
      expiresAt: row.expiresAt,
    });
    return publicOperation(row);
  }, options);
}

const bookingTermsSchema = z.object({
  school: z.object({ id: z.uuid(), name: z.string() }),
  offering: z.object({ id: z.uuid(), name: z.string() }),
  occurrence: z.object({
    slot_id: z.string(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    time_zone: z.string(),
  }),
  participant: participantSchema,
  contact: contactSchema,
  pricing: z.string().nullable(),
  guidance: z.string().nullable(),
  location: z.string(),
});

async function ownedOperation(
  principal: PoppyPrincipal,
  id: string,
  tx: Transaction,
) {
  const [row] = await tx
    .select()
    .from(poppyOperations)
    .where(
      and(
        eq(poppyOperations.id, id),
        eq(poppyOperations.schoolId, principal.schoolId),
        eq(poppyOperations.sessionId, principal.sessionId),
      ),
    )
    .for("update");
  if (!row) throw new PoppyError("operation_not_found", 404);
  if (row.state === "proposed" && row.expiresAt.getTime() <= Date.now()) {
    const [expired] = await tx
      .update(poppyOperations)
      .set({
        state: "expired",
        result: {
          summary:
            "The proposal expired before confirmation. No booking was made.",
        },
        updatedAt: new Date(),
      })
      .where(eq(poppyOperations.id, row.id))
      .returning();
    if (!expired) throw new Error("operation_missing");
    return expired;
  }
  return row;
}

export async function readOperation(
  principal: PoppyPrincipal,
  id: string,
  cancel = false,
) {
  return getDb().transaction(async (tx) => {
    const row = await ownedOperation(principal, id, tx);
    if (cancel && row.state === "proposed") {
      const [cancelled] = await tx
        .update(poppyOperations)
        .set({
          state: "cancelled",
          result: {
            summary:
              "The proposal was declined before confirmation. No booking was made.",
          },
          updatedAt: new Date(),
        })
        .where(eq(poppyOperations.id, id))
        .returning();
      if (!cancelled) throw new Error("operation_missing");
      return publicOperation(cancelled);
    }
    return publicOperation(row);
  });
}

export type OperationConfirmation = {
  revision: number;
  approved_by: "user" | "standing_permission";
};
export async function confirmOperation(
  principal: PoppyPrincipal,
  id: string,
  input: OperationConfirmation,
) {
  const claimed = await getDb().transaction(async (tx) => {
    const row = await ownedOperation(principal, id, tx);
    // Final/in-progress confirms are no-ops, even with a stale revision or
    // standing permission. Only a proposed action can be authorized anew.
    if (row.state !== "proposed") return { row, execute: false };
    if (row.revision !== input.revision)
      return { row, execute: false, error: "terms_changed" as const };
    if (input.approved_by !== "user")
      throw new PoppyError("user_approval_required", 403);
    const [confirmed] = await tx
      .update(poppyOperations)
      .set({
        state: "in_progress",
        confirmation: {
          revision: row.revision,
          approved_by: "user",
          confirmed_at: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(poppyOperations.id, id))
      .returning();
    if (!confirmed) throw new Error("operation_missing");
    return { row: confirmed, execute: true };
  });
  if (claimed.error)
    return { error: claimed.error, operation: publicOperation(claimed.row) };
  if (!claimed.execute) return { operation: publicOperation(claimed.row) };
  // Confirmation is durable before the effect. Unexpected/uncertain failure
  // leaves in_progress rather than falsely claiming no booking happened.
  const result = await getDb().transaction(async (tx) => {
    const row = await ownedOperation(principal, id, tx);
    const [session] = await tx
      .select()
      .from(poppySessions)
      .where(eq(poppySessions.id, row.sessionId));
    const [school] = await tx
      .select()
      .from(schools)
      .where(eq(schools.id, row.schoolId));
    if (!school || !session || row.kind !== "booking")
      throw new Error("operation_effect_unavailable");
    const terms = bookingTermsSchema.parse(row.terms);
    const now = new Date();
    const budget = await reserveBookingBudgets(
      {
        schoolId: school.id,
        clientId: session.clientId,
        userId: session.userId,
      },
      school.timezone,
      tx,
      now,
    );
    // The School lock also serializes Poppy email-cap checks across clients.
    const limited =
      (await emailBookingQuotaExceeded(school.id, terms.contact.email, now, {
        transaction: tx,
      })) ||
      (await recipientQuotaExceeded(school.id, terms.contact.email, now, {
        transaction: tx,
      }));
    const booked =
      limited || budget.code
        ? null
        : await bookSlot(
            {
              school,
              channel: "poppy",
              offeringId: terms.offering.id,
              slotId: terms.occurrence.slot_id,
              idempotencyKey: `poppy-operation/${id}`,
              contact: terms.contact,
              participant: terms.participant,
              conversationId: row.conversationId ?? undefined,
              poppy: { clientId: session.clientId, sessionId: session.id },
              expectedTerms: {
                schoolName: terms.school.name,
                offeringName: terms.offering.name,
                start: terms.occurrence.start,
                end: terms.occurrence.end,
                timezone: terms.occurrence.time_zone,
                pricing: terms.pricing,
                guidance: terms.guidance,
                location: terms.location,
              },
              now,
            },
            { transaction: tx },
          );
    if (booked?.ok) await budget.consume?.();
    const [finished] = await tx
      .update(poppyOperations)
      .set(
        booked?.ok
          ? {
              state: "succeeded",
              bookingId: booked.booking.id,
              result: {
                summary: `Booked ${terms.offering.name} at ${terms.school.name} for ${terms.participant.name}. Confirmation will be emailed to ${terms.contact.email}.`,
                data: { booking_id: booked.booking.id },
              },
              updatedAt: now,
            }
          : {
              state: "failed",
              result: {
                summary:
                  budget.summary ??
                  (limited
                    ? "No booking was made: the Contact's email booking or delivery limit was reached."
                    : bookingFailureSummary(
                        booked?.code ?? "slot_unavailable",
                      )),
                data: {
                  code: budget.code ?? (limited ? "email_limit" : booked?.code),
                },
              },
              updatedAt: now,
            },
      )
      .where(eq(poppyOperations.id, id))
      .returning();
    if (!finished) throw new Error("operation_missing");
    return publicOperation(finished);
  });
  return { operation: result };
}

function bookingFailureSummary(code: string) {
  const descriptions: Record<string, string> = {
    ineligible: "the Participant is no longer eligible for this Trial Offering",
    slot_unavailable:
      "the class is full or the Trial Occurrence is no longer available",
    invalid_slot: "the Trial Occurrence is no longer valid",
    already_booked:
      "the Participant already has a booking for this Trial Occurrence",
    school_not_public: "the School is not accepting public bookings",
    terms_changed:
      "the approved terms have changed; request a new proposal before booking",
  };
  return `No booking was made: ${descriptions[code] ?? code}.`;
}
