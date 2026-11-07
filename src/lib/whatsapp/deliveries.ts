import { and, asc, eq, gt, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { getDb, type TransactionOptions } from "@/db";
import { schools, whatsappDeliveries, type WhatsAppDelivery } from "@/db/schema";
import {
  orderClaimedRows,
  ownedQueueClaim,
  recoverClaimedRows,
  takeClaimLanes,
} from "@/lib/queue-claims";
import { deadEventFrom, logDeadTransition } from "@/lib/retry-log";
import {
  internalFailureReasonFrom,
  MAX_EXECUTIONS,
  type RetryFailure,
  whatsappRetryDecision as retryDecision,
} from "@/lib/retry-policy";
import type { WhatsAppSendOutcome } from "./client";
import type { InboundWhatsAppStatus } from "./status";
import {
  bookingConfirmationIsStale,
  onWhatsAppDeliveryConfirmed,
  onWhatsAppDeliveryDead,
} from "./confirmation-delivery";
import { type WhatsAppWorkerDependencies, whatsappWorkerDependencies } from "./dependencies";
import { WHATSAPP_TEMPLATE_LANGUAGE } from "./templates";

function ownedClaim(delivery: WhatsAppDelivery) {
  return ownedQueueClaim(whatsappDeliveries, delivery);
}

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
  const row = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(whatsappDeliveries)
      .set({
        state: decision.action === "stop" ? "dead" : "failed",
        sendOutcome:
          failure.kind === "internal"
            ? undefined
            : ["unknown", "network_error", "malformed_response"].includes(failure.kind)
              ? "unknown"
              : "rejected",
        nextAttemptAt: decision.action === "retry" ? decision.at : undefined,
        lastError: message.slice(0, 500),
        failureReason: reason,
        failureCode: code,
        terminalCause: decision.action === "stop" ? decision.cause : null,
        claimedAt: null,
        claimedBy: null,
        updatedAt: now,
      })
      .where(ownedClaim(delivery))
      .returning();
    if (row?.state === "dead") await onWhatsAppDeliveryDead(tx, row, now);
    return row;
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
  | {
      type: "interactive";
      body: string;
      buttons: Array<{ id: string; title: string }>;
    }
  | { type: "window_closed" };

/**
 * Decide how a delivery should be sent: an explicit template always goes as a
 * template; then an interactive message (reply buttons); otherwise free-form
 * text is allowed only while the 24h customer-service window is open.
 * Closed-window free-form/interactive replies have no Meta-approved template
 * equivalent in v1, so they fail closed instead of sending an out-of-window
 * message.
 */
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
  if (delivery.templateName) {
    return {
      type: "template",
      templateName: delivery.templateName,
      languageCode: WHATSAPP_TEMPLATE_LANGUAGE,
      params: Array.isArray(delivery.templateParams) ? delivery.templateParams : [],
    };
  }
  if (delivery.interactiveButtons && delivery.interactiveButtons.length > 0) {
    if (!windowOpen(delivery.windowExpiresAt, now)) {
      return { type: "window_closed" };
    }
    return {
      type: "interactive",
      body: (delivery.body ?? "").trim(),
      buttons: delivery.interactiveButtons,
    };
  }
  if (windowOpen(delivery.windowExpiresAt, now)) {
    return { type: "text" };
  }
  return { type: "window_closed" };
}

function windowOpen(windowExpiresAt: Date | null, now: Date): boolean {
  return Boolean(windowExpiresAt && windowExpiresAt.getTime() > now.getTime());
}

export type EnqueueWhatsAppDelivery = {
  schoolId: string;
  recipientWaId: string;
  phoneNumberId: string;
  /** Platform enqueue uniqueness only; Meta does not deduplicate sends by it. */
  providerIdempotencyKey: string;
  templateName?: string | null;
  templateParams?: unknown;
  body?: string | null;
  interactiveButtons?: Array<{ id: string; title: string }> | null;
  windowExpiresAt?: Date | null;
  bookingId?: string | null;
  leadId?: string | null;
};

