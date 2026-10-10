import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  type Booking,
  bookings,
  contacts,
  type EmailDelivery,
  emailDeliveries,
  leads,
  type School,
  schools,
} from "@/db/schema";
import { isLocalEmailNoop } from "@/lib/dev-flags";
import { buildTrialIcs } from "./ics";
import { getFromAddress, getResendOrNull } from "./resend";
import {
  ownerBookingEmail,
  ownerCancellationEmail,
  ownerLeadEmail,
  prospectCancellationEmail,
  prospectConfirmationEmail,
  prospectReminderEmail,
} from "./templates";

function nextBackoff(attempts: number) {
  const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return sql`now() + make_interval(mins => ${minutes})`;
}

function icsAttachment(booking: Booking, method: "PUBLISH" | "CANCEL") {
  const ics = buildTrialIcs({
    uid: booking.icsUid,
    sequence: booking.icsSequence,
    method,
    dtstamp: new Date(),
    start: booking.startAt,
    end: booking.endAt,
    summary: `${booking.offeringNameSnapshot} trial`,
    description: booking.instructionsSnapshot ?? booking.offeringNameSnapshot,
    location: booking.locationSnapshot ?? "",
  });
  return {
    filename: method === "CANCEL" ? "cancel.ics" : "trial.ics",
    content: Buffer.from(ics, "utf8"),
    contentType: "text/calendar; charset=utf-8",
  };
}

async function renderDelivery(
  delivery: EmailDelivery,
  school: School,
  booking: Booking | null,
) {
  switch (delivery.kind) {
    case "prospect_confirmation":
      if (!booking) throw new Error("missing booking");
      return {
        ...prospectConfirmationEmail(school, booking),
        attachments: [icsAttachment(booking, "PUBLISH")],
      };
    case "booking_reminder":
      if (!booking) throw new Error("missing booking");
      return {
        ...prospectReminderEmail(school, booking),
        attachments: [icsAttachment(booking, "PUBLISH")],
      };
    case "booking_cancellation":
      if (!booking) throw new Error("missing booking");
      return {
        ...prospectCancellationEmail(school, booking),
        attachments: [icsAttachment(booking, "CANCEL")],
      };
    case "owner_booking":
      if (!booking) throw new Error("missing booking");
      return { ...ownerBookingEmail(school, booking), attachments: [] };
    case "owner_cancellation":
      if (!booking) throw new Error("missing booking");
      return { ...ownerCancellationEmail(school, booking), attachments: [] };
    case "owner_lead": {
      if (!delivery.leadId) throw new Error("missing lead");
      const db = getDb();
      const [lead] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, delivery.leadId))
        .limit(1);
      if (!lead) throw new Error("missing lead");
      const [contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, lead.contactId))
        .limit(1);
      if (!contact) throw new Error("missing contact");
      // `contacts.email` is nullable for the WhatsApp no-email path; the owner
      // email is still delivered (to `school.notificationEmail`) and only the
      // displayed contact line loses the email.
      const email = contact.email ?? "";
      return {
        ...ownerLeadEmail(school, lead, {
          name: contact.name,
          email,
          phone: contact.phone,
        }),
        attachments: [],
      };
    }
    default:
      throw new Error("unknown email kind");
  }
}

export async function sendDelivery(
  deliveryId: string,
): Promise<"sent" | "failed"> {
  const db = getDb();
  const [delivery] = await db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.id, deliveryId))
    .limit(1);
  if (!delivery) return "failed";

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, delivery.schoolId))
    .limit(1);
  if (!school?.approvedAt) return "failed";

  const booking = delivery.bookingId
    ? (
        await db
          .select()
          .from(bookings)
          .where(eq(bookings.id, delivery.bookingId))
          .limit(1)
      )[0]
    : null;

  try {
    const rendered = await renderDelivery(delivery, school, booking ?? null);
    const resend = getResendOrNull();
    if (!resend) {
      if (!isLocalEmailNoop()) throw new Error("RESEND_API_KEY is not set");
      console.info(
        `[local email noop] ${delivery.kind} → ${delivery.recipient}: ${rendered.subject}`,
      );
      await db
        .update(emailDeliveries)
        .set({
          state: "sent",
          providerId: `local-noop:${delivery.id}`,
          sentAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(emailDeliveries.id, delivery.id));
      return "sent";
    }
    const result = await resend.emails.send({
      from: getFromAddress(),
      to: delivery.recipient,
      subject: rendered.subject,
      text: rendered.text,
      attachments: rendered.attachments,
      headers: {
        "Idempotency-Key": delivery.providerIdempotencyKey,
      },
    });
    if (result.error) throw new Error(result.error.message);
    await db
      .update(emailDeliveries)
      .set({
        state: "sent",
        providerId: result.data?.id ?? null,
        sentAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(emailDeliveries.id, delivery.id));
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    await db
      .update(emailDeliveries)
      .set({
        state: "failed",
        lastError: message.slice(0, 500),
        attempts: delivery.attempts + 1,
        nextAttemptAt: nextBackoff(delivery.attempts + 1),
        updatedAt: new Date(),
      })
      .where(eq(emailDeliveries.id, delivery.id));
    return "failed";
  }
}

export async function attemptPendingForBooking(bookingId: string) {
  const db = getDb();
  const pending = await db
    .select()
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.bookingId, bookingId),
        or(
          eq(emailDeliveries.state, "pending"),
          eq(emailDeliveries.state, "failed"),
        ),
      ),
    );
  for (const row of pending) {
    await sendDelivery(row.id);
  }
}

export async function attemptPendingForLead(leadId: string) {
  const db = getDb();
  const pending = await db
    .select()
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.leadId, leadId),
        or(
          eq(emailDeliveries.state, "pending"),
          eq(emailDeliveries.state, "failed"),
        ),
      ),
    );
  for (const row of pending) {
    await sendDelivery(row.id);
  }
}

export async function claimDueDeliveries(
  runId: string,
  limit = 25,
  opts?: { ids?: string[] },
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(emailDeliveries)
      .where(
        and(
          or(
            eq(emailDeliveries.state, "pending"),
            eq(emailDeliveries.state, "failed"),
          ),
          lte(emailDeliveries.nextAttemptAt, sql`now()`),
          opts?.ids ? inArray(emailDeliveries.id, opts.ids) : undefined,
        ),
      )
      .for("update", { skipLocked: true })
      .limit(limit);

    if (due.length === 0) return [];

    const ids = due.map((row) => row.id);
    await tx
      .update(emailDeliveries)
      .set({
        state: "claimed",
        claimedAt: new Date(),
        claimedBy: runId,
        updatedAt: new Date(),
      })
      .where(inArray(emailDeliveries.id, ids));

    return due;
  });
}
