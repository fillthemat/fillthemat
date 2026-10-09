import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { addDays } from "date-fns";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import { getDb } from "@/db";
import {
  conversations,
  messages,
  trialWindows,
  whatsappDeliveries,
  whatsappJobs,
} from "@/db/schema";
import { hashToken, hashWaId, randomToken } from "@/lib/crypto";
import { listOpenSlots } from "@/lib/schedule/occurrences";
import {
  MAX_CHAT_MESSAGES_PER_CONVERSATION,
  MAX_WHATSAPP_OUTBOUND_PER_WA_ID_PER_DAY,
} from "@/lib/security/limits";
import { confirmBookingButtonId } from "@/lib/whatsapp/confirmation";
import { upsertPendingBookingIntent } from "@/lib/whatsapp/intents";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";
import {
  authSql,
  loadLocalEnv,
  requireRow,
  whileSavingMessages,
} from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import {
  exportedSpans,
  exportedTraces,
  holdSpanExports,
  isAssistantRun,
  isRoot,
  leaks,
  spansExportedSoFar,
} from "@/test/tracing";
import {
  buttonReplyPayload,
  post,
  textInboundPayload,
} from "@/test/whatsapp-webhook";

loadLocalEnv();

const db = getDb();
const sql = authSql();
const suffix = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const phoneNumberId = `499${Date.now().toString().slice(-9)}`;
const unusedPhoneNumberId = `599${Date.now().toString().slice(-9)}`;
const scriptedReply =
  "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.";
let schoolId = "";
let kidsBjjId = "";

// Like Meta's message ids, this one encodes the sender's phone number.
function wamidFrom(waId: string) {
  const id = `\x1c\x18\x0b${waId}\x15\x02\x00\x12\x18\x14${randomUUID()}`;
  return `wamid.${Buffer.from(id).toString("base64")}`;
}

async function sendText(waId: string, text: string, wamid = wamidFrom(waId)) {
  await send(wamid, textInboundPayload({ phoneNumberId, waId, wamid, text }));
}

async function pressButton(waId: string, buttonId: string) {
  const wamid = wamidFrom(waId);
  await send(
    wamid,
    buttonReplyPayload({ phoneNumberId, waId, wamid, buttonId }),
  );
}

// The message `wamid` in `payload` through the webhook, then the worker the
// webhook would wake.
async function send(wamid: string, payload: unknown) {
  await receive(wamid, payload);
  await runWhatsAppWorkerOnce(randomUUID());
}

// The message `wamid` in `payload` through the webhook, once its job is due.
async function receive(wamid: string, payload: unknown) {
  await POST(post(payload));
  // The database stamps the job's due time with its own clock, which can run
  // a few ms ahead of this machine's, and the worker skips jobs not yet due.
  const [job] = await db
    .select({ dueAt: whatsappJobs.nextAttemptAt })
    .from(whatsappJobs)
    .where(eq(whatsappJobs.dedupeKey, wamid));
  await sleep(Math.max(0, (job?.dueAt.getTime() ?? 0) + 1 - Date.now()));
}

// Whether a reply has been sent to `waId`.
async function repliedTo(waId: string) {
  const sent = await db
    .select({ id: whatsappDeliveries.id })
    .from(whatsappDeliveries)
    .where(
      and(
        eq(whatsappDeliveries.recipientWaId, waId),
        eq(whatsappDeliveries.state, "sent"),
      ),
    );
  return sent.length > 0;
}

async function conversationWith(waId: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, schoolId),
        eq(conversations.waIdHash, hashWaId(waId)),
      ),
    )
    .limit(1);
  return requireRow(conversation, "conversation");
}

async function savedMessages({ id }: { id: string }) {
  return db
    .select({ id: messages.id, role: messages.role, parts: messages.parts })
    .from(messages)
    .where(eq(messages.conversationId, id));
}

// The text of a message saved as a single text part.
function textOf(message: { parts: unknown } | undefined) {
  const [part] = (message?.parts ?? []) as Array<{ text?: string }>;
  return part?.text;
}

// The conversation `waId`'s messages will be routed into.
async function startConversation(waId: string) {
  const [conversation] = await db
    .insert(conversations)
    .values({
      schoolId,
      resumeTokenHash: hashToken(randomToken()),
      waIdHash: hashWaId(waId),
      expiresAt: addDays(new Date(), 30),
    })
    .returning({ id: conversations.id });
  return requireRow(conversation, "conversation").id;
}

