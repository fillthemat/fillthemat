import type { Json } from "@/db/types";
import { deadEventFrom, logDeadTransition } from "@/lib/retry-log";
import {
  internalFailureReasonFrom,
  MAX_EXECUTIONS,
  type RetryFailure,
  whatsappRetryDecision as retryDecision,
} from "@/lib/retry-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WhatsAppSendOutcome } from "./client";
import type { InboundWhatsAppStatus } from "./status";
import { bookingConfirmationIsStale } from "./confirmation-delivery";
import { type WhatsAppWorkerDependencies, whatsappWorkerDependencies } from "./dependencies";
import {
  deliveryFromRow,
  publicSchoolIdForPhone,
  updateDeliveryClaim,
  type WhatsAppDelivery,
} from "./queue-store";
import { WHATSAPP_TEMPLATE_LANGUAGE } from "./templates";
export type { WhatsAppDelivery } from "./queue-store";

export type WhatsAppDeliveryResult = "sent" | "retrying" | "dead" | "deferred";
async function failDelivery(
  delivery: WhatsAppDelivery,
  failure: RetryFailure,
  message: string,
  now: Date,
): Promise<WhatsAppDeliveryResult> {
  const stale = await bookingConfirmationIsStale(delivery, now);
  const reason = stale
    ? "booking_confirmation_stale"
    : failure.kind === "internal"
      ? failure.reason === "attempts_exhausted"
        ? (delivery.failureReason ?? failure.reason)
        : failure.reason
      : failure.kind === "unknown"
        ? failure.reason
        : failure.kind;
  const decision = retryDecision(
    stale ? { kind: "internal", reason: "booking_confirmation_stale" } : failure,
    delivery.attempts,
    now,
  );
  const code =
    failure.kind === "whatsapp_error"
      ? failure.code
      : failure.kind === "internal" &&
          (failure.reason === delivery.failureReason || failure.reason === "attempts_exhausted")
        ? delivery.failureCode
        : null;
  const row = await updateDeliveryClaim(delivery, {
    state: decision.action === "stop" ? "dead" : "failed",
    send_outcome:
      failure.kind === "internal"
        ? undefined
        : ["unknown", "network_error", "malformed_response"].includes(failure.kind)
          ? "unknown"
          : "rejected",
    next_attempt_at: decision.action === "retry" ? decision.at.toISOString() : undefined,
    last_error: message.slice(0, 500),
    failure_reason: reason,
    failure_code: code,
    terminal_cause: decision.action === "stop" ? decision.cause : null,
    claimed_at: null,
    claimed_by: null,
    updated_at: now.toISOString(),
  });
  if (!row) return "deferred";
  if (decision.action === "stop")
    logDeadTransition(deadEventFrom(row, "whatsapp_delivery", delivery.claimedBy ?? "unknown"));
  return decision.action === "stop" ? "dead" : "retrying";
}

export type WhatsappDeliveryPlan =
  | { type: "text" }
  | {
      type: "template";
      templateName: string;
      languageCode: string;
      params: unknown[];
    }
  | { type: "interactive"; body: string; buttons: Array<{ id: string; title: string }> }
  | { type: "window_closed" };

/** Explicit templates bypass the 24-hour free-form customer-service window. */
export function planWhatsAppDelivery(
  delivery: {
    templateName: string | null;
    templateParams: unknown;
    windowExpiresAt: Date | null;
    interactiveButtons?: Array<{ id: string; title: string }> | null;
    body?: string | null;
  },
  now = new Date(),
): WhatsappDeliveryPlan {
  if (delivery.templateName)
    return {
      type: "template",
      templateName: delivery.templateName,
      languageCode: WHATSAPP_TEMPLATE_LANGUAGE,
      params: Array.isArray(delivery.templateParams) ? delivery.templateParams : [],
    };
  if (!delivery.windowExpiresAt || delivery.windowExpiresAt <= now)
    return { type: "window_closed" };
  if (delivery.interactiveButtons?.length)
    return {
      type: "interactive",
      body: (delivery.body ?? "").trim(),
      buttons: delivery.interactiveButtons,
    };
  return { type: "text" };
}

