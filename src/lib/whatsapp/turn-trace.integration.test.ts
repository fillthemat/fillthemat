import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import { getDb } from "@/db";
import { conversations, messages, whatsappJobs } from "@/db/schema";
import { hashWaId } from "@/lib/crypto";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import {
  exportedSpans,
  exportedTraces,
  isRoot,
  spansExportedSoFar,
} from "@/test/tracing";
import { post, textInboundPayload } from "@/test/whatsapp-webhook";

loadLocalEnv();

const db = getDb();
const sql = authSql();
const suffix = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const phoneNumberId = `499${Date.now().toString().slice(-9)}`;
const scriptedReply =
  "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.";
let schoolId = "";

// Like Meta's message ids, this one encodes the sender's phone number.
function wamidFrom(waId: string) {
  const id = `\x1c\x18\x0b${waId}\x15\x02\x00\x12\x18\x14${randomUUID()}`;
  return `wamid.${Buffer.from(id).toString("base64")}`;
}

// A text from `waId` through the webhook, then the worker it would wake.
async function sendText(waId: string, text: string, wamid = wamidFrom(waId)) {
  await POST(post(textInboundPayload({ phoneNumberId, waId, wamid, text })));
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
});
