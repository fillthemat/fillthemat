import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  lt,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
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
import { logDeadTransition } from "@/lib/retry-log";
import {
  InternalFailure,
  MAX_EXECUTIONS,
  type RetryFailure,
  retryDecision,
} from "@/lib/retry-policy";
import {
  type EmailSendDependencies,
  emailSendDependencies,
} from "./dependencies";
import { buildTrialIcs } from "./ics";
import {
  ownerBookingEmail,
  ownerCancellationEmail,
  ownerLeadEmail,
  prospectCancellationEmail,
  prospectConfirmationEmail,
  prospectReminderEmail,
} from "./templates";

function icsAttachment(
  booking: Booking,
  method: "PUBLISH" | "CANCEL",
  now: Date,
) {
  const ics = buildTrialIcs({
    uid: booking.icsUid,
    sequence: booking.icsSequence,
    method,
    dtstamp: now,
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
  now: Date,
) {
  switch (delivery.kind) {
    case "prospect_confirmation":
      if (!booking) throw new InternalFailure("missing_booking");
      return {
        ...prospectConfirmationEmail(school, booking),
        attachments: [icsAttachment(booking, "PUBLISH", now)],
      };
    case "booking_reminder":
      if (!booking) throw new InternalFailure("missing_booking");
      return {
        ...prospectReminderEmail(school, booking),
        attachments: [icsAttachment(booking, "PUBLISH", now)],
      };
    case "booking_cancellation":
      if (!booking) throw new InternalFailure("missing_booking");
      return {
        ...prospectCancellationEmail(school, booking),
        attachments: [icsAttachment(booking, "CANCEL", now)],
      };
    case "owner_booking":
      if (!booking) throw new InternalFailure("missing_booking");
      return { ...ownerBookingEmail(school, booking), attachments: [] };
    case "owner_cancellation":
      if (!booking) throw new InternalFailure("missing_booking");
      return { ...ownerCancellationEmail(school, booking), attachments: [] };
    case "owner_lead": {
      if (!delivery.leadId) throw new InternalFailure("missing_lead");
      const db = getDb();
      const [lead] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, delivery.leadId))
        .limit(1);
      if (!lead) throw new InternalFailure("missing_lead");
      const [contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, lead.contactId))
        .limit(1);
      if (!contact) throw new InternalFailure("missing_contact");
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
      throw new InternalFailure("unknown_email_kind");
  }
}

function ownedClaim(delivery: EmailDelivery) {
  return and(
    eq(emailDeliveries.id, delivery.id),
    eq(emailDeliveries.state, "claimed"),
    eq(emailDeliveries.claimedBy, delivery.claimedBy ?? ""),
    delivery.claimedAt
      ? eq(emailDeliveries.claimedAt, delivery.claimedAt)
      : sql`false`,
    eq(emailDeliveries.attempts, delivery.attempts),
  );
}
type SendResult = "sent" | "retrying" | "dead" | "deferred";
async function failDelivery(
  delivery: EmailDelivery,
  failure: Extract<RetryFailure, { kind: "internal" | "email_error" }>,
  message: string,
  now: Date,
): Promise<SendResult> {
  const decision = retryDecision(failure, delivery.attempts, now, "email");
  const reason = failure.kind === "internal" ? failure.reason : failure.name;
  const [row] = await getDb()
    .update(emailDeliveries)
    .set({
      state: decision.action === "stop" ? "dead" : "failed",
      nextAttemptAt: decision.action === "retry" ? decision.at : undefined,
      lastError: message.slice(0, 500),
      failureReason: reason,
      terminalCause: decision.action === "stop" ? decision.cause : null,
      claimedAt: null,
      claimedBy: null,
      updatedAt: now,
    })
    .where(ownedClaim(delivery))
    .returning();
  if (!row) return "deferred";
  if (decision.action === "stop")
    logDeadTransition({
      queue: "email_delivery",
      id: row.id,
      schoolId: row.schoolId,
      reason,
      terminalCause: decision.cause,
      executions: row.attempts,
      runId: delivery.claimedBy ?? "unknown",
    });
  return decision.action === "stop" ? "dead" : "retrying";
}

