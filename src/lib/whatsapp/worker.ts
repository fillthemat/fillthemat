import { type UIMessage, validateUIMessages } from "ai";
import { addHours } from "date-fns";
import { randomUUID } from "node:crypto";
import { completedReply } from "@/lib/ai/assistant";
import { CONVERSATION_LIMIT_NOTICE } from "@/lib/chat/protocol";
import {
  claimGeneration,
  endConversationAtMessageLimit,
  findConversation,
  findOrCreateConversation,
  hasWhatsAppMessage,
  loadTranscript,
} from "@/lib/conversations/conversation-store";
import { attemptPendingForBooking, attemptPendingForLead } from "@/lib/email/deliveries";
import { InternalFailure, internalFailureReasonFrom, MAX_EXECUTIONS } from "@/lib/retry-policy";
import { loadSchoolCatalog } from "@/lib/schools/public";
import { whatsappOutboundQuotaExceeded } from "@/lib/security/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { exportEndedTurns, startTurnTrace, type TurnReply } from "@/lib/tracing/turn-trace";
import type { InboundWhatsAppMessage } from "./parse";
import { confirmWhatsAppBooking } from "./booking";
import { isAffirmativeConfirmation, parseConfirmBookingButton } from "./confirmation";
import {
  attemptWhatsAppDeliveriesNow,
  drainDueWhatsAppDeliveries,
  enqueueWhatsAppDelivery,
  nextWhatsAppDeliveryRetryAt,
  recoverStuckWhatsAppDeliveries,
} from "./deliveries";
import { type WhatsAppWorkerDependencies, whatsappWorkerDependencies } from "./dependencies";
import { resolveInboundSchool } from "./inbound";
import { getPendingBookingIntent } from "./intents";
import {
  claimDueWhatsAppJobs,
  failJob,
  markJobDone,
  nextWhatsAppJobRetryAt,
  recoverStuckWhatsAppJobs,
  releaseWhatsAppJobClaim,
  rescheduleJob,
  startJobExecution,
  type WhatsAppJob,
} from "./jobs";
import { loadWhatsAppSchool } from "./school";
import { commitWhatsAppTurn, type PreparedEffect } from "./turn-store";

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ProcessJobResult = "done" | "retrying" | "dead" | "deferred";

type JobContext = {
  schoolId: string;
  conversationId: string;
};

type InboundContext = JobContext & {
  school: Awaited<ReturnType<typeof loadWhatsAppSchool>>;
  generation: string;
  message: InboundWhatsAppMessage;
  inboundText: string;
  /**
   * The row id the inbound message is saved under. Traces use it instead of
   * the wamid, which encodes the sender's phone number.
   */
  inboundMessageId: string;
  runId: string;
  dependencies: WhatsAppWorkerDependencies;
};

async function enqueueNotice(
  ctx: Pick<InboundContext, "schoolId" | "message" | "dependencies">,
  text: string,
): Promise<string | null> {
  return enqueueWhatsAppDelivery(
    {
      schoolId: ctx.schoolId,
      recipientWaId: ctx.message.waId,
      phoneNumberId: ctx.message.phoneNumberId,
      providerIdempotencyKey: `wa-notice/${ctx.message.waId}/${ctx.message.wamid}`,
      body: text,
      windowExpiresAt: addHours(ctx.dependencies.now(), 24),
    },
    { now: ctx.dependencies.now() },
  );
}

// Notices are sent but not saved as messages, so their reply has no id.
async function sendNotice(
  ctx: Pick<InboundContext, "schoolId" | "message" | "runId" | "dependencies">,
  text: string,
): Promise<TurnReply> {
  const deliveryId = await enqueueNotice(ctx, text);
  if (deliveryId) await attemptWhatsAppDeliveriesNow([deliveryId], ctx.runId, ctx.dependencies);
  return { text };
}

/**
 * Confirmation turn: books the confirmed Booking Intent, or says the option
 * expired or was replaced when there is none.
 */