export type EnqueueWhatsAppDelivery = {
  schoolId: string;
  recipientWaId: string;
  phoneNumberId: string;
  /** Platform enqueue uniqueness only; Meta does not deduplicate sends by it. */
  providerIdempotencyKey: string;
  templateName?: string | null;
  templateParams?: Json;
  body?: string | null;
  interactiveButtons?: Array<{ id: string; title: string }> | null;
  windowExpiresAt?: Date | null;
  bookingId?: string | null;
  leadId?: string | null;
};

export async function enqueueWhatsAppDelivery(
  input: EnqueueWhatsAppDelivery,
  { now = new Date() }: { now?: Date } = {},
): Promise<string | null> {
  // Legacy Turn/booking callers carry app.schools IDs until #253. Resolve every
  // enqueue through private public settings rather than crossing that FK boundary.
  const schoolId = await publicSchoolIdForPhone(input.phoneNumberId);
  if (!schoolId) throw new Error("unknown_phone_number");
  const { data } = await createAdminClient()
    .rpc("enqueue_whatsapp_delivery", {
      p_school_id: schoolId,
      p_recipient: input.recipientWaId,
      p_phone_number_id: input.phoneNumberId,
      p_key: input.providerIdempotencyKey,
      p_template_name: input.templateName ?? undefined,
      p_template_params: input.templateParams ?? undefined,
      p_body: input.body ?? undefined,
      p_buttons: input.interactiveButtons ?? undefined,
      p_window_expires_at: input.windowExpiresAt?.toISOString(),
      p_booking_id: input.bookingId ?? undefined,
      p_lead_id: input.leadId ?? undefined,
      p_now: now.toISOString(),
    })
    .throwOnError();
  return data;
}

export async function claimDueWhatsAppDeliveries(
  runId: string,
  opts?: {
    ids?: string[];
    limit?: number;
    now?: Date;
    retryOnly?: boolean;
    phoneNumberIds?: string[];
  },
): Promise<WhatsAppDelivery[]> {
  const { data } = await createAdminClient()
    .rpc("claim_whatsapp_deliveries", {
      p_run_id: runId,
      p_limit: opts?.limit ?? 25,
      p_now: (opts?.now ?? new Date()).toISOString(),
      p_ids: opts?.ids,
      p_retry_only: opts?.retryOnly,
      p_phone_number_ids: opts?.phoneNumberIds,
    })
    .throwOnError();
  return (data ?? []).map(deliveryFromRow);
}

