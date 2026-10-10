import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  schools,
  type WhatsAppJob,
  whatsappDeliveries,
  whatsappJobs,
} from "@/db/schema";
import { jobRecipientWaId } from "./parse";

/** Enqueue in the job-death transaction: a crash cannot strand a dead job without its apology. */
export async function enqueueJobFallback(
  db: Pick<Database, "select" | "insert">,
  job: WhatsAppJob,
  now: Date,
): Promise<void> {
  if (
    job.state !== "dead" ||
    job.terminalCause !== "attempts_exhausted" ||
    job.kind !== "inbound_message"
  )
    return;
  const waId = jobRecipientWaId(job.payload);
  if (!waId) return;

  // No persisted service-window deadline exists yet. Use the latest inbound
  // receipt for this school number/prospect, never a retry's processing time or
  // the 30-day conversation expiry. A newer inbound can reopen the window.
  // Verified Meta message timestamps remain the separate pre-pilot fix (#78).
  const [inbound] = await db
    .select({ receivedAt: whatsappJobs.createdAt })
    .from(whatsappJobs)
    .where(
      and(
        eq(whatsappJobs.kind, "inbound_message"),
        eq(whatsappJobs.phoneNumberId, job.phoneNumberId),
        eq(sql<string>`${whatsappJobs.payload}->>'waId'`, waId),
        lte(whatsappJobs.createdAt, now),
      ),
    )
    .orderBy(desc(whatsappJobs.createdAt))
    .limit(1);
  if (!inbound) return;
  const windowExpiresAt = new Date(
    inbound.receivedAt.getTime() + 24 * 60 * 60_000,
  );
  if (windowExpiresAt <= now) return;
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(
      and(
        eq(schools.whatsappPhoneNumberId, job.phoneNumberId),
        job.schoolId ? eq(schools.id, job.schoolId) : undefined,
      ),
    )
    .limit(1);
  if (!school) return;
  await db
    .insert(whatsappDeliveries)
    .values({
      schoolId: school.id,
      phoneNumberId: job.phoneNumberId,
      recipientWaId: waId,
      providerIdempotencyKey: `job-fallback/${job.id}`,
      body: "Sorry, we're having trouble replying right now. Please message us again in a bit.",
      windowExpiresAt,
      state: "pending",
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: whatsappDeliveries.providerIdempotencyKey });
}