async function handleConfirmation(
  ctx: InboundContext,
  intentId: string | null,
  now: Date,
): Promise<TurnReply> {
  const committed = await confirmWhatsAppBooking({
    ...ctx,
    intentId,
    waId: ctx.message.waId,
    phoneNumberId: ctx.message.phoneNumberId,
    wamid: ctx.message.wamid,
    profileName: ctx.message.profileName,
    now,
  });
  if (committed.already_committed) return replayedTurn(ctx);
  if (committed.booking_id) {
    try {
      await attemptPendingForBooking(committed.booking_id);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "whatsapp_booking_email_attempt_failed",
          bookingId: committed.booking_id,
          runId: ctx.runId,
          error: error instanceof Error ? error.message : error,
        }),
      );
    }
  }
  await attemptWhatsAppDeliveriesNow(committed.delivery_ids, ctx.runId, ctx.dependencies);
  return { text: committed.reply_text, messageId: committed.reply_message_id ?? undefined };
}

function replayedTurn(ctx: InboundContext): TurnReply {
  console.info(
    JSON.stringify({
      event: "whatsapp_turn_replayed",
      schoolId: ctx.schoolId,
      conversationId: ctx.conversationId,
      runId: ctx.runId,
    }),
  );
  return { text: "" };
}

/** Prepare outside the transaction; commit all durable effects in one RPC. */
async function handleAssistantTurn(
  ctx: InboundContext,
  history: UIMessage[],
  now: Date,
): Promise<TurnReply> {
  const inboundUIMessage: UIMessage = {
    id: ctx.message.wamid,
    role: "user",
    parts: [{ type: "text", text: ctx.inboundText }],
  };
  const uiMessages = await validateUIMessages({
    messages: [...history, inboundUIMessage],
  });

  const catalog = await loadSchoolCatalog(ctx.schoolId, { anonymous: true });

  const reply = await completedReply({
    school: ctx.school,
    catalog,
    messages: uiMessages,
    now,
  });
  const { provenance, bookingIntent, leadRequest } = reply;
  const turn = bookingIntent
    ? {
        kind: "booking_intent" as const,
        input: bookingIntent,
        fallback: "I found a time that works. Use the buttons below to confirm.",
      }
    : leadRequest
      ? {
          kind: "lead_request" as const,
          input: leadRequest,
          fallback:
            "Thanks — I've passed your details along and the school will contact you to find a time.",
        }
      : { kind: "plain_reply" as const, fallback: "" };
  const replyText = reply.text || turn.fallback;

  const effect: PreparedEffect =
    turn.kind === "booking_intent"
      ? { kind: turn.kind, ...turn.input }
      : turn.kind === "lead_request"
        ? {
            kind: turn.kind,
            ...turn.input,
            contactName: turn.input.participantName ?? ctx.message.profileName ?? "Guest",
          }
        : { kind: "reply" };
  const committed = await commitWhatsAppTurn({
    ...ctx,
    waId: ctx.message.waId,
    phoneNumberId: ctx.message.phoneNumberId,
    wamid: ctx.message.wamid,
    replyText,
    effect,
    now,
  });
  if (committed.already_committed) return replayedTurn(ctx);
  const leadId = committed.lead_id;
  if (leadId) {
    try {
      await attemptPendingForLead(leadId);
    } catch (error) {
      // The durable email outbox has its own retry lifecycle. An immediate
      // email-attempt failure must not fail this Turn or suppress its reply.
      console.error(
        JSON.stringify({
          event: "whatsapp_lead_email_attempt_failed",
          leadId,
          runId: ctx.runId,
          error: error instanceof Error ? error.message : error,
        }),
      );
    }
  }
  await attemptWhatsAppDeliveriesNow(committed.delivery_ids, ctx.runId, ctx.dependencies);
  return { text: replyText, messageId: committed.reply_message_id ?? undefined, provenance };
}

