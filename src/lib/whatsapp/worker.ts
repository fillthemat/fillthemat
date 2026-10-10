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
import { attemptPendingForLead } from "@/lib/email/deliveries";
import { createLead } from "@/lib/leads/create-lead";
import { loadSchoolCatalog } from "@/lib/schools/public";
import {
  MAX_CHAT_MESSAGES_PER_CONVERSATION,
  whatsappOutboundQuotaExceeded,
} from "@/lib/security/limits";
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
  recoverStuckWhatsAppDeliveries,
} from "./deliveries";
import {
  claimGenerating,
  messageExists,
  persistAssistantMessage,
  persistUserMessage,
  releaseGenerating,
  resolveInboundConversation,
} from "./inbound";
import {
  getPendingBookingIntent,
  getPendingBookingIntentById,
  upsertPendingBookingIntent,
} from "./intents";
import {
  claimDueWhatsAppJobs,
  failJob,
  markJobDone,
  recoverStuckWhatsAppJobs,
  rescheduleJob,
} from "./jobs";
import { loadValidatedConversationMessages } from "./messages";
import type { InboundWhatsAppMessage } from "./parse";
import { splitWhatsAppText } from "./text";

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ProcessJobResult = "done" | "failed";

type JobContext = {
  schoolId: string;
  conversationId: string;
  purgeAt: Date;
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
};

async function saveInboundMessage(ctx: InboundContext): Promise<void> {
  await persistUserMessage({
    id: ctx.inboundMessageId,
    conversationId: ctx.conversationId,
    wamid: ctx.message.wamid,
    text: ctx.inboundText,
    purgeAt: ctx.purgeAt,
  });
}

// Notices are sent but not saved as messages, so their reply has no id.
async function sendNotice(
  ctx: InboundContext,
  text: string,
): Promise<TurnReply> {
  const deliveryId = await enqueueWhatsAppDelivery({
    schoolId: ctx.schoolId,
    recipientWaId: ctx.message.waId,
    phoneNumberId: ctx.message.phoneNumberId,
    providerIdempotencyKey: `wa-notice/${ctx.message.waId}/${ctx.message.wamid}`,
    body: text,
    windowExpiresAt: addHours(new Date(), 24),
  });
  if (deliveryId) await attemptWhatsAppDeliveriesNow([deliveryId], ctx.runId);
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

  const { reply } = await confirmWhatsAppBooking({
    schoolId: ctx.schoolId,
    conversationId: ctx.conversationId,
    intent,
    waId: ctx.message.waId,
    phoneNumberId: ctx.message.phoneNumberId,
    wamid: ctx.message.wamid,
    profileName: ctx.message.profileName,
    purgeAt: ctx.purgeAt,
    runId: ctx.runId,
  });

  await saveInboundMessage(ctx);
  return reply;
}

