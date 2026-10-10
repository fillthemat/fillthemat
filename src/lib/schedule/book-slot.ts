import { and, eq, sql } from "drizzle-orm";
import { type Database, getDb } from "@/db";
import {
  type Booking,
  bookings,
  contacts,
  emailDeliveries,
  funnelEvents,
  landingSessions,
  participants,
  type School,
  schools,
  trialOccurrences,
  trialOfferings,
  trialWindows,
} from "@/db/schema";
import {
  attachConversationContact,
  findConversation,
} from "@/lib/conversations/conversation-store";
import { hashToken, normalizeEmail, normalizePersonName } from "@/lib/crypto";
import { bookingIcsUid } from "@/lib/email/ics";
import { FUNNEL_EVENTS, privacySafeMetadata } from "@/lib/funnel";
import { isAgeEligible, listOpenSlots } from "./occurrences";
import { parseSlotId } from "./slot-id";

export type BookSlotInput = {
  school: School;
  offeringId: string;
  slotId: string;
  idempotencyKey: string;
  contact: { name: string; email: string | null; phone: string };
  participant: { name: string; age: number };
  landingSessionToken?: string;
  conversationResumeToken?: string;
  /** WhatsApp path: resolve the conversation by id directly (no resume token). */
  conversationId?: string;
  now?: Date;
};

export type BookSlotResult =
  | { ok: true; booking: Booking; idempotent: boolean }
  | {
      ok: false;
      code:
        | "invalid_slot"
        | "slot_unavailable"
        | "ineligible"
        | "already_booked"
        | "school_not_public";
    };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function constraintName(error: unknown): string {
  if (typeof error !== "object" || error === null || !("constraint" in error)) {
    return "";
  }
  return String((error as { constraint?: string }).constraint ?? "");
}

async function insertFunnel(
  tx: Pick<Database, "insert">,
  values: typeof funnelEvents.$inferInsert,
) {
  await tx.insert(funnelEvents).values({
    ...values,
    metadata: privacySafeMetadata(values.metadata) ?? undefined,
  });
}