/**
 * Decides how to answer the inbound message before answering it, and returns
 * the turn that sends the reply. Returns null for a refusal, which saves no
 * messages and is not traced as a Turn, even when a notice is sent.
 *
 * Deterministic confirmation path (addendum "Deterministic confirmation"): a
 * `confirm_booking:<id>` reply button, or an exact affirmative while a pending
 * intent exists, goes straight to the atomic confirmation RPC, not the assistant.
 */
async function planReply(
  ctx: InboundContext,
  now: Date,
): Promise<(() => Promise<TurnReply>) | null> {
  // Booking confirmations bypass the assistant's message limit.
  const buttonIntentId = parseConfirmBookingButton(ctx.inboundText);
  if (buttonIntentId) return () => handleConfirmation(ctx, buttonIntentId, now);
  const pending = await getPendingBookingIntent(ctx.conversationId, now);
  if (pending && isAffirmativeConfirmation(ctx.inboundText)) {
    return () => handleConfirmation(ctx, pending.id, now);
  }

  const history = await loadTranscript(ctx.schoolId, ctx.conversationId);
  if (await endConversationAtMessageLimit(ctx.schoolId, ctx.conversationId, ctx.generation, now)) {
    await sendNotice(ctx, CONVERSATION_LIMIT_NOTICE);
    return null;
  }

  // Daily-cap refusals leave the conversation open and its transcript intact.
  if (await whatsappOutboundQuotaExceeded(ctx.schoolId, ctx.message.waId, now)) {
    await sendNotice(ctx, "You've reached today's message limit. Please try again tomorrow.");
    return null;
  }
  return () => handleAssistantTurn(ctx, history, now);
}

/**
 * Claim-then-process one inbound job. The webhook never runs this — it only
 * enqueues — so the reply and outbound send happen here on the worker
 * (decision D12 / H).
 */
