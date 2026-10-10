import { randomUUID } from "node:crypto";
import { generateId, type UIMessage, validateUIMessages } from "ai";
import { addHours } from "date-fns";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  schools,
  type WhatsAppBookingIntent,
  type WhatsAppJob,
} from "@/db/schema";
import { completedReply } from "@/lib/ai/assistant";
import { CONVERSATION_LIMIT_NOTICE } from "@/lib/chat/protocol";
import {
  appendMessage,
  claimGeneration,
  endConversationAtMessageLimit,
  findConversation,
  findOrCreateConversation,
  hasWhatsAppMessage,
  loadTranscript,
} from "@/lib/conversations/conversation-store";
import { attemptPendingForLead } from "@/lib/email/deliveries";
import { createLead } from "@/lib/leads/create-lead";
import { InternalFailure, MAX_EXECUTIONS } from "@/lib/retry-policy";
import { loadSchoolCatalog } from "@/lib/schools/public";
import { whatsappOutboundQuotaExceeded } from "@/lib/security/limits";
import {
  exportEndedTurns,
  startTurnTrace,
  type TurnReply,
} from "@/lib/tracing/turn-trace";
import { confirmWhatsAppBooking } from "./booking";
import {
  CHOOSE_ANOTHER_TIME_BUTTON_ID,
  confirmBookingButtonId,
  isAffirmativeConfirmation,
  parseConfirmBookingButton,
} from "./confirmation";
import {
  attemptWhatsAppDeliveriesNow,
  drainDueWhatsAppDeliveries,
  enqueueWhatsAppDelivery,
  nextWhatsAppDeliveryRetryAt,
  recoverStuckWhatsAppDeliveries,
} from "./deliveries";
import {
  type WhatsAppWorkerDependencies,
  whatsappWorkerDependencies,
} from "./dependencies";
import { resolveInboundSchool } from "./inbound";
import {
  getPendingBookingIntent,
  getPendingBookingIntentById,
  upsertPendingBookingIntent,
} from "./intents";
import {
  claimDueWhatsAppJobs,
  failJob,
  markJobDone,
  nextWhatsAppJobRetryAt,
  recoverStuckWhatsAppJobs,
  releaseWhatsAppJobClaim,
  rescheduleJob,
  startJobExecution,
} from "./jobs";
import type { InboundWhatsAppMessage } from "./parse";
import { splitWhatsAppText } from "./text";

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ProcessJobResult = "done" | "retrying" | "dead" | "deferred";

type JobContext = {
  schoolId: string;
  conversationId: string;
};

