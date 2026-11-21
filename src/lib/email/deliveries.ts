import "server-only";
import { randomUUID } from "node:crypto";
import { deadEventFrom, logDeadTransition } from "@/lib/retry-log";
import {
  emailRetryDecision as retryDecision,
  InternalFailure,
  internalFailureReasonFrom,
  MAX_EXECUTIONS,
  type RetryFailure,
} from "@/lib/retry-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { type EmailSendDependencies, emailSendDependencies } from "./dependencies";
import { buildTrialIcs } from "./ics";
import { emailBooking, type EmailDelivery, updateClaim } from "./store";
import {
  ownerBookingEmail,
  ownerCancellationEmail,
  ownerLeadEmail,
  ownerWhatsAppConfirmationFailedEmail,
  prospectCancellationEmail,
  prospectConfirmationEmail,
  prospectReminderEmail,
} from "./templates";

async function renderDelivery(delivery: EmailDelivery) {
  const client = createAdminClient();
  const { data: school } = await client
    .from("schools")
    .select("approved_at, school_profiles(name, phone), school_settings(notification_email)")
    .eq("id", delivery.school_id)
    .maybeSingle()
    .throwOnError();
  if (!school) throw new InternalFailure("school_missing");
  if (!school.approved_at) throw new InternalFailure("school_not_approved");
  if (!school.school_profiles || !school.school_settings)
    throw new InternalFailure("school_missing");
  const facts = {
    name: school.school_profiles.name,
    phone: school.school_profiles.phone,
    notificationEmail: school.school_settings.notification_email,
  };
  if (delivery.kind === "owner_lead") {
    if (!delivery.lead_id) throw new InternalFailure("missing_lead");
    const { data: lead } = await client
      .from("leads")
      .select("*, contacts(name, email, phone)")
      .eq("id", delivery.lead_id)
      .eq("school_id", delivery.school_id)
      .maybeSingle()
      .throwOnError();
    if (!lead) throw new InternalFailure("missing_lead");
    if (!lead.contacts) throw new InternalFailure("missing_contact");
    return {
      ...ownerLeadEmail(
        facts,
        {
          participantName: lead.participant_name,
          participantAge: lead.participant_age,
          statedNeed: lead.stated_need,
        },
        { ...lead.contacts, email: lead.contacts.email ?? "" },
      ),
      attachments: [],
    };
  }
  if (
    ![
      "prospect_confirmation",
      "booking_reminder",
      "booking_cancellation",
      "owner_booking",
      "owner_cancellation",
      "owner_whatsapp_confirmation_failed",
    ].includes(delivery.kind)
  )
    throw new InternalFailure("unknown_email_kind");
  if (!delivery.booking_id) throw new InternalFailure("missing_booking");
  const { data: row } = await client
    .from("bookings")
    .select()
    .eq("id", delivery.booking_id)
    .eq("school_id", delivery.school_id)
    .maybeSingle()
    .throwOnError();
  if (!row) throw new InternalFailure("missing_booking");
  const booking = emailBooking(row);
  const attachment = (method: "PUBLISH" | "CANCEL") => ({
    filename: method === "CANCEL" ? "cancel.ics" : "trial.ics",
    content: Buffer.from(
      buildTrialIcs({
        uid: booking.icsUid,
        sequence: booking.icsSequence,
        method,
        // Stable bytes across retries using the same Resend idempotency key.
        dtstamp: new Date(delivery.created_at),
        start: booking.startAt,
        end: booking.endAt,
        summary: `${booking.offeringNameSnapshot} trial`,
        description: booking.instructionsSnapshot ?? booking.offeringNameSnapshot,
        location: booking.locationSnapshot ?? "",
      }),
      "utf8",
    ),
    contentType: "text/calendar; charset=utf-8",
  });
  switch (delivery.kind) {
    case "prospect_confirmation":
      return { ...prospectConfirmationEmail(facts, booking), attachments: [attachment("PUBLISH")] };
    case "booking_reminder":
      return { ...prospectReminderEmail(facts, booking), attachments: [attachment("PUBLISH")] };
    case "booking_cancellation":
      return { ...prospectCancellationEmail(facts, booking), attachments: [attachment("CANCEL")] };
    case "owner_booking":
      return { ...ownerBookingEmail(facts, booking), attachments: [] };
    case "owner_cancellation":
      return { ...ownerCancellationEmail(facts, booking), attachments: [] };
    case "owner_whatsapp_confirmation_failed":
      return { ...ownerWhatsAppConfirmationFailedEmail(facts, booking), attachments: [] };
    default:
      throw new InternalFailure("unknown_email_kind");
  }
}