export async function processWhatsAppJob(
  job: WhatsAppJob,
  runId: string,
  overrides: Partial<WhatsAppWorkerDependencies> = {},
): Promise<ProcessJobResult> {
  const dependencies = whatsappWorkerDependencies(overrides);
  const message = { ...(job.payload as InboundWhatsAppMessage), phoneNumberId: job.phoneNumberId };
  if (job.state !== "claimed" || job.claimedBy !== runId) return "deferred";
  let started = false;
  let schoolId: string | null = null;
  const start = async () => {
    const execution = await startJobExecution(job, schoolId, dependencies.now());
    if (!execution) return false;
    job = execution;
    started = true;
    return true;
  };
  const done = async () =>
    (await markJobDone(job, schoolId, dependencies.now()))
      ? ("done" as const)
      : ("deferred" as const);
  try {
    const resolved = await resolveInboundSchool(message);
    schoolId = resolved.resolved ? resolved.schoolId : null;
    if (job.attempts >= MAX_EXECUTIONS) {
      return await failJob(
        job,
        {
          kind: "internal",
          reason: internalFailureReasonFrom(job.failureReason, "attempts_exhausted"),
        },
        job.lastError ?? "attempts_exhausted",
        dependencies.now(),
      );
    }
    if (!resolved.resolved) {
      if (resolved.reason === "unknown_phone_number") {
        if (!(await start())) return "deferred";
        return await failJob(
          job,
          { kind: "internal", reason: "unknown_phone_number" },
          "unknown_phone_number",
          dependencies.now(),
        );
      }
      // Empty/non-text payload: nothing to persist or reply to.
      if (!(await start())) return "deferred";
      return await done();
    }
    if (!schoolId) throw new InternalFailure("unknown_phone_number");
    const now = dependencies.now();
    // Reject draft/missing schools permanently before creating any conversation.
    const school = await loadWhatsAppSchool(schoolId);

    // Turn replay identity survives ending/replacing its conversation.
    const inboundIdentity = { schoolId, waId: message.waId, messageId: message.wamid };
    const alreadyAnswered = () => hasWhatsAppMessage(inboundIdentity);
    if (await alreadyAnswered()) {
      return await done();
    }
    const identity = { channel: "whatsapp", waId: message.waId } as const;
    // A daily-cap refusal is not a turn and must not create an empty record.
    // Explicit confirmation buttons retain their deterministic path at the cap.
    if (
      !parseConfirmBookingButton(message.text ?? "") &&
      !(await findConversation({
        schoolId,
        identity,
        now,
      })) &&
      schoolId &&
      (await whatsappOutboundQuotaExceeded(schoolId, message.waId, now))
    ) {
      if (!(await start())) return "deferred";
      await sendNotice(
        { schoolId, message, runId, dependencies },
        "You've reached today's message limit. Please try again tomorrow.",
      );
      return await done();
    }
    const result = await findOrCreateConversation({
      schoolId,
      identity,
      now,
    });
    const conversationId = result.id;

    const lock = await claimGeneration(schoolId, conversationId, {
      wait: true,
      now,
      sleep: dependencies.sleep,
    });
    if (!lock) {
      // Another job is mid-flight on this conversation; try again shortly.
      await rescheduleJob(job, 2000, dependencies.now());
      return "deferred";
    }

    try {
      // Recheck after waiting for a concurrent attempt to release its lock.
      if (await alreadyAnswered()) {
        return await done();
      }
      if (!(await start())) return "deferred";
      const ctx: InboundContext = {
        school,
        schoolId,
        generation: lock.generation,
        conversationId,
        message,
        inboundText: message.text ?? "",
        inboundMessageId: randomUUID(),
        runId,
        dependencies,
      };

      const sendReply = await planReply(ctx, now);
      if (sendReply) {
        // Only an accepted message and its reply are a Turn. Its trace starts
        // once that's known, because a started trace can't be dropped. It's
        // exported when the worker run ends.
        const turn = startTurnTrace({
          channel: "whatsapp",
          conversationId,
          schoolId,
          inboundMessageId: ctx.inboundMessageId,
          inboundText: ctx.inboundText,
        });
        turn.end(await turn.run(sendReply));
      }

      return await done();
    } finally {
      await lock.release();
    }
  } catch (error) {
    // The lock is released by the inner `finally`: it is only ever held
    // between `claimGeneration` and that finally, so there is no
    // second release here (fail the job + backoff, never leak the lock).
    const message = error instanceof Error ? error.message : "whatsapp_job_failed";
    if (!started && !(await start())) return "deferred";
    const failure =
      error instanceof InternalFailure
        ? error
        : { kind: "internal" as const, reason: "whatsapp_job_failed" as const };
    return failJob(job, failure, message, dependencies.now());
  }
}

