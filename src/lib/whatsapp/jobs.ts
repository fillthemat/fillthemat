import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { type WhatsAppJob, whatsappJobs } from "@/db/schema";
import { logDeadTransition } from "@/lib/retry-log";
import {
  MAX_EXECUTIONS,
  type RetryFailure,
  retryDecision,
} from "@/lib/retry-policy";
import { enqueueJobFallback } from "./job-fallback";
import type { InboundWhatsAppMessage } from "./parse";

/** A claim is fenced by owner, timestamp and execution count, not just row ID. */
function ownedClaim(job: WhatsAppJob) {
  return and(
    eq(whatsappJobs.id, job.id),
    eq(whatsappJobs.state, "claimed"),
    eq(whatsappJobs.claimedBy, job.claimedBy ?? ""),
    job.claimedAt ? eq(whatsappJobs.claimedAt, job.claimedAt) : sql`false`,
    eq(whatsappJobs.attempts, job.attempts),
  );
}

/**
 * Enqueue one `whatsapp_jobs` row per inbound message. `dedupe_key` is the
 * inbound wamid, so a Meta retry of the same webhook creates at most one job.
 */
export async function enqueueInboundJobs(
  messages: InboundWhatsAppMessage[],
): Promise<number> {
  const db = getDb();
  let enqueued = 0;
  for (const message of messages) {
    const [row] = await db
      .insert(whatsappJobs)
      .values({
        dedupeKey: message.wamid,
        phoneNumberId: message.phoneNumberId,
        kind: "inbound_message",
        payload: message,
        state: "pending",
        // Immediate work uses the same clock as the worker's due-time cutoff.
        nextAttemptAt: new Date(),
      })
      .onConflictDoNothing({ target: whatsappJobs.dedupeKey })
      .returning({ id: whatsappJobs.id });
    if (row) enqueued += 1;
  }
  return enqueued;
}

export async function claimDueWhatsAppJobs(
  runId: string,
  opts?: { limit?: number; now?: Date },
) {
  const db = getDb();
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? 10;
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(whatsappJobs)
      .where(
        and(
          or(
            eq(whatsappJobs.state, "pending"),
            eq(whatsappJobs.state, "failed"),
          ),
          lte(whatsappJobs.nextAttemptAt, now),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(limit);

    if (due.length === 0) return [];

    const ids = due.map((row) => row.id);
    return tx
      .update(whatsappJobs)
      .set({
        state: "claimed",
        claimedAt: now,
        claimedBy: runId,
        updatedAt: now,
      })
      .where(inArray(whatsappJobs.id, ids))
      .returning();
  });
}

export async function markJobDone(
  job: WhatsAppJob,
  schoolId?: string | null,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(whatsappJobs)
    .set({
      state: "done",
      schoolId: schoolId ?? undefined,
      lastError: null,
      failureReason: null,
      terminalCause: null,
      claimedAt: null,
      claimedBy: null,
      updatedAt: now,
    })
    .where(ownedClaim(job))
    .returning({ id: whatsappJobs.id });
  return rows.length > 0;
}

/** Persist the execution before doing reply work; a lock deferral never calls this. */
export async function startJobExecution(
  job: WhatsAppJob,
  schoolId?: string | null,
  now = new Date(),
): Promise<WhatsAppJob | null> {
  const [row] = await getDb()
    .update(whatsappJobs)
    .set({
      attempts: sql`${whatsappJobs.attempts} + 1`,
      schoolId: schoolId ?? undefined,
      updatedAt: now,
    })
    .where(and(ownedClaim(job), lt(whatsappJobs.attempts, MAX_EXECUTIONS)))
    .returning();
  return row ?? null;
}

export async function failJob(
  job: WhatsAppJob,
  failure: Extract<RetryFailure, { kind: "internal" }>,
  message: string,
  now = new Date(),
): Promise<"retrying" | "dead" | "deferred"> {
  const db = getDb();
  const decision = retryDecision(failure, job.attempts, now);
  const rows = await db.transaction(async (tx) => {
    const rows = await tx
      .update(whatsappJobs)
      .set({
        state: decision.action === "stop" ? "dead" : "failed",
        nextAttemptAt: decision.action === "retry" ? decision.at : undefined,
        lastError: message.slice(0, 500),
        failureReason: failure.reason,
        terminalCause: decision.action === "stop" ? decision.cause : null,
        claimedAt: null,
        claimedBy: null,
        updatedAt: now,
      })
      .where(ownedClaim(job))
      .returning();
    if (rows[0]) await enqueueJobFallback(tx, rows[0], now);
    return rows;
  });
  if (rows.length === 0) return "deferred";
  if (decision.action === "stop") {
    logDeadTransition({
      queue: "whatsapp_job",
      id: job.id,
      schoolId: rows[0].schoolId,
      reason: failure.reason,
      terminalCause: decision.cause,
      executions: job.attempts,
      runId: job.claimedBy ?? "unknown",
    });
  }
  return decision.action === "stop" ? "dead" : "retrying";
}

export async function rescheduleJob(
  job: WhatsAppJob,
  delayMs = 1000,
  now = new Date(),
): Promise<void> {
  const db = getDb();
  await db
    .update(whatsappJobs)
    .set({
      state: "pending",
      nextAttemptAt: new Date(now.getTime() + delayMs),
      claimedAt: null,
      claimedBy: null,
      updatedAt: now,
    })
    .where(ownedClaim(job));
}

/**
 * Requeue `claimed` jobs whose worker died mid-flight (e.g. an `after()`
 * invocation that crashed) so a later sweep can retry them instead of
 * stranding them forever.
 */
export async function recoverStuckWhatsAppJobs(
  staleBeforeMs = 5 * 60_000,
  now = new Date(),
  runId = "recovery",
): Promise<{ recovered: number; dead: number }> {
  const db = getDb();
  const recovered = await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(whatsappJobs)
      .where(
        and(
          eq(whatsappJobs.state, "claimed"),
          lt(whatsappJobs.claimedAt, new Date(now.getTime() - staleBeforeMs)),
        ),
      )
      .for("update", { skipLocked: true });
    const dead: WhatsAppJob[] = [];
    for (const job of stale) {
      const reason = job.failureReason ?? "worker_crashed";
      const decision = retryDecision(
        { kind: "internal", reason },
        job.attempts,
        now,
      );
      const [row] = await tx
        .update(whatsappJobs)
        .set({
          state: decision.action === "stop" ? "dead" : "pending",
          claimedAt: null,
          claimedBy: null,
          updatedAt: now,
          // Keep the previous diagnostic; crash recovery must not erase it.
          failureReason:
            decision.action === "stop" ? reason : job.failureReason,
          lastError:
            decision.action === "stop"
              ? (job.lastError ?? "worker_crashed")
              : job.lastError,
          terminalCause: decision.action === "stop" ? decision.cause : null,
        })
        .where(ownedClaim(job))
        .returning();
      if (row?.state === "dead") {
        await enqueueJobFallback(tx, row, now);
        dead.push(row);
      }
    }
    return { recovered: stale.length, dead };
  });
  for (const job of recovered.dead) {
    logDeadTransition({
      queue: "whatsapp_job",
      id: job.id,
      schoolId: job.schoolId,
      reason: job.failureReason ?? "worker_crashed",
      terminalCause: job.terminalCause ?? "attempts_exhausted",
      executions: job.attempts,
      runId,
    });
  }
  return { recovered: recovered.recovered, dead: recovered.dead.length };
}