export async function enqueueWhatsAppDelivery(
  input: EnqueueWhatsAppDelivery,
  { now = new Date(), transaction }: TransactionOptions & { now?: Date } = {},
): Promise<string | null> {
  const db = transaction ?? getDb();
  const [row] = await db
    .insert(whatsappDeliveries)
    .values({
      schoolId: input.schoolId,
      recipientWaId: input.recipientWaId,
      phoneNumberId: input.phoneNumberId,
      providerIdempotencyKey: input.providerIdempotencyKey,
      templateName: input.templateName ?? null,
      templateParams: input.templateParams === undefined ? null : input.templateParams,
      body: input.body ?? null,
      interactiveButtons: input.interactiveButtons ?? null,
      windowExpiresAt: input.windowExpiresAt ?? null,
      bookingId: input.bookingId ?? null,
      leadId: input.leadId ?? null,
      state: "pending",
      // Inline delivery must be immediately due even if the DB clock is ahead.
      nextAttemptAt: now,
    })
    .onConflictDoNothing({
      target: whatsappDeliveries.providerIdempotencyKey,
    })
    .returning({ id: whatsappDeliveries.id });
  return row?.id ?? null;
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
) {
  const db = getDb();
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? 25;
  if (opts?.ids?.length === 0 || opts?.phoneNumberIds?.length === 0 || limit <= 0) return [];
  return db.transaction(async (tx) => {
    const due = await takeClaimLanes(
      limit,
      async (fresh, count, excludedIds) => {
        const rows = await tx
          .select()
          .from(whatsappDeliveries)
          .where(
            and(
              inArray(whatsappDeliveries.state, ["pending", "failed"]),
              lte(whatsappDeliveries.nextAttemptAt, now),
              opts?.phoneNumberIds
                ? inArray(whatsappDeliveries.phoneNumberId, opts.phoneNumberIds)
                : undefined,
              fresh ? eq(whatsappDeliveries.attempts, 0) : gt(whatsappDeliveries.attempts, 0),
              opts?.ids ? inArray(whatsappDeliveries.id, opts.ids) : undefined,
              excludedIds.length ? notInArray(whatsappDeliveries.id, excludedIds) : undefined,
            ),
          )
          .orderBy(asc(whatsappDeliveries.createdAt), asc(whatsappDeliveries.id))
          .for("update", { skipLocked: true })
          .limit(count);
        return rows;
      },
      opts?.retryOnly,
    );

    if (due.length === 0) return [];

    const ids = due.map((row) => row.id);
    const claimed = await tx
      .update(whatsappDeliveries)
      .set({
        state: "claimed",
        claimedAt: now,
        claimedBy: runId,
        updatedAt: now,
      })
      .where(inArray(whatsappDeliveries.id, ids))
      .returning();
    return orderClaimedRows(due, claimed);
  });
}