export async function bookSlot(input: BookSlotInput): Promise<BookSlotResult> {
  if (!input.school.approvedAt || !input.school.publishedAt) {
    return { ok: false, code: "school_not_public" };
  }

  const parsed = parseSlotId(input.slotId);
  if (!parsed) return { ok: false, code: "invalid_slot" };

  const now = input.now ?? new Date();
  const db = getDb();
  // WhatsApp no-email contacts pass `null` through (decision B / D8). Web always
  // has an email, so the normalize path is unchanged for existing flows.
  const email = input.contact.email
    ? normalizeEmail(input.contact.email)
    : null;
  const participantName = input.participant.name.trim();
  const normalizedName = normalizePersonName(participantName);

  try {
    const booking = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.schoolId, input.school.id),
            eq(bookings.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing[0]) {
        return { row: existing[0], idempotent: true };
      }

      const [offering] = await tx
        .select()
        .from(trialOfferings)
        .where(
          and(
            eq(trialOfferings.id, input.offeringId),
            eq(trialOfferings.schoolId, input.school.id),
            eq(trialOfferings.active, true),
          ),
        )
        .limit(1);

      if (!offering || !isAgeEligible(input.participant.age, offering)) {
        throw Object.assign(new Error("ineligible"), { code: "ineligible" });
      }

      const [window] = await tx
        .select()
        .from(trialWindows)
        .where(
          and(
            eq(trialWindows.id, parsed.windowId),
            eq(trialWindows.schoolId, input.school.id),
            eq(trialWindows.trialOfferingId, offering.id),
            eq(trialWindows.active, true),
          ),
        )
        .limit(1);

      if (!window) {
        throw Object.assign(new Error("invalid_slot"), {
          code: "invalid_slot",
        });
      }

      const occurrenceRows = await tx
        .select()
        .from(trialOccurrences)
        .where(
          and(
            eq(trialOccurrences.schoolId, input.school.id),
            eq(trialOccurrences.trialWindowId, window.id),
          ),
        );

      const open = listOpenSlots({
        offeringId: offering.id,
        timezone: input.school.timezone,
        windows: [window],
        occurrences: occurrenceRows,
        now,
      });

      const slot = open.find(
        (candidate) => candidate.startAt.getTime() === parsed.startAt.getTime(),
      );
      if (!slot) {
        throw Object.assign(new Error("slot_unavailable"), {
          code: "slot_unavailable",
        });
      }

      const contactValues = {
        schoolId: input.school.id,
        email,
        name: input.contact.name.trim(),
        phone: input.contact.phone.trim(),
      };
      const contactUpdates = {
        name: input.contact.name.trim(),
        phone: input.contact.phone.trim(),
        updatedAt: new Date(),
      };
      // Key the upsert on email when present (web semantics unchanged) and on
      // `(school_id, phone)` when the contact has no email (WhatsApp, decision B).
      const [contact] = email
        ? await tx
            .insert(contacts)
            .values(contactValues)
            .onConflictDoUpdate({
              target: [contacts.schoolId, contacts.email],
              set: contactUpdates,
            })
            .returning()
        : await tx
            .insert(contacts)
            .values(contactValues)
            .onConflictDoUpdate({
              target: [contacts.schoolId, contacts.phone],
              set: contactUpdates,
            })
            .returning();

      if (!contact) throw new Error("contact_upsert_failed");

      const [participant] = await tx
        .insert(participants)
        .values({
          schoolId: input.school.id,
          contactId: contact.id,
          name: participantName,
          normalizedName,
        })
        .onConflictDoUpdate({
          target: [participants.contactId, participants.normalizedName],
          set: {
            name: participantName,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!participant) throw new Error("participant_upsert_failed");

      await tx
        .insert(trialOccurrences)
        .values({
          schoolId: input.school.id,
          trialWindowId: window.id,
          trialOfferingId: offering.id,
          startAt: slot.startAt,
          endAt: slot.endAt,
          capacity: window.capacity,
          bookedCount: 0,
        })
        .onConflictDoNothing({
          target: [trialOccurrences.trialWindowId, trialOccurrences.startAt],
        });

      const [occurrence] = await tx
        .select()
        .from(trialOccurrences)
        .where(
          and(
            eq(trialOccurrences.schoolId, input.school.id),
            eq(trialOccurrences.trialWindowId, window.id),
            eq(trialOccurrences.startAt, slot.startAt),
          ),
        )
        .for("update")
        .limit(1);

      if (!occurrence) throw new Error("occurrence_missing");

      if (occurrence.startAt.getTime() !== slot.startAt.getTime()) {
        throw Object.assign(new Error("slot_unavailable"), {
          code: "slot_unavailable",
        });
      }

      const [incremented] = await tx
        .update(trialOccurrences)
        .set({
          bookedCount: sql`${trialOccurrences.bookedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(trialOccurrences.id, occurrence.id),
            sql`${trialOccurrences.bookedCount} < ${trialOccurrences.capacity}`,
          ),
        )
        .returning();

      if (!incremented) {
        throw Object.assign(new Error("slot_unavailable"), {
          code: "slot_unavailable",
        });
      }

      let landingSessionId: string | undefined;
      if (input.landingSessionToken) {
        const [session] = await tx
          .select()
          .from(landingSessions)
          .where(
            and(
              eq(landingSessions.schoolId, input.school.id),
              eq(
                landingSessions.sessionKeyHash,
                hashToken(input.landingSessionToken),
              ),
            ),
          )
          .limit(1);
        landingSessionId = session?.id;
      }

      let conversationId: string | undefined = input.conversationId;
      if (!conversationId && input.conversationResumeToken) {
        const conversation = await findConversation(
          {
            schoolId: input.school.id,
            identity: {
              channel: "web",
              resumeToken: input.conversationResumeToken,
            },
            now,
          },
          tx,
        );
        conversationId = conversation?.id;
      }
      if (conversationId) {
        conversationId = await attachConversationContact(
          {
            schoolId: input.school.id,
            conversationId,
            contactId: contact.id,
            now,
          },
          tx,
        );
      }

      const locationParts = [
        input.school.address,
        input.school.city,
        input.school.country,
      ].filter(Boolean);
      const instructionParts = [
        input.school.accessNotes,
        input.school.parkingNotes,
        offering.attire ?? input.school.trialGuidance,
      ].filter(Boolean);

      const [row] = await tx
        .insert(bookings)
        .values({
          schoolId: input.school.id,
          contactId: contact.id,
          participantId: participant.id,
          trialOfferingId: offering.id,
          trialWindowId: window.id,
          trialOccurrenceId: incremented.id,
          conversationId,
          landingSessionId,
          idempotencyKey: input.idempotencyKey,
          status: "booked",
          participantNameSnapshot: participantName,
          participantAgeSnapshot: input.participant.age,
          offeringNameSnapshot: offering.name,
          timezoneSnapshot: input.school.timezone,
          startAt: slot.startAt,
          endAt: slot.endAt,
          locationSnapshot: locationParts.join(", ") || null,
          instructionsSnapshot: instructionParts.join("\n") || null,
          contactEmailSnapshot: email ?? null,
          contactNameSnapshot: input.contact.name.trim(),
          contactPhoneSnapshot: input.contact.phone.trim(),
          icsUid: "pending",
          icsSequence: 0,
        })
        .returning();

      if (!row) throw new Error("booking_insert_failed");

      const icsUid = bookingIcsUid(row.id);
      const [updated] = await tx
        .update(bookings)
        .set({ icsUid })
        .where(eq(bookings.id, row.id))
        .returning();
      const saved = updated ?? { ...row, icsUid };

      // Owner notification always goes by email. The prospect confirmation is
      // emailed only when there is an email; no-email WhatsApp bookings get a
      // WhatsApp template confirmation enqueued by the caller instead.
      const deliveryRows: Array<{
        schoolId: string;
        bookingId: string;
        kind: "owner_booking" | "prospect_confirmation";
        recipient: string;
        providerIdempotencyKey: string;
        state: "pending";
        nextAttemptAt: Date;
      }> = [
        {
          schoolId: input.school.id,
          bookingId: saved.id,
          kind: "owner_booking",
          recipient: input.school.notificationEmail,
          providerIdempotencyKey: `owner-booking/${saved.id}`,
          state: "pending",
          nextAttemptAt: now,
        },
      ];
      if (email) {
        deliveryRows.unshift({
          schoolId: input.school.id,
          bookingId: saved.id,
          kind: "prospect_confirmation",
          recipient: email,
          providerIdempotencyKey: `booking-confirmation/${saved.id}`,
          state: "pending",
          nextAttemptAt: now,
        });
      }
      await tx.insert(emailDeliveries).values(deliveryRows);

      await insertFunnel(tx, {
        schoolId: input.school.id,
        landingSessionId,
        conversationId,
        bookingId: saved.id,
        eventType: FUNNEL_EVENTS.bookingConfirmed,
        metadata: { source: conversationId ? "chat" : "direct" },
      });

      return { row: saved, idempotent: false };
    });

    return { ok: true, booking: booking.row, idempotent: booking.idempotent };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code === "ineligible" ||
      code === "invalid_slot" ||
      code === "slot_unavailable"
    ) {
      return { ok: false, code };
    }
    if (isUniqueViolation(error)) {
      const name = constraintName(error);
      if (name.includes("idempotency")) {
        const [existing] = await db
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.schoolId, input.school.id),
              eq(bookings.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) return { ok: true, booking: existing, idempotent: true };
      }
      if (name.includes("active_participant_occurrence")) {
        return { ok: false, code: "already_booked" };
      }
    }
    throw error;
  }
}

export type CancelBookingResult =
  | { ok: true; booking: Booking; replay: boolean }
  | { ok: false; code: "not_found" | "not_cancellable" };

export async function cancelBooking({
  schoolId,
  bookingId,
  now = new Date(),
}: {
  schoolId: string;
  bookingId: string;
  now?: Date;
}): Promise<CancelBookingResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.schoolId, schoolId)))
      .for("update")
      .limit(1);

    if (!booking) return { ok: false, code: "not_found" as const };

    if (booking.status === "cancelled") {
      return { ok: true, booking, replay: true };
    }

    if (booking.status !== "booked" || booking.startAt <= now) {
      return { ok: false, code: "not_cancellable" as const };
    }

    const nextSequence = booking.icsSequence + 1;
    const [updated] = await tx
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: now,
        icsSequence: nextSequence,
        updatedAt: now,
      })
      .where(
        and(
          eq(bookings.id, booking.id),
          eq(bookings.schoolId, schoolId),
          eq(bookings.status, "booked"),
        ),
      )
      .returning();

    if (!updated) {
      const [again] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, booking.id))
        .limit(1);
      if (again?.status === "cancelled") {
        return { ok: true, booking: again, replay: true };
      }
      return { ok: false, code: "not_cancellable" as const };
    }

    await tx
      .update(trialOccurrences)
      .set({
        bookedCount: sql`${trialOccurrences.bookedCount} - 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(trialOccurrences.id, booking.trialOccurrenceId),
          eq(trialOccurrences.schoolId, schoolId),
          sql`${trialOccurrences.bookedCount} > 0`,
        ),
      );

    const [school] = await tx
      .select({ notificationEmail: schools.notificationEmail })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    // `cancelBooking` stays email/dashboard-only (decision K). A no-email
    // WhatsApp booking has no prospect email address, so only the owner
    // cancellation email is enqueued for it.
    const cancellationRows: Array<{
      schoolId: string;
      bookingId: string;
      kind: "booking_cancellation" | "owner_cancellation";
      recipient: string;
      providerIdempotencyKey: string;
      state: "pending";
      nextAttemptAt: Date;
    }> = [];
    if (booking.contactEmailSnapshot) {
      cancellationRows.push({
        schoolId,
        bookingId: booking.id,
        kind: "booking_cancellation",
        recipient: booking.contactEmailSnapshot,
        providerIdempotencyKey: `booking-cancellation/${booking.id}/${nextSequence}`,
        state: "pending",
        nextAttemptAt: now,
      });
    }
    if (school?.notificationEmail) {
      cancellationRows.push({
        schoolId,
        bookingId: booking.id,
        kind: "owner_cancellation",
        recipient: school.notificationEmail,
        providerIdempotencyKey: `owner-cancellation/${booking.id}/${nextSequence}`,
        state: "pending",
        nextAttemptAt: now,
      });
    }
    if (cancellationRows.length > 0) {
      await tx.insert(emailDeliveries).values(cancellationRows);
    }

    await insertFunnel(tx, {
      schoolId,
      bookingId: booking.id,
      landingSessionId: booking.landingSessionId ?? undefined,
      conversationId: booking.conversationId ?? undefined,
      eventType: FUNNEL_EVENTS.bookingCancelled,
      metadata: { sequence: nextSequence },
    });

    return { ok: true, booking: updated, replay: false };
  });
}
