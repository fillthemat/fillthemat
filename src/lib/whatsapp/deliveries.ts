import { and, eq, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  schools,
  type WhatsAppDelivery,
  whatsappDeliveries,
} from "@/db/schema";
import { logDeadTransition } from "@/lib/retry-log";
import {
  MAX_EXECUTIONS,
  type RetryFailure,
  retryDecision,
} from "@/lib/retry-policy";
import {
  bookingConfirmationIsStale,
  onWhatsAppDeliveryDead,
} from "./confirmation-delivery";
import {
  type WhatsAppWorkerDependencies,
  whatsappWorkerDependencies,
} from "./dependencies";
import type { InboundWhatsAppStatus } from "./status";
import { WHATSAPP_TEMPLATE_LANGUAGE } from "./templates";

function ownedClaim(delivery: WhatsAppDelivery) {
  return and(
    eq(whatsappDeliveries.id, delivery.id),
    eq(whatsappDeliveries.state, "claimed"),
    eq(whatsappDeliveries.claimedBy, delivery.claimedBy ?? ""),
    delivery.claimedAt
      ? eq(whatsappDeliveries.claimedAt, delivery.claimedAt)
      : sql`false`,
    eq(whatsappDeliveries.attempts, delivery.attempts),
  );
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
      ? failure.reason
      : failure.kind;
  const decision = retryDecision(
    stale ? { kind: "internal", reason } : failure,
    delivery.attempts,
    now,
  );
  const code =
    failure.kind === "whatsapp_error"
      ? failure.code
      : failure.kind === "internal" && failure.reason === delivery.failureReason
        ? delivery.failureCode
        : null;
  const row = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(whatsappDeliveries)
      .set({
        state: decision.action === "stop" ? "dead" : "failed",
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
    logDeadTransition({
      queue: "whatsapp_delivery",
      id: row.id,
      schoolId: row.schoolId,
      reason,
      code,
      terminalCause: decision.cause,
      executions: row.attempts,
      runId: delivery.claimedBy ?? "unknown",
    });
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
      params: Array.isArray(delivery.templateParams)
        ? delivery.templateParams
        : [],
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
  now = new Date(),
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .insert(whatsappDeliveries)
    .values({
      schoolId: input.schoolId,
      recipientWaId: input.recipientWaId,
      phoneNumberId: input.phoneNumberId,
      providerIdempotencyKey: input.providerIdempotencyKey,
      templateName: input.templateName ?? null,
      templateParams:
        input.templateParams === undefined ? null : input.templateParams,
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
  opts?: { ids?: string[]; limit?: number; now?: Date },
) {
  const db = getDb();
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? 25;
  return db.transaction(async (tx) => {
    const conditions = [
      or(
        eq(whatsappDeliveries.state, "pending"),
        eq(whatsappDeliveries.state, "failed"),
      ),
      lte(whatsappDeliveries.nextAttemptAt, now),
    ];
    if (opts?.ids && opts.ids.length > 0) {
      conditions.push(inArray(whatsappDeliveries.id, opts.ids));
    }
    const due = await tx
      .select()
      .from(whatsappDeliveries)
      .where(and(...conditions))
      .for("update", { skipLocked: true })
      .limit(limit);

    if (due.length === 0) return [];

    const ids = due.map((row) => row.id);
    return tx
      .update(whatsappDeliveries)
      .set({
        state: "claimed",
        claimedAt: now,
        claimedBy: runId,
        updatedAt: now,
      })
      .where(inArray(whatsappDeliveries.id, ids))
      .returning();
  });
}

export async function sendWhatsAppDelivery(
  claim: WhatsAppDelivery,
  overrides: Partial<WhatsAppWorkerDependencies> = {},
): Promise<WhatsAppDeliveryResult> {
  const dependencies = whatsappWorkerDependencies(overrides);
  const db = getDb();
  let delivery = claim;
  if (
    delivery.state !== "claimed" ||
    !delivery.claimedAt ||
    !delivery.claimedBy
  )
    return "deferred";
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
        reason: delivery.failureReason ?? "attempts_exhausted",
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
    return failDelivery(
      delivery,
      { kind: "internal", reason },
      reason,
      dependencies.now(),
    );
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
      updatedAt: dependencies.now(),
    })
    .where(
      and(
        ownedClaim(delivery),
        lt(whatsappDeliveries.attempts, MAX_EXECUTIONS),
      ),
    )
    .returning();
  if (!executing) return "deferred";
  delivery = executing;

  try {
    const outcome =
      plan.type === "template"
        ? await dependencies.transport.sendTemplate({
            phoneNumberId: delivery.phoneNumberId,
            to: delivery.recipientWaId,
            templateName: plan.templateName,
            languageCode: plan.languageCode,
            params: plan.params,
          })
        : plan.type === "interactive"
          ? await dependencies.transport.sendInteractive({
              phoneNumberId: delivery.phoneNumberId,
              to: delivery.recipientWaId,
              body: plan.body,
              buttons: plan.buttons,
            })
          : await dependencies.transport.sendText({
              phoneNumberId: delivery.phoneNumberId,
              to: delivery.recipientWaId,
              text: delivery.body ?? "",
            });

    if (!outcome.ok) {
      const lastError = `${
        outcome.kind === "whatsapp_error" && outcome.code != null
          ? `${outcome.code}: `
          : ""
      }${outcome.message}`.slice(0, 500);
      return failDelivery(delivery, outcome, lastError, dependencies.now());
    }

    const providerId =
      outcome.kind === "local_noop"
        ? `local-noop:${delivery.id}`
        : outcome.providerId;
    const rows = await db
      .update(whatsappDeliveries)
      .set({
        state: "sent",
        providerId,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    return failDelivery(
      delivery,
      { kind: "internal", reason: "send_failed" },
      message,
      dependencies.now(),
    );
  }
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
  });
  const counts = { sent: 0, retrying: 0, dead: 0, deferred: 0 };
  for (const row of claimed) {
    const result = await sendWhatsAppDelivery(row, dependencies);
    counts[result] += 1;
  }
  return counts;
}

export async function drainDueWhatsAppDeliveries(
  runId: string,
  limit = 25,
  overrides: Partial<WhatsAppWorkerDependencies> = {},
) {
  const dependencies = whatsappWorkerDependencies(overrides);
  const claimed = await claimDueWhatsAppDeliveries(runId, {
    limit,
    now: dependencies.now(),
  });
  const counts = {
    claimed: claimed.length,
    sent: 0,
    retrying: 0,
    dead: 0,
    deferred: 0,
  };
  for (const row of claimed) {
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
export async function applyWhatsAppStatuses(statuses: InboundWhatsAppStatus[]) {
  const db = getDb();
  for (const status of statuses) {
    const [delivery] = await db
      .select()
      .from(whatsappDeliveries)
      .where(eq(whatsappDeliveries.providerId, status.wamid))
      .limit(1);
    if (!delivery || delivery.state === "dead") continue;

    const statusAt =
      status.timestamp != null ? new Date(status.timestamp * 1000) : new Date();
    if (
      delivery.statusAt &&
      statusAt.getTime() <= delivery.statusAt.getTime()
    ) {
      continue;
    }

    if (status.status === "failed") {
      if (delivery.state === "read") continue;
      const lastError = [
        status.errorCode != null ? `code=${status.errorCode}` : null,
        status.errorMessage,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 500);
      await db
        .update(whatsappDeliveries)
        .set({
          state: "failed",
          statusAt,
          lastError: lastError || "delivery_failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(whatsappDeliveries.id, delivery.id),
            ne(whatsappDeliveries.state, "dead"),
          ),
        );
      continue;
    }

    const currentRank = STATE_RANK[delivery.state] ?? 0;
    const nextRank = STATE_RANK[status.status] ?? 0;
    if (nextRank <= currentRank) continue;

    await db
      .update(whatsappDeliveries)
      .set({
        state: status.status,
        statusAt,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappDeliveries.id, delivery.id),
          ne(whatsappDeliveries.state, "dead"),
        ),
      );
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
): Promise<{ recovered: number; dead: number }> {
  const db = getDb();
  const recovered = await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(whatsappDeliveries)
      .where(
        and(
          eq(whatsappDeliveries.state, "claimed"),
          lt(
            whatsappDeliveries.claimedAt,
            new Date(now.getTime() - staleBeforeMs),
          ),
        ),
      )
      .for("update", { skipLocked: true });
    const dead: WhatsAppDelivery[] = [];
    for (const delivery of stale) {
      const reason = (await bookingConfirmationIsStale(delivery, now, tx))
        ? "booking_confirmation_stale"
        : (delivery.failureReason ?? "worker_crashed");
      const decision = retryDecision(
        { kind: "internal", reason },
        delivery.attempts,
        now,
      );
      const [row] = await tx
        .update(whatsappDeliveries)
        .set({
          state: decision.action === "stop" ? "dead" : "pending",
          claimedAt: null,
          claimedBy: null,
          updatedAt: now,
          failureReason:
            decision.action === "stop" ? reason : delivery.failureReason,
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
        dead.push(row);
      }
    }
    return { recovered: stale.length, dead };
  });
  for (const row of recovered.dead)
    logDeadTransition({
      queue: "whatsapp_delivery",
      id: row.id,
      schoolId: row.schoolId,
      reason: row.failureReason ?? "worker_crashed",
      code: row.failureCode,
      terminalCause: row.terminalCause ?? "attempts_exhausted",
      executions: row.attempts,
      runId,
    });
  return { recovered: recovered.recovered, dead: recovered.dead.length };
}