export async function sendWhatsAppDelivery(
  claim: WhatsAppDelivery,
  overrides: Partial<WhatsAppWorkerDependencies> = {},
): Promise<WhatsAppDeliveryResult> {
  const dependencies = whatsappWorkerDependencies(overrides);
  const db = getDb();
  let delivery = claim;
  if (delivery.state !== "claimed" || !delivery.claimedAt || !delivery.claimedBy) return "deferred";
  if (await bookingConfirmationIsStale(delivery, dependencies.now())) {
    return failDelivery(
      delivery,
      { kind: "internal", reason: "booking_confirmation_stale" },
      "booking_confirmation_stale",
      dependencies.now(),
    );
  }
  if (delivery.attempts >= MAX_EXECUTIONS) {
    return failDelivery(
      delivery,
      {
        kind: "internal",
        reason: internalFailureReasonFrom(delivery.failureReason, "attempts_exhausted"),
      },
      delivery.lastError ?? "attempts_exhausted",
      dependencies.now(),
    );
  }

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, delivery.schoolId))
    .limit(1);
  if (!school?.approvedAt) {
    const reason = school ? "school_not_approved" : "school_missing";
    return failDelivery(delivery, { kind: "internal", reason }, reason, dependencies.now());
  }

  const plan = planWhatsAppDelivery(
    {
      templateName: delivery.templateName,
      templateParams: delivery.templateParams,
      windowExpiresAt: delivery.windowExpiresAt,
      interactiveButtons: delivery.interactiveButtons,
      body: delivery.body,
    },
    dependencies.now(),
  );
  if (plan.type === "window_closed") {
    return failDelivery(
      delivery,
      { kind: "internal", reason: "window_closed" },
      "window_closed",
      dependencies.now(),
    );
  }

  // Reserve durably immediately before invoking transport. Accepted sends and
  // crashes use this same execution; finalizers never increment it again.
  const [executing] = await db
    .update(whatsappDeliveries)
    .set({
      attempts: sql`${whatsappDeliveries.attempts} + 1`,
      // A crash after reservation may have reached Meta. Prefer retry/duplicate
      // risk over loss, and retain this outcome even if the budget is exhausted.
      sendOutcome: "unknown",
      // Starting a new execution invalidates receipts for the prior send,
      // even if this request fails synchronously and gets no new provider ID.
      providerId: null,
      statusAt: null,
      updatedAt: dependencies.now(),
    })
    .where(and(ownedClaim(delivery), lt(whatsappDeliveries.attempts, MAX_EXECUTIONS)))
    .returning();
  if (!executing) return "deferred";
  delivery = executing;

  let outcome: WhatsAppSendOutcome;
  try {
    outcome =
      plan.type === "template"
        ? await dependencies.transport.sendTemplate({
            phoneNumberId: delivery.phoneNumberId,
            to: delivery.recipientWaId,
            templateName: plan.templateName,
            languageCode: plan.languageCode,
            params: plan.params,
            callbackData: `${delivery.id}:${delivery.attempts}`,
          })
        : plan.type === "interactive"
          ? await dependencies.transport.sendInteractive({
              phoneNumberId: delivery.phoneNumberId,
              to: delivery.recipientWaId,
              body: plan.body,
              buttons: plan.buttons,
              callbackData: `${delivery.id}:${delivery.attempts}`,
            })
          : await dependencies.transport.sendText({
              phoneNumberId: delivery.phoneNumberId,
              to: delivery.recipientWaId,
              text: delivery.body ?? "",
              callbackData: `${delivery.id}:${delivery.attempts}`,
            });
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    return failDelivery(
      delivery,
      { ok: false, kind: "unknown", reason: "network_error", message },
      message,
      dependencies.now(),
    );
  }

  if (!outcome.ok) {
    const lastError = `${
      outcome.kind === "whatsapp_error" && outcome.code != null ? `${outcome.code}: ` : ""
    }${outcome.message}`.slice(0, 500);
    return failDelivery(delivery, outcome, lastError, dependencies.now());
  }

  const providerId =
    outcome.kind === "local_noop" ? `local-noop:${delivery.id}` : outcome.providerId;
  const rows = await db
    .update(whatsappDeliveries)
    .set({
      state: "sent",
      sendOutcome: "accepted",
      providerId,
      statusAt: null,
      sentAt: dependencies.now(),
      lastError: null,
      failureReason: null,
      failureCode: null,
      terminalCause: null,
      claimedAt: null,
      claimedBy: null,
      updatedAt: dependencies.now(),
    })
    .where(ownedClaim(delivery))
    .returning({ id: whatsappDeliveries.id });
  return rows.length ? "sent" : "deferred";
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
  for (const row of claimed) {
    const result = await sendWhatsAppDelivery(row, dependencies);
    counts[result] += 1;
  }
  return counts;
}

/** A newly enqueued single side effect gets one immediate attempt, never a sweep. */
export async function enqueueAndAttemptWhatsAppDelivery(
  input: EnqueueWhatsAppDelivery,
  runId: string,
  dependencies: WhatsAppWorkerDependencies,
) {
  const id = await enqueueWhatsAppDelivery(input, { now: dependencies.now() });
  if (id) await attemptWhatsAppDeliveriesNow([id], runId, dependencies);
  return id;
}

/** Ignore fresh and claimed work when choosing an in-run retry wake-up. */
export async function nextWhatsAppDeliveryRetryAt(
  now: Date,
  before: Date,
  phoneNumberIds?: string[],
) {
  if (phoneNumberIds?.length === 0) return null;
  const [row] = await getDb()
    .select({ at: whatsappDeliveries.nextAttemptAt })
    .from(whatsappDeliveries)
    .where(
      and(
        inArray(whatsappDeliveries.state, ["pending", "failed"]),
        gt(whatsappDeliveries.attempts, 0),
        gt(whatsappDeliveries.nextAttemptAt, now),
        lt(whatsappDeliveries.nextAttemptAt, before),
        phoneNumberIds ? inArray(whatsappDeliveries.phoneNumberId, phoneNumberIds) : undefined,
      ),
    )
    .orderBy(asc(whatsappDeliveries.nextAttemptAt))
    .limit(1);
  return row?.at ?? null;
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
  const counts = {
    claimed: claimed.length,
    sent: 0,
    retrying: 0,
    dead: 0,
    deferred: 0,
  };
  for (const row of claimed) {
    if (opts.deadline && dependencies.now() >= opts.deadline) {
      await getDb()
        .update(whatsappDeliveries)
        .set({
          state: row.attempts > 0 ? "failed" : "pending",
          claimedAt: null,
          claimedBy: null,
          updatedAt: dependencies.now(),
        })
        .where(ownedClaim(row));
      counts.deferred += 1;
      continue;
    }
    const result = await sendWhatsAppDelivery(row, dependencies);
    counts[result] += 1;
  }
  return counts;
}