/** A row snapshot carries the fence; an ID-only caller must obtain a due claim. */
export async function sendDelivery(
  deliveryOrId: EmailDelivery | string,
  overrides: Partial<EmailSendDependencies> = {},
): Promise<SendResult> {
  const dependencies = emailSendDependencies(overrides);
  const db = getDb();
  const delivery =
    typeof deliveryOrId === "string"
      ? (
          await claimDueDeliveries(`inline:${randomUUID()}`, 1, {
            now: dependencies.now(),
            ids: [deliveryOrId],
          })
        )[0]
      : deliveryOrId;
  if (!delivery) return "deferred";
  if (delivery.attempts >= MAX_EXECUTIONS)
    return failDelivery(
      delivery,
      {
        kind: "internal",
        reason: delivery.failureReason ?? "attempts_exhausted",
      },
      delivery.lastError ?? "attempts_exhausted",
      dependencies.now(),
    );
  const [executing] = await db
    .update(emailDeliveries)
    .set({
      attempts: sql`${emailDeliveries.attempts} + 1`,
      updatedAt: dependencies.now(),
    })
    .where(
      and(ownedClaim(delivery), lt(emailDeliveries.attempts, MAX_EXECUTIONS)),
    )
    .returning();
  if (!executing) return "deferred";
  try {
    const [school] = await db
      .select()
      .from(schools)
      .where(eq(schools.id, executing.schoolId))
      .limit(1);
    if (!school) throw new InternalFailure("school_missing");
    if (!school.approvedAt) throw new InternalFailure("school_not_approved");
    const booking = executing.bookingId
      ? (
          await db
            .select()
            .from(bookings)
            .where(eq(bookings.id, executing.bookingId))
            .limit(1)
        )[0]
      : null;
    // Keep ICS DTSTAMP stable when reusing Resend's idempotency key on retry.
    const rendered = await renderDelivery(
      executing,
      school,
      booking ?? null,
      executing.createdAt,
    );
    const result = await dependencies.transport.send({
      to: executing.recipient,
      ...rendered,
      idempotencyKey: executing.providerIdempotencyKey,
    });
    if (!result.ok)
      return failDelivery(
        executing,
        result,
        result.message,
        dependencies.now(),
      );
    const now = dependencies.now();
    const rows = await db
      .update(emailDeliveries)
      .set({
        state: "sent",
        providerId:
          result.kind === "local_noop"
            ? `local-noop:${executing.id}`
            : result.providerId,
        sentAt: now,
        lastError: null,
        failureReason: null,
        terminalCause: null,
        claimedAt: null,
        claimedBy: null,
        updatedAt: now,
      })
      .where(ownedClaim(executing))
      .returning({ id: emailDeliveries.id });
    return rows.length ? "sent" : "deferred";
  } catch (error) {
    return failDelivery(
      executing,
      {
        kind: "internal",
        reason:
          error instanceof InternalFailure ? error.reason : "email_send_failed",
      },
      error instanceof Error ? error.message : "send_failed",
      dependencies.now(),
    );
  }
}

export async function runEmailSendOnce(
  runId: string,
  overrides: Partial<EmailSendDependencies> = {},
  options: { ids?: string[]; limit?: number } = {},
) {
  const dependencies = emailSendDependencies(overrides);
  const recovered = await recoverStuckEmailDeliveries(
    5 * 60_000,
    dependencies.now(),
    runId,
    options.ids,
  );
  const claimed = await claimDueDeliveries(runId, options.limit ?? 25, {
    now: dependencies.now(),
    ids: options.ids,
  });
  const counts = {
    claimed: claimed.length,
    sent: 0,
    retrying: 0,
    dead: recovered.dead,
    deferred: 0,
  };
  for (const row of claimed) counts[await sendDelivery(row, dependencies)]++;
  return counts;
}

