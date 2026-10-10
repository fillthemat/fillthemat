import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { schools, whatsappDeliveries } from "@/db/schema";
import {
  sendWhatsAppInteractive,
  sendWhatsAppTemplate,
  sendWhatsAppText,
} from "./client";
import type { InboundWhatsAppStatus } from "./status";
import { WHATSAPP_TEMPLATE_LANGUAGE } from "./templates";

function nextBackoff(attempts: number): Date {
  const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + minutes * 60_000);
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
    })
    .onConflictDoNothing({
      target: whatsappDeliveries.providerIdempotencyKey,
    })
    .returning({ id: whatsappDeliveries.id });
  return row?.id ?? null;
}

export async function claimDueWhatsAppDeliveries(
  runId: string,
  opts?: { ids?: string[]; limit?: number },
) {
  const db = getDb();
  const limit = opts?.limit ?? 25;
  return db.transaction(async (tx) => {
    const conditions = [
      or(
        eq(whatsappDeliveries.state, "pending"),
        eq(whatsappDeliveries.state, "failed"),
      ),
      lte(whatsappDeliveries.nextAttemptAt, sql`now()`),
    ];
    if (opts?.ids) {
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
    await tx
      .update(whatsappDeliveries)
      .set({
        state: "claimed",
        claimedAt: new Date(),
        claimedBy: runId,
        updatedAt: new Date(),
      })
      .where(inArray(whatsappDeliveries.id, ids));

    return due;
  });
}

export async function sendWhatsAppDelivery(
  deliveryId: string,
): Promise<"sent" | "failed" | "window_closed"> {
  const db = getDb();
  const [delivery] = await db
    .select()
    .from(whatsappDeliveries)
    .where(eq(whatsappDeliveries.id, deliveryId))
    .limit(1);
  if (!delivery) return "failed";

  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, delivery.schoolId))
    .limit(1);
  if (!school?.approvedAt) {
    await db
      .update(whatsappDeliveries)
      .set({
        state: "failed",
        lastError: "school_not_approved",
        attempts: delivery.attempts + 1,
        nextAttemptAt: nextBackoff(delivery.attempts + 1),
        updatedAt: new Date(),
      })
      .where(eq(whatsappDeliveries.id, delivery.id));
    return "failed";
  }

  const plan = planWhatsAppDelivery({
    templateName: delivery.templateName,
    templateParams: delivery.templateParams,
    windowExpiresAt: delivery.windowExpiresAt,
    interactiveButtons: delivery.interactiveButtons,
    body: delivery.body,
  });
  if (plan.type === "window_closed") {
    await db
      .update(whatsappDeliveries)
      .set({
        state: "failed",
        lastError: "window_closed",
        attempts: delivery.attempts + 1,
        nextAttemptAt: nextBackoff(delivery.attempts + 1),
        updatedAt: new Date(),
      })
      .where(eq(whatsappDeliveries.id, delivery.id));
    return "window_closed";
  }

  try {
    const outcome =
      plan.type === "template"
        ? await sendWhatsAppTemplate({
            phoneNumberId: delivery.phoneNumberId,
            to: delivery.recipientWaId,
            templateName: plan.templateName,
            languageCode: plan.languageCode,
            params: plan.params,
          })
        : plan.type === "interactive"
          ? await sendWhatsAppInteractive({
              phoneNumberId: delivery.phoneNumberId,
              to: delivery.recipientWaId,
              body: plan.body,
              buttons: plan.buttons,
            })
          : await sendWhatsAppText({
              phoneNumberId: delivery.phoneNumberId,
              to: delivery.recipientWaId,
              text: delivery.body ?? "",
            });

    if (!outcome.ok) {
      const lastError = `${
        outcome.code != null ? `${outcome.code}: ` : ""
      }${outcome.message}`.slice(0, 500);
      await db
        .update(whatsappDeliveries)
        .set({
          state: "failed",
          lastError,
          attempts: delivery.attempts + 1,
          nextAttemptAt: nextBackoff(delivery.attempts + 1),
          updatedAt: new Date(),
        })
        .where(eq(whatsappDeliveries.id, delivery.id));
      return "failed";
    }

    const providerId = outcome.providerId ?? `local-noop:${delivery.id}`;
    await db
      .update(whatsappDeliveries)
      .set({
        state: "sent",
        providerId,
        sentAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(whatsappDeliveries.id, delivery.id));
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    await db
      .update(whatsappDeliveries)
      .set({
        state: "failed",
        lastError: message.slice(0, 500),
        attempts: delivery.attempts + 1,
        nextAttemptAt: nextBackoff(delivery.attempts + 1),
        updatedAt: new Date(),
      })
      .where(eq(whatsappDeliveries.id, delivery.id));
    return "failed";
  }
}

export async function attemptWhatsAppDeliveriesNow(
  ids: string[],
  runId: string,
) {
  const claimed = await claimDueWhatsAppDeliveries(runId, { ids });
  let sent = 0;
  let failed = 0;
  let windowClosed = 0;
  for (const row of claimed) {
    const result = await sendWhatsAppDelivery(row.id);
    if (result === "sent") sent += 1;
    else if (result === "window_closed") windowClosed += 1;
    else failed += 1;
  }
  return { sent, failed, windowClosed };
}

export async function drainDueWhatsAppDeliveries(runId: string, limit = 25) {
  const claimed = await claimDueWhatsAppDeliveries(runId, { limit });
  let sent = 0;
  let failed = 0;
  let windowClosed = 0;
  for (const row of claimed) {
    const result = await sendWhatsAppDelivery(row.id);
    if (result === "sent") sent += 1;
    else if (result === "window_closed") windowClosed += 1;
    else failed += 1;
  }
  return { claimed: claimed.length, sent, failed, windowClosed };
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
    if (!delivery) continue;

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
        .where(eq(whatsappDeliveries.id, delivery.id));
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
      .where(eq(whatsappDeliveries.id, delivery.id));
  }
}

/**
 * Requeue `claimed` deliveries whose sender died mid-flight so a later sweep
 * can retry them instead of stranding them forever. Idempotent: only rows
 * claimed longer than `staleBeforeMs` are touched.
 */
export async function recoverStuckWhatsAppDeliveries(
  staleBeforeMs = 5 * 60_000,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(whatsappDeliveries)
    .set({
      state: "pending",
      claimedAt: null,
      claimedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappDeliveries.state, "claimed"),
        lt(whatsappDeliveries.claimedAt, new Date(Date.now() - staleBeforeMs)),
      ),
    )
    .returning({ id: whatsappDeliveries.id });
  return rows.length;
}