const STATE_RANK: Record<string, number> = {
  pending: 0,
  claimed: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

/**
 * Apply Meta delivery-status callbacks by `provider_id` (wamid), guarded by the
 * status timestamp so an out-of-order callback cannot regress a delivery.
 */
export async function applyWhatsAppStatuses(
  statuses: InboundWhatsAppStatus[],
  overrides: Pick<Partial<WhatsAppWorkerDependencies>, "now"> = {},
) {
  const db = getDb();
  const clock = overrides.now ?? (() => new Date());
  for (const status of statuses) {
    // Meta echoes this opaque correlation token; it is not a provider dedupe
    // key. Never guess by recipient, or let an older attempt cancel a retry.
    const callback = status.callbackData?.match(
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]*)$/i,
    );
    // Serialize the current provider attempt with claims and other callbacks.
    // No outbound network calls take place while holding this lock.
    const transitioned = await db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(whatsappDeliveries)
        .where(
          or(
            eq(whatsappDeliveries.providerId, status.wamid),
            callback && Number(callback[2]) <= MAX_EXECUTIONS && status.phoneNumberId
              ? and(
                  eq(whatsappDeliveries.id, callback[1]),
                  eq(whatsappDeliveries.attempts, Number(callback[2])),
                  eq(whatsappDeliveries.phoneNumberId, status.phoneNumberId),
                  eq(whatsappDeliveries.sendOutcome, "unknown"),
                  isNull(whatsappDeliveries.providerId),
                )
              : undefined,
          ),
        )
        .for("update")
        .limit(1);
      if (!delivery) return;
      const reconcilesUnknown = delivery.sendOutcome === "unknown";
      if (delivery.state === "dead" && (!reconcilesUnknown || status.status === "failed")) return;
      const providerMatch = delivery.providerId
        ? eq(whatsappDeliveries.providerId, status.wamid)
        : isNull(whatsappDeliveries.providerId);

      const now = clock();
      const statusAt =
        status.timestamp != null
          ? new Date(status.timestamp * 1000)
          : (delivery.statusAt ?? delivery.sentAt ?? now);
      if (!Number.isFinite(statusAt.getTime())) return;
      if (status.timestamp != null && delivery.statusAt && statusAt <= delivery.statusAt) return;

      if (status.status === "failed") {
        // One failure decision per accepted send, including timestamp-less
        // replays. Positive delivery evidence is never eligible for resending.
        if (delivery.state !== "sent" && !reconcilesUnknown) return;
        const parsedCode = status.errorCode?.trim() ? Number(status.errorCode) : Number.NaN;
        const code = Number.isInteger(parsedCode) ? parsedCode : null;
        const stale = await bookingConfirmationIsStale(delivery, now, tx);
        const decision = retryDecision(
          stale
            ? { kind: "internal", reason: "booking_confirmation_stale" }
            : {
                ok: false,
                kind: "whatsapp_error",
                code,
                subcode: status.errorSubcode ?? null,
                details: status.errorDetails ?? null,
                status: 0,
                message: status.errorMessage ?? "delivery_failed",
              },
          delivery.attempts,
          now,
        );
        const [row] = await tx
          .update(whatsappDeliveries)
          .set({
            state: decision.action === "stop" ? "dead" : "failed",
            sendOutcome: "accepted",
            providerId: status.wamid,
            nextAttemptAt: decision.action === "retry" ? decision.at : undefined,
            statusAt,
            lastError:
              [status.errorCode != null ? `code=${status.errorCode}` : null, status.errorMessage]
                .filter(Boolean)
                .join(" ")
                .slice(0, 500) || "delivery_failed",
            failureReason: stale ? "booking_confirmation_stale" : "whatsapp_error",
            failureCode: code,
            terminalCause: decision.action === "stop" ? decision.cause : null,
            claimedAt: null,
            claimedBy: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(whatsappDeliveries.id, delivery.id),
              providerMatch,
              eq(whatsappDeliveries.state, delivery.state),
              eq(whatsappDeliveries.attempts, delivery.attempts),
            ),
          )
          .returning();
        if (row?.state === "dead") await onWhatsAppDeliveryDead(tx, row, now);
        return row;
      }

      const currentRank = STATE_RANK[delivery.state] ?? 0;
      const nextRank = STATE_RANK[status.status] ?? 0;
      if (nextRank < currentRank) return;
      // A later sent receipt is not proof a failed send was delivered. Only
      // delivered/read may cancel its scheduled retry for this same attempt.
      // An unknown send has no rejection evidence, so sent resolves it too.
      if (
        ["pending", "claimed", "failed"].includes(delivery.state) &&
        status.status === "sent" &&
        !reconcilesUnknown
      )
        return;
      const [confirmed] = await tx
        .update(whatsappDeliveries)
        .set({
          state: status.status,
          sendOutcome: "accepted",
          providerId: status.wamid,
          sentAt: delivery.sentAt ?? statusAt,
          statusAt,
          lastError: null,
          failureReason: null,
          failureCode: null,
          terminalCause: null,
          claimedAt: null,
          claimedBy: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(whatsappDeliveries.id, delivery.id),
            providerMatch,
            eq(whatsappDeliveries.state, delivery.state),
            eq(whatsappDeliveries.attempts, delivery.attempts),
          ),
        )
        .returning();
      if (confirmed) await onWhatsAppDeliveryConfirmed(tx, confirmed);
    });
    // Only an actual terminal transition may log or enqueue a notification.
    if (transitioned?.state === "dead")
      logDeadTransition(deadEventFrom(transitioned, "whatsapp_delivery", "status_callback"));
  }
}