// A conversation with `waId` whose Booking Intent awaits confirmation.
async function proposeBookingIntent(
  waId: string,
  participant: { participantName: string; participantAge: number | null },
) {
  const conversationId = await startConversation(waId);
  const [slot] = listOpenSlots({
    offeringId: kidsBjjId,
    timezone: "America/New_York",
    windows: await db
      .select()
      .from(trialWindows)
      .where(eq(trialWindows.trialOfferingId, kidsBjjId)),
    occurrences: [],
    now: new Date(),
  });
  const intent = await upsertPendingBookingIntent({
    schoolId,
    conversationId,
    offeringId: kidsBjjId,
    slotId: requireRow(slot, "open slot").slotId,
    ...participant,
  });
  return { conversationId, intentId: intent.id };
}

beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "WhatsApp Trace School",
    slug: `wa-tr-${suffix}`,
    publishedAt: new Date(),
    whatsappPhoneNumberId: phoneNumberId,
    offerings: [{ name: "Kids BJJ", minimumAge: 5, maximumAge: 12 }],
  });
  schoolId = seeded.schoolId;
  kidsBjjId = requireRow(seeded.offeringIds[0], "Kids BJJ offering");
  // Mondays at 18:00.
  await db.insert(trialWindows).values({
    schoolId,
    trialOfferingId: kidsBjjId,
    dayOfWeek: 1,
    startMinute: 18 * 60,
    durationMinutes: 60,
    capacity: 8,
    active: true,
  });
});