type InboundContext = JobContext & {
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

async function saveInboundMessage(ctx: InboundContext): Promise<void> {
  await appendMessage({
    id: ctx.inboundMessageId,
    conversationId: ctx.conversationId,
    messageId: ctx.message.wamid,
    role: "user",
    parts: [{ type: "text", text: ctx.inboundText }],
  });
}

// Notices are sent but not saved as messages, so their reply has no id.
async function sendNotice(
  ctx: Pick<InboundContext, "schoolId" | "message" | "runId" | "dependencies">,
  text: string,
): Promise<TurnReply> {
  const deliveryId = await enqueueWhatsAppDelivery(
    {
      schoolId: ctx.schoolId,
      recipientWaId: ctx.message.waId,
      phoneNumberId: ctx.message.phoneNumberId,
      providerIdempotencyKey: `wa-notice/${ctx.message.waId}/${ctx.message.wamid}`,
      body: text,
      windowExpiresAt: addHours(ctx.dependencies.now(), 24),
    },
    ctx.dependencies.now(),
  );
  if (deliveryId)
    await attemptWhatsAppDeliveriesNow(
      [deliveryId],
      ctx.runId,
      ctx.dependencies,
    );
  return { text };
}

/**
 * Confirmation turn: books the confirmed Booking Intent, or says the option
 * expired or was replaced when there is none.
 */
async function handleConfirmation(
  ctx: InboundContext,
  intent: WhatsAppBookingIntent | null,
): Promise<TurnReply> {
  // Book BEFORE persisting the user message so a crash/retry replays into the
  // same deterministic idempotency key instead of silently dropping a confirm.
  if (!intent) {
    await saveInboundMessage(ctx);
    return sendNotice(
      ctx,
      "That booking option has expired or was replaced. Please ask for available times again.",
    );
  }

  const { reply } = await confirmWhatsAppBooking(
    {
      schoolId: ctx.schoolId,
      conversationId: ctx.conversationId,
      intent,
      waId: ctx.message.waId,
      phoneNumberId: ctx.message.phoneNumberId,
      wamid: ctx.message.wamid,
      profileName: ctx.message.profileName,
      runId: ctx.runId,
    },
    ctx.dependencies,
  );

  await saveInboundMessage(ctx);
  return reply;
}

async function enqueueAndSendTextReplies(
  ctx: InboundContext,
  text: string,
  idempotencyPrefix: string,
): Promise<void> {
  const chunks = splitWhatsAppText(text);
  const windowExpiresAt = addHours(ctx.dependencies.now(), 24);
  const deliveryIds: string[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const deliveryId = await enqueueWhatsAppDelivery(
      {
        schoolId: ctx.schoolId,
        recipientWaId: ctx.message.waId,
        phoneNumberId: ctx.message.phoneNumberId,
        providerIdempotencyKey: `${idempotencyPrefix}/${index}`,
        body: chunks[index],
        windowExpiresAt,
      },
      ctx.dependencies.now(),
    );
    if (deliveryId) deliveryIds.push(deliveryId);
  }
  if (deliveryIds.length > 0) {
    await attemptWhatsAppDeliveriesNow(
      deliveryIds,
      ctx.runId,
      ctx.dependencies,
    );
  }
}

/**
 * Assistant turn: get the assistant's completed reply, then persist messages
 * and either (a) refresh the pending booking intent + send the interactive
 * confirmation, (b) write a lead (platform), or (c) send the plain text reply.
 */
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

  const catalog = await loadSchoolCatalog(ctx.schoolId);
  const db = getDb();
  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, ctx.schoolId))
    .limit(1);
  if (!school) throw new InternalFailure("school_missing");

  const reply = await completedReply({
    school,
    catalog,
    messages: uiMessages,
    now,
  });
  const { provenance } = reply;

  await saveInboundMessage(ctx);

  const windowExpiresAt = addHours(now, 24);

  // Booking intent: platform persists/refreshes the pending intent and asks for
  // confirmation via reply buttons. The assistant never writes the booking.
  if (reply.bookingIntent) {
    const intent = await upsertPendingBookingIntent({
      schoolId: ctx.schoolId,
      conversationId: ctx.conversationId,
      offeringId: reply.bookingIntent.trialOfferingId,
      slotId: reply.bookingIntent.slotId,
      participantName: reply.bookingIntent.participantName,
      participantAge: reply.bookingIntent.participantAge,
      now,
    });

    const body =
      reply.text ||
      "I found a time that works. Use the buttons below to confirm.";
    const replyMessageId = await appendMessage({
      role: "assistant",
      conversationId: ctx.conversationId,
      messageId: generateId(),
      parts: body ? [{ type: "text", text: body }] : [],
    });

    const deliveryId = await enqueueWhatsAppDelivery(
      {
        schoolId: ctx.schoolId,
        recipientWaId: ctx.message.waId,
        phoneNumberId: ctx.message.phoneNumberId,
        providerIdempotencyKey: `wa-confirm/${intent.id}`,
        body,
        interactiveButtons: [
          { id: confirmBookingButtonId(intent.id), title: "Confirm booking" },
          { id: CHOOSE_ANOTHER_TIME_BUTTON_ID, title: "Choose another time" },
        ],
        windowExpiresAt,
      },
      ctx.dependencies.now(),
    );
    if (deliveryId) {
      await attemptWhatsAppDeliveriesNow(
        [deliveryId],
        ctx.runId,
        ctx.dependencies,
      );
    }
    return { text: body, messageId: replyMessageId, provenance };
  }

  // Lead: platform writes it (shared create-lead). Owner delivery stays email.
  if (reply.leadRequest) {
    const lead = await createLead({
      school,
      contact: {
        name:
          reply.leadRequest.participantName ??
          ctx.message.profileName ??
          "Guest",
        email: null,
        phone: ctx.message.waId,
      },
      source: { channel: "whatsapp", waId: ctx.message.waId },
      participantName: reply.leadRequest.participantName,
      participantAge: reply.leadRequest.participantAge,
      offeringId: reply.leadRequest.trialOfferingId,
      statedNeed: reply.leadRequest.statedNeed,
    });
    await attemptPendingForLead(lead.id);

    const replyText =
      reply.text ||
      "Thanks — I've passed your details along and the school will contact you to find a time.";
    const replyMessageId = await appendMessage({
      role: "assistant",
      conversationId: ctx.conversationId,
      messageId: generateId(),
      parts: [{ type: "text", text: replyText }],
    });
    await enqueueAndSendTextReplies(ctx, replyText, `wa-reply/${lead.id}`);
    return { text: replyText, messageId: replyMessageId, provenance };
  }

  // Plain text reply.
  const replyText = reply.text;
  const replyMessageId = await appendMessage({
    role: "assistant",
    conversationId: ctx.conversationId,
    messageId: generateId(),
    parts: replyText ? [{ type: "text", text: replyText }] : [],
  });
  await enqueueAndSendTextReplies(ctx, replyText, `wa-reply/${generateId()}`);
  return { text: replyText, messageId: replyMessageId, provenance };
}

/**
 * Decides how to answer the inbound message before answering it, and returns
 * the turn that sends the reply. Returns null for a refusal, which saves no
 * messages and is not traced as a Turn, even when a notice is sent.
 *
 * Deterministic confirmation path (addendum "Deterministic confirmation"): a
 * `confirm_booking:<id>` reply button, or an exact affirmative while a pending
 * intent exists, goes straight to `bookSlot` instead of the assistant.
 */