/**
 * Requeue `claimed` deliveries whose sender died mid-flight so a later sweep
 * can retry them instead of stranding them forever. Idempotent: only rows
 * claimed longer than `staleBeforeMs` are touched.
 */
export async function recoverStuckWhatsAppDeliveries(
  staleBeforeMs = 5 * 60_000,
  now = new Date(),
  runId = "recovery",
  phoneNumberIds?: string[],
): Promise<{ recovered: number; dead: number }> {
  if (phoneNumberIds?.length === 0) return { recovered: 0, dead: 0 };
  const db = getDb();
  const recovered = await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(whatsappDeliveries)
      .where(
        and(
          eq(whatsappDeliveries.state, "claimed"),
          phoneNumberIds ? inArray(whatsappDeliveries.phoneNumberId, phoneNumberIds) : undefined,
          lt(whatsappDeliveries.claimedAt, new Date(now.getTime() - staleBeforeMs)),
        ),
      )
      .for("update", { skipLocked: true });
    return recoverClaimedRows(stale, async (delivery) => {
      const reason = (await bookingConfirmationIsStale(delivery, now, tx))
        ? "booking_confirmation_stale"
        : internalFailureReasonFrom(delivery.failureReason, "worker_crashed");
      const decision = retryDecision({ kind: "internal", reason }, delivery.attempts, now);
      const [row] = await tx
        .update(whatsappDeliveries)
        .set({
          state: decision.action === "stop" ? "dead" : "pending",
          claimedAt: null,
          claimedBy: null,
          updatedAt: now,
          failureReason:
            decision.action === "stop"
              ? reason === "booking_confirmation_stale"
                ? reason
                : (delivery.failureReason ?? reason)
              : delivery.failureReason,
          lastError:
            decision.action === "stop"
              ? (delivery.lastError ?? "worker_crashed")
              : delivery.lastError,
          terminalCause: decision.action === "stop" ? decision.cause : null,
        })
        .where(ownedClaim(delivery))
        .returning();
      if (row?.state === "dead") {
        await onWhatsAppDeliveryDead(tx, row, now);
      }
      return row;
    });
  });
  for (const row of recovered.dead)
    logDeadTransition(deadEventFrom(row, "whatsapp_delivery", runId));
  return { recovered: recovered.recovered, dead: recovered.dead.length };
}
