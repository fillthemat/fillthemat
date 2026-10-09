import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { addDays } from "date-fns";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { MAX_WHATSAPP_OUTBOUND_PER_WA_ID_PER_DAY } from "@/lib/security/limits";
import { confirmBookingButtonId } from "@/lib/whatsapp/confirmation";
import { upsertPendingBookingIntent } from "@/lib/whatsapp/intents";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import {
  everythingExported,
  exportedSpans,
  exportedTraces,
  isRoot,
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
  await POST(post(payload));
  // The database stamps when the message's job is due by its own clock, which
  // can run a few ms ahead of this one's: the worker would skip the job.
  const [job] = await db
    .select({ dueAt: whatsappJobs.nextAttemptAt })
    .from(whatsappJobs)
    .where(eq(whatsappJobs.dedupeKey, wamid));
  await sleep(Math.max(0, (job?.dueAt.getTime() ?? 0) + 1 - Date.now()));
  await runWhatsAppWorkerOnce(randomUUID());
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

// A conversation with `waId` whose Booking Intent awaits confirmation.
async function proposedBooking(
  waId: string,
  participant: { participantName: string; participantAge: number | null },
) {
  const [conversation] = await db
    .insert(conversations)
    .values({
      schoolId,
      resumeTokenHash: hashToken(randomToken()),
      waIdHash: hashWaId(waId),
      expiresAt: addDays(new Date(), 30),
    })
    .returning({ id: conversations.id });
  const conversationId = requireRow(conversation, "conversation").id;
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
    .where(eq(whatsappJobs.phoneNumberId, phoneNumberId));
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("a WhatsApp assistant turn's trace", () => {
  it("is one trace in the conversation's session, for the school, tagged whatsapp, with the message as input and the reply as output", async () => {
    const waId = "16505550101";

    await sendText(waId, "What can my son try?");

    const conversation = await conversationWith(waId);
    const traces = await exportedTraces();
    expect(
      traces.filter(({ sessionId }) => sessionId === conversation.id),
    ).toEqual([
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
    const assistantRun = spans.find(
      (span) => span.attributes["gen_ai.operation.name"] === "invoke_agent",
    );
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
    const identifiers = [waId, hashWaId(waId), wamid];
    const leaks = spans.flatMap((span) =>
      identifiers
        .filter((identifier) => everythingExported(span).includes(identifier))
        .map((identifier) => `${span.name}: ${identifier}`),
    );
    expect(leaks).toEqual([]);
  });
});

describe("a WhatsApp turn answered without the assistant", () => {
  it("is one trace for a booking confirmation, with the saved confirmation as output and no model spans", async () => {
    const waId = "16505550111";
    const { conversationId, intentId } = await proposedBooking(waId, {
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

  it("is one trace for a notice that a confirmed booking needs the participant's age", async () => {
    const waId = "16505550113";
    const { conversationId, intentId } = await proposedBooking(waId, {
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

  it("is one trace for a notice that the booking option being confirmed has expired", async () => {
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