type SendResult = "sent" | "retrying" | "dead" | "deferred";
async function failDelivery(
  delivery: EmailDelivery,
  failure: Extract<RetryFailure, { kind: "internal" | "email_error" }>,
  message: string,
  now: Date,
): Promise<SendResult> {
  const decision = retryDecision(failure, delivery.attempts, now);
  const reason =
    failure.kind === "internal"
      ? failure.reason === "attempts_exhausted"
        ? (delivery.failure_reason ?? failure.reason)
        : failure.reason
      : failure.name;
  const row = await updateClaim(delivery, {
    state: decision.action === "stop" ? "dead" : "failed",
    next_attempt_at: decision.action === "retry" ? decision.at.toISOString() : undefined,
    last_error: message.slice(0, 500),
    failure_reason: reason,
    terminal_cause: decision.action === "stop" ? decision.cause : null,
    claimed_at: null,
    claimed_by: null,
  });
  if (!row) return "deferred";
  if (decision.action === "stop")
    logDeadTransition(deadEventFrom(row, "email_delivery", delivery.claimed_by ?? "unknown"));
  return decision.action === "stop" ? "dead" : "retrying";
}

/** A snapshot carries the full fence; ID-only callers first obtain a due claim. */
export async function sendDelivery(
  deliveryOrId: EmailDelivery | string,
  overrides: Partial<EmailSendDependencies> = {},
): Promise<SendResult> {
  const dependencies = emailSendDependencies(overrides);
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
        reason: internalFailureReasonFrom(delivery.failure_reason, "attempts_exhausted"),
      },
      delivery.last_error ?? "attempts_exhausted",
      dependencies.now(),
    );
  if (!delivery.claimed_at || !delivery.claimed_by) return "deferred";
  const { data } = await createAdminClient()
    .rpc("start_email_delivery", {
      p_id: delivery.id,
      p_claimed_by: delivery.claimed_by,
      p_claimed_at: delivery.claimed_at,
      p_attempts: delivery.attempts,
    })
    .throwOnError();
  const executing = data?.[0];
  if (!executing) return "deferred";
  let result;
  try {
    const rendered = await renderDelivery(executing);
    result = await dependencies.transport.send({
      to: executing.recipient,
      ...rendered,
      idempotencyKey: executing.provider_idempotency_key,
    });
  } catch (error) {
    return failDelivery(
      executing,
      {
        kind: "internal",
        reason: error instanceof InternalFailure ? error.reason : "email_send_failed",
      },
      error instanceof Error ? error.message : "send_failed",
      dependencies.now(),
    );
  }
  if (!result.ok) return failDelivery(executing, result, result.message, dependencies.now());
  const row = await updateClaim(executing, {
    state: "sent",
    provider_id: result.kind === "local_noop" ? `local-noop:${executing.id}` : result.providerId,
    sent_at: dependencies.now().toISOString(),
    last_error: null,
    failure_reason: null,
    terminal_cause: null,
    claimed_at: null,
    claimed_by: null,
  });
  return row ? "sent" : "deferred";
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
  for (const row of claimed) {
    try {
      counts[await sendDelivery(row, dependencies)]++;
    } catch (error) {
      // Leave an uncertain execution claimed for recovery, but keep draining.
      counts.deferred++;
      console.error(
        JSON.stringify({
          event: "email_delivery_attempt_failed",
          id: row.id,
          runId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return counts;
}

export async function recoverStuckEmailDeliveries(
  staleBeforeMs = 5 * 60_000,
  now = new Date(),
  runId = "recovery",
  ids?: string[],
) {
  const { data } = await createAdminClient()
    .rpc("recover_email_deliveries", {
      p_stale_before: new Date(now.getTime() - staleBeforeMs).toISOString(),
      p_ids: ids,
    })
    .throwOnError();
  const dead = (data ?? []).filter((row) => row.state === "dead");
  for (const row of dead) logDeadTransition(deadEventFrom(row, "email_delivery", runId));
  return { recovered: data?.length ?? 0, dead: dead.length };
}

async function attemptPending(
  column: "booking_id" | "lead_id",
  id: string,
  overrides: Partial<EmailSendDependencies>,
) {
  const { data } = await createAdminClient()
    .from("email_deliveries")
    .select("id")
    .eq(column, id)
    .throwOnError();
  return runEmailSendOnce(`${column}:${randomUUID()}`, overrides, {
    ids: (data ?? []).map((row) => row.id),
  });
}
export async function attemptPendingForBooking(
  id: string,
  overrides: Partial<EmailSendDependencies> = {},
) {
  return attemptPending("booking_id", id, overrides);
}
export async function attemptPendingForLead(
  id: string,
  overrides: Partial<EmailSendDependencies> = {},
) {
  return attemptPending("lead_id", id, overrides);
}
export async function claimDueDeliveries(
  runId: string,
  limit = 25,
  opts: { now?: Date; ids?: string[] } = {},
) {
  if (limit <= 0 || opts.ids?.length === 0) return [];
  const { data } = await createAdminClient()
    .rpc("claim_email_deliveries", {
      p_run_id: runId,
      p_limit: limit,
      p_now: (opts.now ?? new Date()).toISOString(),
      p_ids: opts.ids,
    })
    .throwOnError();
  return data ?? [];
}