export async function drainWhatsAppJobs(
  runId: string,
  limit = 10,
  overrides: Partial<WhatsAppWorkerDependencies> = {},
  opts: { retryOnly?: boolean; deadline?: Date } = {},
): Promise<{
  claimed: number;
  done: number;
  retrying: number;
  dead: number;
  deferred: number;
}> {
  const dependencies = whatsappWorkerDependencies(overrides);
  const claimed =
    opts.deadline && dependencies.now() >= opts.deadline
      ? []
      : await claimDueWhatsAppJobs(runId, {
          limit,
          now: dependencies.now(),
          retryOnly: opts.retryOnly,
          phoneNumberIds: dependencies.phoneNumberIds,
        });
  const counts = {
    claimed: claimed.length,
    done: 0,
    retrying: 0,
    dead: 0,
    deferred: 0,
  };
  for (const job of claimed) {
    let counted = false;
    try {
      if (opts.deadline && dependencies.now() >= opts.deadline) {
        await releaseWhatsAppJobClaim(job, dependencies.now());
        counts.deferred += 1;
        continue;
      }
      const result = await processWhatsAppJob(job, runId, dependencies);
      counts[result] += 1;
      counted = true;
      if (
        opts.retryOnly &&
        result === "dead" &&
        (!opts.deadline || dependencies.now() < opts.deadline)
      ) {
        // Exhaustion can enqueue an apology after the initial fresh sweep. Send
        // only this job's side effect inline, never reopen the global fresh lane.
        const { data: fallback } = await createAdminClient()
          .from("whatsapp_deliveries")
          .select("id")
          .eq("provider_idempotency_key", `job-fallback/${job.id}`)
          .throwOnError();
        if (fallback?.length && (!opts.deadline || dependencies.now() < opts.deadline)) {
          await attemptWhatsAppDeliveriesNow(
            fallback.map((row) => row.id),
            runId,
            dependencies,
          );
        }
      }
    } catch (error) {
      // Leave a failed persistence claim recoverable without aborting the batch.
      if (!counted) counts.deferred += 1;
      console.error(
        JSON.stringify({
          event: "whatsapp_job_processing_failed",
          id: job.id,
          runId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return counts;
}

/**
 * Drain the fresh-first batches, then retry existing executions within four
 * minutes of entry. Persisted policy due times also govern the daily sweeper;
 * the loop never resets execution counts or chases new fresh arrivals.
 */
export async function runWhatsAppWorkerOnce(
  runId: string,
  overrides: Partial<WhatsAppWorkerDependencies> = {},
) {
  const dependencies = whatsappWorkerDependencies(overrides);
  const deadline = new Date(dependencies.now().getTime() + 4 * 60_000);
  try {
    const recovered = await recoverStuckWhatsAppJobs(
      undefined,
      dependencies.now(),
      runId,
      dependencies.phoneNumberIds,
    );
    const recoveredDeliveries = await recoverStuckWhatsAppDeliveries(
      undefined,
      dependencies.now(),
      runId,
      dependencies.phoneNumberIds,
    );
    const jobs = await drainWhatsAppJobs(runId, 10, dependencies, { deadline });
    jobs.dead += recovered.dead;
    const deliveries = await drainDueWhatsAppDeliveries(runId, 25, dependencies, { deadline });
    deliveries.dead += recoveredDeliveries.dead;
    while (dependencies.now() < deadline) {
      // One claim per queue keeps a slow execution from reserving a whole
      // retry batch that cannot be started before the deadline.
      const retriedJobs = await drainWhatsAppJobs(runId, 1, dependencies, {
        retryOnly: true,
        deadline,
      });
      for (const key of Object.keys(jobs) as Array<keyof typeof jobs>) {
        jobs[key] += retriedJobs[key];
      }
      if (dependencies.now() >= deadline) break;
      const retriedDeliveries = await drainDueWhatsAppDeliveries(runId, 1, dependencies, {
        retryOnly: true,
        deadline,
      });
      for (const key of Object.keys(deliveries) as Array<keyof typeof deliveries>) {
        deliveries[key] += retriedDeliveries[key];
      }
      if (retriedJobs.claimed || retriedDeliveries.claimed) continue;

      const now = dependencies.now();
      if (now >= deadline) break;
      const due = await Promise.all([
        nextWhatsAppJobRetryAt(now, deadline, dependencies.phoneNumberIds),
        nextWhatsAppDeliveryRetryAt(now, deadline, dependencies.phoneNumberIds),
      ]);
      const next = due
        .filter((at): at is Date => at !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (!next) break;
      // Time spent querying also consumes budget. Recheck after waking before
      // claiming, since a real timer can fire late or another worker can win.
      const current = dependencies.now();
      if (current >= deadline) break;
      const delay = next.getTime() - current.getTime();
      if (delay > 0) await dependencies.sleep(delay);
    }
    return { jobs, deliveries };
  } finally {
    // Once, after every reply in the run, so a slow or unreachable Langfuse
    // never delays a reply and costs the run one export at most. Awaited, so
    // the traces aren't lost when the invocation ends.
    await exportEndedTurns();
  }
}