async function planReply(
  ctx: InboundContext,
  now: Date,
): Promise<(() => Promise<TurnReply>) | null> {
  // Booking confirmations bypass the assistant's message limit.
  const buttonIntentId = parseConfirmBookingButton(ctx.inboundText);
  const pending = await getPendingBookingIntent(ctx.conversationId, now);
  if (
    buttonIntentId ||
    (pending && isAffirmativeConfirmation(ctx.inboundText))
  ) {
    const intent = buttonIntentId
      ? await getPendingBookingIntentById(buttonIntentId, ctx.schoolId, now)
      : pending;
    return () => handleConfirmation(ctx, intent);
  }

  const history = await loadTranscript(ctx.conversationId);
  if (
    await endConversationAtMessageLimit(ctx.conversationId, history.length, now)
  ) {
    await sendNotice(ctx, CONVERSATION_LIMIT_NOTICE);
    return null;
  }

  // Daily-cap refusals leave the conversation open and its transcript intact.
  if (
    await whatsappOutboundQuotaExceeded(ctx.schoolId, ctx.message.waId, now)
  ) {
    await sendNotice(
      ctx,
      "You've reached today's message limit. Please try again tomorrow.",
    );
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
  const message = job.payload as InboundWhatsAppMessage;
  if (job.state !== "claimed" || job.claimedBy !== runId) return "deferred";
  let started = false;
  let schoolId = job.schoolId;
  const start = async () => {
    const execution = await startJobExecution(
      job,
      schoolId,
      dependencies.now(),
    );
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
    if (job.attempts >= MAX_EXECUTIONS) {
      return await failJob(
        job,
        { kind: "internal", reason: job.failureReason ?? "execution_limit" },
        job.lastError ?? "execution_limit",
        dependencies.now(),
      );
    }
    const resolved = await resolveInboundSchool(message);
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
    schoolId = resolved.schoolId;
    const now = dependencies.now();

    // Retry idempotency: if a previous attempt already persisted this inbound
    // message, do not reply or book a second time.
    const alreadyAnswered = () =>
      hasWhatsAppMessage({
        schoolId: resolved.schoolId,
        waId: message.waId,
        messageId: message.wamid,
      });
    if (await alreadyAnswered()) {
      return await done();
    }
    const identity = { channel: "whatsapp", waId: message.waId } as const;
    // A daily-cap refusal is not a turn and must not create an empty record.
    // Explicit confirmation buttons retain their deterministic path at the cap.
    if (
      !parseConfirmBookingButton(message.text ?? "") &&
      !(await findConversation({
        schoolId: resolved.schoolId,
        identity,
        now,
      })) &&
      (await whatsappOutboundQuotaExceeded(
        resolved.schoolId,
        message.waId,
        now,
      ))
    ) {
      if (!(await start())) return "deferred";
      await sendNotice(
        { schoolId: resolved.schoolId, message, runId, dependencies },
        "You've reached today's message limit. Please try again tomorrow.",
      );
      return await done();
    }
    const result = await findOrCreateConversation({
      schoolId: resolved.schoolId,
      identity,
      now,
    });
    if (!result.ok) throw new InternalFailure(result.reason);
    const conversationId = result.conversation.id;

    const lock = await claimGeneration(conversationId, {
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
        schoolId: resolved.schoolId,
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
          schoolId: resolved.schoolId,
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
    const message =
      error instanceof Error ? error.message : "whatsapp_job_failed";
    if (!started && !(await start())) return "deferred";
    const failure =
      error instanceof InternalFailure
        ? error
        : { kind: "internal" as const, reason: "whatsapp_job_failed" };
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
        });
  const counts = {
    claimed: claimed.length,
    done: 0,
    retrying: 0,
    dead: 0,
    deferred: 0,
  };
  for (const job of claimed) {
    if (opts.deadline && dependencies.now() >= opts.deadline) {
      await releaseWhatsAppJobClaim(job, dependencies.now());
      counts.deferred += 1;
      continue;
    }
    const result = await processWhatsAppJob(job, runId, dependencies);
    counts[result] += 1;
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
    );
    const recoveredDeliveries = await recoverStuckWhatsAppDeliveries(
      undefined,
      dependencies.now(),
      runId,
    );
    const jobs = await drainWhatsAppJobs(runId, 10, dependencies, { deadline });
    jobs.dead += recovered.dead;
    const deliveries = await drainDueWhatsAppDeliveries(
      runId,
      25,
      dependencies,
      { deadline },
    );
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
      const retriedDeliveries = await drainDueWhatsAppDeliveries(
        runId,
        1,
        dependencies,
        { retryOnly: true, deadline },
      );
      for (const key of Object.keys(deliveries) as Array<
        keyof typeof deliveries
      >) {
        deliveries[key] += retriedDeliveries[key];
      }
      if (retriedJobs.claimed || retriedDeliveries.claimed) continue;

      const now = dependencies.now();
      if (now >= deadline) break;
      const due = await Promise.all([
        nextWhatsAppJobRetryAt(now, deadline),
        nextWhatsAppDeliveryRetryAt(now, deadline),
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