export async function sendWhatsAppDelivery(
  claim: WhatsAppDelivery,
  overrides: Partial<WhatsAppWorkerDependencies> = {},
): Promise<WhatsAppDeliveryResult> {
  const dependencies = whatsappWorkerDependencies(overrides);
  let delivery = claim;
  if (delivery.state !== "claimed" || !delivery.claimedAt || !delivery.claimedBy) return "deferred";
  if (await bookingConfirmationIsStale(delivery, dependencies.now()))
    return failDelivery(
      delivery,
      { kind: "internal", reason: "booking_confirmation_stale" },
      "booking_confirmation_stale",
      dependencies.now(),
    );
  if (delivery.attempts >= MAX_EXECUTIONS)
    return failDelivery(
      delivery,
      {
        kind: "internal",
        reason: internalFailureReasonFrom(delivery.failureReason, "attempts_exhausted"),
      },
      delivery.lastError ?? "attempts_exhausted",
      dependencies.now(),
    );
  const { data: school } = await createAdminClient()
    .from("schools")
    .select("approved_at")
    .eq("id", delivery.schoolId)
    .maybeSingle()
    .throwOnError();
  if (!school?.approved_at) {
    const reason = school ? "school_not_approved" : "school_missing";
    return failDelivery(delivery, { kind: "internal", reason }, reason, dependencies.now());
  }
  const plan = planWhatsAppDelivery(delivery, dependencies.now());
  if (plan.type === "window_closed")
    return failDelivery(
      delivery,
      { kind: "internal", reason: "window_closed" },
      "window_closed",
      dependencies.now(),
    );
  const { data } = await createAdminClient()
    .rpc("start_whatsapp_delivery", {
      p_id: delivery.id,
      p_claimed_by: delivery.claimedBy,
      p_claimed_at: delivery.claimedAt,
      p_attempts: delivery.attempts,
    })
    .throwOnError();
  if (!data?.[0]) return "deferred";
  delivery = deliveryFromRow(data[0]);
  let outcome: WhatsAppSendOutcome;
  const common = {
    phoneNumberId: delivery.phoneNumberId,
    to: delivery.recipientWaId,
    callbackData: `${delivery.id}:${delivery.attempts}`,
  };
  try {
    outcome =
      plan.type === "template"
        ? await dependencies.transport.sendTemplate({
            ...common,
            templateName: plan.templateName,
            languageCode: plan.languageCode,
            params: plan.params,
          })
        : plan.type === "interactive"
          ? await dependencies.transport.sendInteractive({
              ...common,
              body: plan.body,
              buttons: plan.buttons,
            })
          : await dependencies.transport.sendText({ ...common, text: delivery.body ?? "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    return failDelivery(
      delivery,
      { ok: false, kind: "unknown", reason: "network_error", message },
      message,
      dependencies.now(),
    );
  }
  if (!outcome.ok)
    return failDelivery(
      delivery,
      outcome,
      `${outcome.kind === "whatsapp_error" && outcome.code != null ? `${outcome.code}: ` : ""}${outcome.message}`,
      dependencies.now(),
    );
  const row = await updateDeliveryClaim(delivery, {
    state: "sent",
    send_outcome: "accepted",
    provider_id: outcome.kind === "local_noop" ? `local-noop:${delivery.id}` : outcome.providerId,
    status_at: null,
    sent_at: dependencies.now().toISOString(),
    last_error: null,
    failure_reason: null,
    failure_code: null,
    terminal_cause: null,
    claimed_at: null,
    claimed_by: null,
    updated_at: dependencies.now().toISOString(),
  });
  return row ? "sent" : "deferred";
}

export async function attemptWhatsAppDeliveriesNow(
  ids: string[],
  runId: string,
  overrides: Partial<WhatsAppWorkerDependencies> = {},
) {
  const dependencies = whatsappWorkerDependencies(overrides);
  const claimed = await claimDueWhatsAppDeliveries(runId, {
    ids,
    now: dependencies.now(),
    phoneNumberIds: dependencies.phoneNumberIds,
  });
  const counts = { sent: 0, retrying: 0, dead: 0, deferred: 0 };
  for (const row of claimed) counts[await sendWhatsAppDelivery(row, dependencies)] += 1;
  return counts;
}

export async function enqueueAndAttemptWhatsAppDelivery(
  input: EnqueueWhatsAppDelivery,
  runId: string,
  dependencies: WhatsAppWorkerDependencies,
) {
  const id = await enqueueWhatsAppDelivery(input, { now: dependencies.now() });
  if (id) await attemptWhatsAppDeliveriesNow([id], runId, dependencies);
  return id;
}

export async function nextWhatsAppDeliveryRetryAt(
  now: Date,
  before: Date,
  phoneNumberIds?: string[],
) {
  let query = createAdminClient()
    .from("whatsapp_deliveries")
    .select("next_attempt_at")
    .in("state", ["pending", "failed"])
    .gt("attempts", 0)
    .gt("next_attempt_at", now.toISOString())
    .lt("next_attempt_at", before.toISOString());
  if (phoneNumberIds) query = query.in("phone_number_id", phoneNumberIds);
  const { data } = await query.order("next_attempt_at").limit(1).maybeSingle().throwOnError();
  return data ? new Date(data.next_attempt_at) : null;
}

export async function drainDueWhatsAppDeliveries(
  runId: string,
  limit = 25,
  overrides: Partial<WhatsAppWorkerDependencies> = {},
  opts: { retryOnly?: boolean; deadline?: Date } = {},
) {
  const dependencies = whatsappWorkerDependencies(overrides);
  const claimed =
    opts.deadline && dependencies.now() >= opts.deadline
      ? []
      : await claimDueWhatsAppDeliveries(runId, {
          limit,
          now: dependencies.now(),
          retryOnly: opts.retryOnly,
          phoneNumberIds: dependencies.phoneNumberIds,
        });
  const counts = { claimed: claimed.length, sent: 0, retrying: 0, dead: 0, deferred: 0 };
  for (const row of claimed) {
    if (opts.deadline && dependencies.now() >= opts.deadline) {
      await updateDeliveryClaim(row, {
        state: row.attempts > 0 ? "failed" : "pending",
        claimed_at: null,
        claimed_by: null,
      });
      counts.deferred += 1;
    } else counts[await sendWhatsAppDelivery(row, dependencies)] += 1;
  }
  return counts;
}

export async function applyWhatsAppStatuses(
  statuses: InboundWhatsAppStatus[],
  overrides: Pick<Partial<WhatsAppWorkerDependencies>, "now"> = {},
) {
  for (const status of statuses) {
    const now = (overrides.now ?? (() => new Date()))();
    const callback = status.callbackData?.match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]*)$/i,
    );
    const at = status.timestamp == null ? undefined : new Date(status.timestamp * 1000);
    if (at && !Number.isFinite(at.getTime())) continue;
    const parsedCode = status.errorCode?.trim() ? Number(status.errorCode) : Number.NaN;
    const code = Number.isInteger(parsedCode) ? parsedCode : null;
    const decision = retryDecision(
      {
        ok: false,
        kind: "whatsapp_error",
        code,
        subcode: status.errorSubcode ?? null,
        details: status.errorDetails ?? null,
        status: 0,
        message: status.errorMessage ?? "delivery_failed",
      },
      0,
      now,
    );
    const { data } = await createAdminClient()
      .rpc("apply_whatsapp_status", {
        p_wamid: status.wamid,
        p_status: status.status,
        p_status_at: at?.toISOString(),
        p_callback_id: callback?.[1],
        p_callback_attempt:
          callback && Number(callback[2]) <= MAX_EXECUTIONS ? Number(callback[2]) : undefined,
        p_phone_number_id: status.phoneNumberId ?? undefined,
        p_permanent: decision.action === "stop",
        p_code: code ?? undefined,
        p_error:
          [status.errorCode ? `code=${status.errorCode}` : null, status.errorMessage]
            .filter(Boolean)
            .join(" ") || "delivery_failed",
        p_now: now.toISOString(),
      })
      .throwOnError();
    for (const row of data ?? [])
      if (row.state === "dead")
        logDeadTransition(deadEventFrom(row, "whatsapp_delivery", "status_callback"));
  }
}

export async function recoverStuckWhatsAppDeliveries(
  staleBeforeMs = 5 * 60_000,
  now = new Date(),
  runId = "recovery",
  phoneNumberIds?: string[],
): Promise<{ recovered: number; dead: number }> {
  const { data } = await createAdminClient()
    .rpc("recover_whatsapp_deliveries", {
      p_stale_before: new Date(now.getTime() - staleBeforeMs).toISOString(),
      p_phone_number_ids: phoneNumberIds,
      p_now: now.toISOString(),
    })
    .throwOnError();
  const dead = (data ?? []).filter((row) => row.state === "dead");
  for (const row of dead) logDeadTransition(deadEventFrom(row, "whatsapp_delivery", runId));
  return { recovered: (data?.length ?? 0) - dead.length, dead: dead.length };
}