afterAll(async () => {
  await db
    .delete(whatsappJobs)
    .where(
      inArray(whatsappJobs.phoneNumberId, [phoneNumberId, unusedPhoneNumberId]),
    );
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("a WhatsApp assistant turn's trace", () => {
  it("is one trace in the conversation's session, for the school, tagged whatsapp, with the message as input and the reply as output", async () => {
    const waId = "16505550101";

    await sendText(waId, "What can my son try?");

    const conversation = await conversationWith(waId);
    expect(await exportedTraces()).toEqual([
      expect.objectContaining({
        sessionId: conversation.id,
        userId: schoolId,
        tags: ["whatsapp"],
        input: "What can my son try?",
        output: scriptedReply,
      }),
    ]);
  });

  it("nests the assistant's model calls and tool calls under the turn", async () => {
    const waId = "16505550102";

    await sendText(waId, "What can my son try?");

    const conversation = await conversationWith(waId);
    expect((await exportedTraces()).map(({ sessionId }) => sessionId)).toEqual([
      conversation.id,
    ]);
    const spans = await exportedSpans();
    const root = spans.find(isRoot);
    const assistantRun = spans.find(isAssistantRun);
    expect(assistantRun?.parentSpanContext?.spanId).toBe(
      root?.spanContext().spanId,
    );
    expect(spans.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "chat scripted-local",
        "execute_tool list_trial_offerings",
      ]),
    );
  });

  it("records the saved message ids, the model, and a short hash of the platform instructions", async () => {
    const waId = "16505550103";

    await sendText(waId, "What can my son try?");

    const saved = await savedMessages(await conversationWith(waId));
    const [turnTrace] = await exportedTraces();
    expect(turnTrace?.metadata).toEqual({
      inboundMessageId: saved.find(({ role }) => role === "user")?.id,
      replyMessageId: saved.find(({ role }) => role === "assistant")?.id,
      modelId: "scripted-local",
      platformInstructionsHash: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
  });

  it("is exported by the time the worker finishes", async () => {
    const waId = "16505550104";

    await sendText(waId, "What can my son try?");

    const exportedByWorker = spansExportedSoFar();
    const conversation = await conversationWith(waId);
    expect(
      exportedByWorker
        .filter(isRoot)
        .map(({ attributes }) => attributes["session.id"]),
    ).toEqual([conversation.id]);
    // Nothing was left waiting to be exported.
    expect(await exportedSpans()).toHaveLength(exportedByWorker.length);
  });

  it("never exports the sender's phone number, its hash, or the message's wamid", async () => {
    const waId = "16505550105";
    const wamid = wamidFrom(waId);

    await sendText(waId, "What can my son try?", wamid);

    const spans = await exportedSpans();
    expect(spans.filter(isRoot)).toHaveLength(1);
    expect(leaks(spans, [waId, hashWaId(waId), wamid])).toEqual([]);
  });
});

describe("a WhatsApp worker run with several messages to answer", () => {
  it("answers them all without waiting for Langfuse, then exports every turn's trace before it finishes", async () => {
    const waIds = ["16505550141", "16505550142", "16505550143"];
    for (const waId of waIds) {
      const wamid = wamidFrom(waId);
      await receive(
        wamid,
        textInboundPayload({
          phoneNumberId,
          waId,
          wamid,
          text: "What can my son try?",
        }),
      );
    }
    const slowLangfuse = holdSpanExports();

    const run = runWhatsAppWorkerOnce(randomUUID());
    await slowLangfuse.started;
    const answeredWhileExporting = await Promise.all(waIds.map(repliedTo));
    slowLangfuse.release();
    await run;

    expect(answeredWhileExporting).toEqual([true, true, true]);
    const conversations = await Promise.all(waIds.map(conversationWith));
    expect(
      spansExportedSoFar()
        .filter(isRoot)
        .map(({ attributes }) => attributes["session.id"])
        .toSorted(),
    ).toEqual(conversations.map(({ id }) => id).toSorted());
  });
});

describe("a WhatsApp turn answered without the assistant", () => {
  it("is one trace for a booking confirmation, with the saved confirmation as output and no model spans", async () => {
    const waId = "16505550111";
    const { conversationId, intentId } = await proposeBookingIntent(waId, {
      participantName: "Alex",
      participantAge: 8,
    });

    await pressButton(waId, confirmBookingButtonId(intentId));

    const saved = await savedMessages({ id: conversationId });
    const confirmation = saved.find(({ role }) => role === "assistant");
    expect(textOf(confirmation)).toMatch(/^Booked! Alex's trial for Kids BJJ/);
    expect(await exportedTraces()).toEqual([
      expect.objectContaining({
        sessionId: conversationId,
        userId: schoolId,
        tags: ["whatsapp"],
        input: confirmBookingButtonId(intentId),
        output: textOf(confirmation),
        metadata: {
          inboundMessageId: saved.find(({ role }) => role === "user")?.id,
          replyMessageId: confirmation?.id,
        },
      }),
    ]);
    expect((await exportedSpans()).map(({ name }) => name)).toEqual(["turn"]);
  });

  it("is one trace for a daily message limit notice, with the notice as output, no reply message and no model spans", async () => {
    const waId = "16505550112";
    await db.insert(whatsappDeliveries).values(
      Array.from(
        { length: MAX_WHATSAPP_OUTBOUND_PER_WA_ID_PER_DAY },
        (_, index) => ({
          schoolId,
          recipientWaId: waId,
          phoneNumberId,
          providerIdempotencyKey: `earlier/${suffix}/${index}`,
          body: `Earlier reply ${index + 1}`,
          state: "sent" as const,
        }),
      ),
    );

    await sendText(waId, "Are you still there?");

    const conversation = await conversationWith(waId);
    const [question] = await savedMessages(conversation);
    expect(await exportedTraces()).toEqual([
      expect.objectContaining({
        sessionId: conversation.id,
        userId: schoolId,
        tags: ["whatsapp"],
        input: "Are you still there?",
        output:
          "You've reached today's message limit. Please try again tomorrow.",
        metadata: { inboundMessageId: question?.id },
      }),
    ]);
    expect((await exportedSpans()).map(({ name }) => name)).toEqual(["turn"]);
  });

  it("is one trace for a notice that the Booking Intent being confirmed needs the participant's age", async () => {
    const waId = "16505550113";
    const { conversationId, intentId } = await proposeBookingIntent(waId, {
      participantName: "Alex",
      participantAge: null,
    });

    await pressButton(waId, confirmBookingButtonId(intentId));

    const [question] = await savedMessages({ id: conversationId });
    expect(await exportedTraces()).toEqual([
      expect.objectContaining({
        sessionId: conversationId,
        input: confirmBookingButtonId(intentId),
        output:
          "I still need the participant's age to complete the booking. Could you tell me their age in years?",
        metadata: { inboundMessageId: question?.id },
      }),
    ]);
  });

  it("is one trace for a notice that the Booking Intent being confirmed has expired", async () => {
    const waId = "16505550114";
    const expiredIntentButton = confirmBookingButtonId(randomUUID());

    await pressButton(waId, expiredIntentButton);

    const conversation = await conversationWith(waId);
    const [question] = await savedMessages(conversation);
    expect(await exportedTraces()).toEqual([
      expect.objectContaining({
        sessionId: conversation.id,
        input: expiredIntentButton,
        output:
          "That booking option has expired or was replaced. Please ask for available times again.",
        metadata: { inboundMessageId: question?.id },
      }),
    ]);
  });
});

describe("an inbound WhatsApp message that gets no reply", () => {
  it("is not traced when it was already answered and its job runs again", async () => {
    const waId = "16505550121";
    const wamid = wamidFrom(waId);
    await sendText(waId, "What can my son try?", wamid);
    const answered = await exportedTraces();

    await db
      .update(whatsappJobs)
      .set({ state: "pending", nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(whatsappJobs.dedupeKey, wamid));
    await runWhatsAppWorkerOnce(randomUUID());

    expect(answered).toHaveLength(1);
    expect(await exportedTraces()).toEqual(answered);
  });

  it("is not traced when it carries no text", async () => {
    const waId = "16505550122";
    const wamid = wamidFrom(waId);

    await send(
      wamid,
      textInboundPayload({ phoneNumberId, waId, wamid, text: " " }),
    );

    expect(await exportedTraces()).toEqual([]);
  });

  it("is not traced when it was sent to a number no school uses", async () => {
    const waId = "16505550123";
    const wamid = wamidFrom(waId);

    await send(
      wamid,
      textInboundPayload({
        phoneNumberId: unusedPhoneNumberId,
        waId,
        wamid,
        text: "Hello?",
      }),
    );

    expect(await exportedTraces()).toEqual([]);
  });

  it("is not traced when its conversation has reached the message limit", async () => {
    const waId = "16505550124";
    const conversationId = await startConversation(waId);
    await db.insert(messages).values(
      Array.from(
        { length: MAX_CHAT_MESSAGES_PER_CONVERSATION },
        (_, index) => ({
          conversationId,
          messageId: `earlier-${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          parts: [{ type: "text", text: `Message ${index + 1}` }],
          purgeAt: addDays(new Date(), 30),
        }),
      ),
    );

    await sendText(waId, "One more question?");

    expect(await exportedTraces()).toEqual([]);
  });

  it("is traced once, when it's answered, if it arrived while another message was being answered", async () => {
    const waId = "16505550125";
    const conversationId = await startConversation(waId);
    const holdLock = (generatingAt: Date | null) =>
      db
        .update(conversations)
        .set({ generatingAt })
        .where(eq(conversations.id, conversationId));
    const wamid = wamidFrom(waId);

    await holdLock(new Date());
    await sendText(waId, "Hello?", wamid);
    const whileLocked = await exportedTraces();
    await holdLock(null);
    await db
      .update(whatsappJobs)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(whatsappJobs.dedupeKey, wamid));
    await runWhatsAppWorkerOnce(randomUUID());

    expect(whileLocked).toEqual([]);
    expect(await exportedTraces()).toEqual([
      expect.objectContaining({
        sessionId: conversationId,
        input: "Hello?",
        output: scriptedReply,
      }),
    ]);
  });
});

describe("a failed attempt at a WhatsApp turn", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exported as an error with the assistant's spans under it, and the retry is traced separately", async () => {
    // The worker logs the failed job.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const waId = "16505550131";
    const conversationId = await startConversation(waId);
    const wamid = wamidFrom(waId);

    await whileSavingMessages(
      sql,
      {
        conversationId,
        role: "user",
        statement: "raise exception 'disk full'",
      },
      () => sendText(waId, "What can my son try?", wamid),
    );

    const exportedByWorker = spansExportedSoFar();
    const failedAttempt = exportedByWorker.find(isRoot);
    expect(failedAttempt?.attributes).toMatchObject({
      "session.id": conversationId,
      "langfuse.observation.level": "ERROR",
      "langfuse.observation.status_message":
        expect.stringContaining("disk full"),
    });
    const assistantRun = exportedByWorker.find(isAssistantRun);
    expect(assistantRun?.parentSpanContext?.spanId).toBe(
      failedAttempt?.spanContext().spanId,
    );

    await db
      .update(whatsappJobs)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(whatsappJobs.dedupeKey, wamid));
    await runWhatsAppWorkerOnce(randomUUID());

    expect(await exportedTraces()).toEqual([
      expect.objectContaining({ sessionId: conversationId, level: "ERROR" }),
      expect.objectContaining({
        sessionId: conversationId,
        input: "What can my son try?",
        output: scriptedReply,
      }),
    ]);
  });
});