async function enqueueAndSendTextReplies(
  ctx: InboundContext,
  text: string,
  idempotencyPrefix: string,
): Promise<void> {
  const chunks = splitWhatsAppText(text);
  const windowExpiresAt = addHours(new Date(), 24);
  const deliveryIds: string[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const deliveryId = await enqueueWhatsAppDelivery({
      schoolId: ctx.schoolId,
      recipientWaId: ctx.message.waId,
      phoneNumberId: ctx.message.phoneNumberId,
      providerIdempotencyKey: `${idempotencyPrefix}/${index}`,
      body: chunks[index],
      windowExpiresAt,
    });
    if (deliveryId) deliveryIds.push(deliveryId);
  }
  if (deliveryIds.length > 0) {
    await attemptWhatsAppDeliveriesNow(deliveryIds, ctx.runId);
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
  // 429-equivalent: per-wa_id daily outbound cap (Phase 5 abuse controls).
  if (
    await whatsappOutboundQuotaExceeded(ctx.schoolId, ctx.message.waId, now)
  ) {
    await saveInboundMessage(ctx);
    return sendNotice(
      ctx,
      "You've reached today's message limit. Please try again tomorrow.",
    );
  }

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
  if (!school) throw new Error("school_missing");

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
    const replyMessageId = await persistAssistantMessage({
      conversationId: ctx.conversationId,
      messageId: generateId(),
      parts: body ? [{ type: "text", text: body }] : [],
      purgeAt: ctx.purgeAt,
    });

    const deliveryId = await enqueueWhatsAppDelivery({
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
    });
    if (deliveryId) {
      await attemptWhatsAppDeliveriesNow([deliveryId], ctx.runId);
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
    const replyMessageId = await persistAssistantMessage({
      conversationId: ctx.conversationId,
      messageId: generateId(),
      parts: [{ type: "text", text: replyText }],
      purgeAt: ctx.purgeAt,
    });
    await enqueueAndSendTextReplies(ctx, replyText, `wa-reply/${lead.id}`);
    return { text: replyText, messageId: replyMessageId, provenance };
  }

  // Plain text reply.
  const replyText = reply.text;
  const replyMessageId = await persistAssistantMessage({
    conversationId: ctx.conversationId,
    messageId: generateId(),
    parts: replyText ? [{ type: "text", text: replyText }] : [],
    purgeAt: ctx.purgeAt,
  });
  await enqueueAndSendTextReplies(ctx, replyText, `wa-reply/${generateId()}`);
  return { text: replyText, messageId: replyMessageId, provenance };
}

/**
 * Decides how to answer the inbound message before answering it, and returns
 * the turn that sends the reply. Returns null when the message gets no reply:
 * the conversation has reached its message limit and it isn't a confirmation.
 *
 * Deterministic confirmation path (addendum "Deterministic confirmation"): a
 * `confirm_booking:<id>` reply button, or an exact affirmative while a pending
 * intent exists, goes straight to `bookSlot` instead of the assistant.
 */
async function planReply(
  ctx: InboundContext,
  now: Date,
): Promise<(() => Promise<TurnReply>) | null> {
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

  const history = await loadValidatedConversationMessages(ctx.conversationId);
  if (history.length >= MAX_CHAT_MESSAGES_PER_CONVERSATION) return null;
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
): Promise<ProcessJobResult> {
  const message = job.payload as InboundWhatsAppMessage;
  let conversationId: string | null = null;
  try {
    const resolved = await resolveInboundConversation(message, new Date());
    if (!resolved.resolved) {
      if (resolved.reason === "unknown_phone_number") {
        await failJob(job.id, job.attempts, "unknown_phone_number");
        return "failed";
      }
      // Empty/non-text payload: nothing to persist or reply to.
      await markJobDone(job.id);
      return "done";
    }
    conversationId = resolved.conversationId;
    const now = new Date();

    // Retry idempotency: if a previous attempt already persisted this inbound
    // message, do not reply or book a second time.
    if (await messageExists(conversationId, message.wamid)) {
      await markJobDone(job.id, resolved.schoolId);
      return "done";
    }

    if (!(await claimGenerating(conversationId, now))) {
      // Another job is mid-flight on this conversation; try again shortly.
      await rescheduleJob(job.id, 2000);
      return "done";
    }

    try {
      const ctx: InboundContext = {
        schoolId: resolved.schoolId,
        conversationId,
        purgeAt: resolved.purgeAt,
        message,
        inboundText: message.text ?? "",
        inboundMessageId: randomUUID(),
        runId,
      };

      const sendReply = await planReply(ctx, now);
      if (sendReply) {
        // A message that gets a reply is a turn. Its trace starts only once
        // that's known, because a started trace can't be dropped. It's
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

      await markJobDone(job.id, resolved.schoolId);
      return "done";
    } finally {
      await releaseGenerating(conversationId);
    }
  } catch (error) {
    // `releaseGenerating` is handled by the inner `finally`: the lock is only
    // ever held between `claimGenerating` and that finally, so there is no
    // second release here (fail the job + backoff, never leak the lock).
    const message =
      error instanceof Error ? error.message : "whatsapp_job_failed";
    await failJob(job.id, job.attempts, message);
    console.error("whatsapp: job failed", job.id, message);
    return "failed";
  }
}

export async function drainWhatsAppJobs(
  runId: string,
  limit = 10,
): Promise<{ claimed: number; done: number; failed: number }> {
  const claimed = await claimDueWhatsAppJobs(runId, { limit });
  let done = 0;
  let failed = 0;
  for (const job of claimed) {
    const result = await processWhatsAppJob(job, runId);
    if (result === "done") done += 1;
    else failed += 1;
  }
  return { claimed: claimed.length, done, failed };
}

/**
 * One full worker tick: process due inbound jobs, then due outbound deliveries
 * (retries/backoff) — no infinite tail-chasing of freshly-claimed rows.
 *
 * The drain below only re-claims `pending`/`failed` rows whose `nextAttemptAt`
 * is due. Delivery rows sent inline above (in `processWhatsAppJob`) are already
 * `sent`, and failed inline rows have a future `nextAttemptAt`, so neither needs
 * re-picking-up here.
 */
export async function runWhatsAppWorkerOnce(runId: string) {
  try {
    await recoverStuckWhatsAppJobs();
    await recoverStuckWhatsAppDeliveries();
    const jobs = await drainWhatsAppJobs(runId);
    const deliveries = await drainDueWhatsAppDeliveries(runId);
    return { jobs, deliveries };
  } finally {
    // Once, after every reply in the run, so a slow or unreachable Langfuse
    // never delays a reply and costs the run one export at most. Awaited, so
    // the traces aren't lost when the invocation ends.
    await exportEndedTurns();
  }
}
