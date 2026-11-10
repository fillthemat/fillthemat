import { deadEventFrom, logDeadTransition } from "@/lib/retry-log";
import { type RetryFailure, whatsappRetryDecision as retryDecision } from "@/lib/retry-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InboundWhatsAppMessage } from "./parse";
import { jobFromRow, updateJobClaim, type WhatsAppJob } from "./queue-store";
export type { WhatsAppJob } from "./queue-store";

export async function enqueueInboundJobs(messages: InboundWhatsAppMessage[]): Promise<number> {
  let enqueued = 0;
  for (const message of messages) {
    const { data } = await createAdminClient()
      .from("whatsapp_jobs")
      .upsert(
        {
          dedupe_key: message.wamid,
          phone_number_id: message.phoneNumberId,
          kind: "inbound_message",
          payload: { ...message },
          next_attempt_at: new Date().toISOString(),
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id")
      .throwOnError();
    enqueued += data?.length ?? 0;
  }
  return enqueued;
}

export async function claimDueWhatsAppJobs(
  runId: string,
  opts?: {
    limit?: number;
    now?: Date;
    retryOnly?: boolean;
    phoneNumberIds?: string[];
  },
): Promise<WhatsAppJob[]> {
  const { data } = await createAdminClient()
    .rpc("claim_whatsapp_jobs", {
      p_run_id: runId,
      p_limit: opts?.limit ?? 10,
      p_now: (opts?.now ?? new Date()).toISOString(),
      p_retry_only: opts?.retryOnly,
      p_phone_number_ids: opts?.phoneNumberIds,
    })
    .throwOnError();
  return (data ?? []).map(jobFromRow);
}

export async function nextWhatsAppJobRetryAt(now: Date, before: Date, phoneNumberIds?: string[]) {
  let query = createAdminClient()
    .from("whatsapp_jobs")
    .select("next_attempt_at")
    .in("state", ["pending", "failed"])
    .gt("attempts", 0)
    .gt("next_attempt_at", now.toISOString())
    .lt("next_attempt_at", before.toISOString());
  if (phoneNumberIds) query = query.in("phone_number_id", phoneNumberIds);
  const { data } = await query.order("next_attempt_at").limit(1).maybeSingle().throwOnError();
  return data ? new Date(data.next_attempt_at) : null;
}

export async function markJobDone(
  job: WhatsAppJob,
  schoolId?: string | null,
  now = new Date(),
): Promise<boolean> {
  return Boolean(
    await updateJobClaim(job, {
      state: "done",
      school_id: schoolId ?? undefined,
      last_error: null,
      failure_reason: null,
      terminal_cause: null,
      claimed_at: null,
      claimed_by: null,
      updated_at: now.toISOString(),
    }),
  );
}

export async function startJobExecution(
  job: WhatsAppJob,
  schoolId?: string | null,
  _now = new Date(),
): Promise<WhatsAppJob | null> {
  if (!job.claimedAt || !job.claimedBy) return null;
  const { data } = await createAdminClient()
    .rpc("start_whatsapp_job", {
      p_id: job.id,
      p_claimed_by: job.claimedBy,
      p_claimed_at: job.claimedAt,
      p_attempts: job.attempts,
      p_school_id: schoolId ?? undefined,
    })
    .throwOnError();
  return data?.[0] ? jobFromRow(data[0]) : null;
}

export async function failJob(
  job: WhatsAppJob,
  failure: Extract<RetryFailure, { kind: "internal" }>,
  message: string,
  now = new Date(),
): Promise<"retrying" | "dead" | "deferred"> {
  const decision = retryDecision(failure, job.attempts, now);
  // The SQL death hook enqueues the fallback in this same transaction.
  const row = await updateJobClaim(job, {
    state: decision.action === "stop" ? "dead" : "failed",
    next_attempt_at: decision.action === "retry" ? decision.at.toISOString() : undefined,
    last_error: message.slice(0, 500),
    failure_reason: failure.reason,
    terminal_cause: decision.action === "stop" ? decision.cause : null,
    claimed_at: null,
    claimed_by: null,
    updated_at: now.toISOString(),
  });
  if (!row) return "deferred";
  if (decision.action === "stop")
    logDeadTransition(deadEventFrom(row, "whatsapp_job", job.claimedBy ?? "unknown"));
  return decision.action === "stop" ? "dead" : "retrying";
}

export async function rescheduleJob(
  job: WhatsAppJob,
  delayMs = 1000,
  now = new Date(),
): Promise<void> {
  await updateJobClaim(job, {
    state: "pending",
    next_attempt_at: new Date(now.getTime() + delayMs).toISOString(),
    claimed_at: null,
    claimed_by: null,
    updated_at: now.toISOString(),
  });
}

export async function releaseWhatsAppJobClaim(job: WhatsAppJob, now: Date) {
  await updateJobClaim(job, {
    state: job.attempts > 0 ? "failed" : "pending",
    claimed_at: null,
    claimed_by: null,
    updated_at: now.toISOString(),
  });
}

export async function recoverStuckWhatsAppJobs(
  staleBeforeMs = 5 * 60_000,
  now = new Date(),
  runId = "recovery",
  phoneNumberIds?: string[],
): Promise<{ recovered: number; dead: number }> {
  const { data } = await createAdminClient()
    .rpc("recover_whatsapp_jobs", {
      p_stale_before: new Date(now.getTime() - staleBeforeMs).toISOString(),
      p_phone_number_ids: phoneNumberIds,
    })
    .throwOnError();
  const dead = (data ?? []).filter((row) => row.state === "dead");
  for (const row of dead) logDeadTransition(deadEventFrom(row, "whatsapp_job", runId));
  return { recovered: (data?.length ?? 0) - dead.length, dead: dead.length };
}