export async function recoverStuckEmailDeliveries(
  staleBeforeMs = 5 * 60_000,
  now = new Date(),
  runId = "recovery",
  ids?: string[],
) {
  if (ids?.length === 0) return { recovered: 0, dead: 0 };
  const result = await getDb().transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.state, "claimed"),
          lt(
            emailDeliveries.claimedAt,
            new Date(now.getTime() - staleBeforeMs),
          ),
          ids ? inArray(emailDeliveries.id, ids) : undefined,
        ),
      )
      .for("update", { skipLocked: true });
    const dead: EmailDelivery[] = [];
    for (const delivery of stale) {
      const decision = retryDecision(
        { kind: "internal", reason: "worker_crashed" },
        delivery.attempts,
        now,
        "email",
      );
      const [row] = await tx
        .update(emailDeliveries)
        .set({
          state: decision.action === "stop" ? "dead" : "pending",
          claimedAt: null,
          claimedBy: null,
          updatedAt: now,
          failureReason:
            decision.action === "stop"
              ? (delivery.failureReason ?? "worker_crashed")
              : delivery.failureReason,
          lastError:
            decision.action === "stop"
              ? (delivery.lastError ?? "worker_crashed")
              : delivery.lastError,
          terminalCause: decision.action === "stop" ? decision.cause : null,
        })
        .where(ownedClaim(delivery))
        .returning();
      if (row?.state === "dead") dead.push(row);
    }
    return { recovered: stale.length, dead };
  });
  for (const row of result.dead)
    logDeadTransition({
      queue: "email_delivery",
      id: row.id,
      schoolId: row.schoolId,
      reason: row.failureReason ?? "worker_crashed",
      terminalCause: row.terminalCause ?? "attempts_exhausted",
      executions: row.attempts,
      runId,
    });
  return { recovered: result.recovered, dead: result.dead.length };
}

export async function attemptPendingForBooking(
  bookingId: string,
  overrides: Partial<EmailSendDependencies> = {},
) {
  const db = getDb();
  const pending = await db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.bookingId, bookingId));
  return runEmailSendOnce(`booking:${randomUUID()}`, overrides, {
    ids: pending.map((row) => row.id),
  });
}

export async function attemptPendingForLead(
  leadId: string,
  overrides: Partial<EmailSendDependencies> = {},
) {
  const db = getDb();
  const pending = await db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.leadId, leadId));
  return runEmailSendOnce(`lead:${randomUUID()}`, overrides, {
    ids: pending.map((row) => row.id),
  });
}

export async function claimDueDeliveries(
  runId: string,
  limit = 25,
  opts: { now?: Date; ids?: string[] } = {},
) {
  const db = getDb();
  const now = opts.now ?? new Date();
  if (opts.ids?.length === 0 || limit <= 0) return [];
  return db.transaction(async (tx) => {
    const due: EmailDelivery[] = [];
    async function take(fresh: boolean, count: number) {
      if (count <= 0) return;
      const rows = await tx
        .select()
        .from(emailDeliveries)
        .where(
          and(
            inArray(emailDeliveries.state, ["pending", "failed"]),
            lte(emailDeliveries.nextAttemptAt, now),
            fresh
              ? eq(emailDeliveries.attempts, 0)
              : gt(emailDeliveries.attempts, 0),
            opts.ids ? inArray(emailDeliveries.id, opts.ids) : undefined,
            due.length
              ? notInArray(
                  emailDeliveries.id,
                  due.map((row) => row.id),
                )
              : undefined,
          ),
        )
        .orderBy(asc(emailDeliveries.createdAt), asc(emailDeliveries.id))
        .for("update", { skipLocked: true })
        .limit(count);
      due.push(...rows);
    }
    const retrySlots = Math.floor(limit / 5);
    await take(true, limit - retrySlots);
    await take(false, retrySlots);
    await take(true, limit - due.length);
    await take(false, limit - due.length);

    if (due.length === 0) return [];

    const ids = due.map((row) => row.id);
    const claimed = await tx
      .update(emailDeliveries)
      .set({
        state: "claimed",
        claimedAt: now,
        claimedBy: runId,
        updatedAt: now,
      })
      .where(inArray(emailDeliveries.id, ids))
      .returning();
    const byId = new Map(claimed.map((row) => [row.id, row]));
    // UPDATE RETURNING has no ordering guarantee; retain fresh-first selection.
    return due
      .sort(
        (a, b) =>
          Number(a.attempts > 0) - Number(b.attempts > 0) ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((row) => byId.get(row.id))
      .filter((row): row is EmailDelivery => !!row);
  });
}
