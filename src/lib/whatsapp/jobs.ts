import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { whatsappJobs } from "@/db/schema";
import type { InboundWhatsAppMessage } from "./parse";

function nextBackoff(attempts: number): Date {
  const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + minutes * 60_000);
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
      })
      .onConflictDoNothing({ target: whatsappJobs.dedupeKey })
      .returning({ id: whatsappJobs.id });
    if (row) enqueued += 1;
  }
  return enqueued;
}

export async function claimDueWhatsAppJobs(
  runId: string,
  opts?: { limit?: number },
) {
  const db = getDb();
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
          lte(whatsappJobs.nextAttemptAt, sql`now()`),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(limit);

    if (due.length === 0) return [];

    const ids = due.map((row) => row.id);
    await tx
      .update(whatsappJobs)
      .set({
        state: "claimed",
        claimedAt: new Date(),
        claimedBy: runId,
        updatedAt: new Date(),
      })
      .where(inArray(whatsappJobs.id, ids));

    return due;
  });
}

export async function markJobDone(
  jobId: string,
  schoolId?: string | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(whatsappJobs)
    .set({
      state: "done",
      schoolId: schoolId ?? undefined,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(whatsappJobs.id, jobId));
}

export async function failJob(
  jobId: string,
  attempts: number,
  message: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(whatsappJobs)
    .set({
      state: "failed",
      attempts: attempts + 1,
      nextAttemptAt: nextBackoff(attempts + 1),
      lastError: message.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(whatsappJobs.id, jobId));
}

export async function rescheduleJob(
  jobId: string,
  delayMs = 1000,
): Promise<void> {
  const db = getDb();
  await db
    .update(whatsappJobs)
    .set({
      state: "pending",
      nextAttemptAt: new Date(Date.now() + delayMs),
      claimedAt: null,
      claimedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(whatsappJobs.id, jobId));
}

/**
 * Requeue `claimed` jobs whose worker died mid-flight (e.g. an `after()`
 * invocation that crashed) so a later sweep can retry them instead of
 * stranding them forever.
 */
export async function recoverStuckWhatsAppJobs(
  staleBeforeMs = 5 * 60_000,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(whatsappJobs)
    .set({
      state: "pending",
      claimedAt: null,
      claimedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappJobs.state, "claimed"),
        lt(whatsappJobs.claimedAt, new Date(Date.now() - staleBeforeMs)),
      ),
    )
    .returning({ id: whatsappJobs.id });
  return rows.length;
}
