import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { hrTimeToMilliseconds } from "@opentelemetry/core";
import { addDays } from "date-fns";
import { asc, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { MAX_CHAT_MESSAGES_PER_CONVERSATION } from "@/lib/security/limits";
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
  failSpanExports,
  isAssistantRun,
  isRoot,
  leaks,
} from "@/test/tracing";
import { loadWebTranscript, startWebTurn } from "./index";

loadLocalEnv();

const db = getDb();
const sql = authSql();
const suffix = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const otherOwnerId = randomUUID();
const slug = `chat-${suffix}`;
const otherSlug = `other-chat-${suffix}`;
// The assistant sees these in its instructions and in a tool result.
const schoolPhone = "+1 512 555 0142";
const coachEmail = "coach@webchat.example";
let schoolId = "";
let kidsBjjId = "";

function startMessage(resumeToken: string, id: string, text: string) {
  return startWebTurn({
    slug,
    preview: false,
    resumeToken,
    message: { id, role: "user", parts: [{ type: "text", text }] },
  });
}

async function sendMessage(resumeToken: string, id: string, text: string) {
  const result = await startMessage(resumeToken, id, text);
  if (!result.ok) throw new Error(result.reason);
  return result.response;
}

// The id the browser was given for the reply, from the stream's start chunk.
function streamedReplyId(stream: string) {
  for (const line of stream.split("\n")) {
    if (!line.startsWith("data: {")) continue;
    const chunk = JSON.parse(line.slice("data: ".length));
    if (chunk.type === "start") return chunk.messageId;
  }
  return undefined;
}

async function conversationFor(resumeToken: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.resumeTokenHash, hashToken(resumeToken)))
    .limit(1);
  return requireRow(conversation, "conversation");
}

// A conversation as earlier turns would have left it.
async function existingConversation({
  messageIds = [],
  generatingAt = null,
  expiresAt = addDays(new Date(), 30),
}: {
  messageIds?: string[];
  generatingAt?: Date | null;
  expiresAt?: Date;
}) {
  const resumeToken = randomUUID();
  const [conversation] = await db
    .insert(conversations)
    .values({
      schoolId,
      resumeTokenHash: hashToken(resumeToken),
      generatingAt,
      expiresAt,
    })
    .returning({ id: conversations.id });
  const conversationId = requireRow(conversation, "conversation").id;
  if (messageIds.length > 0) {
    await db.insert(messages).values(
      messageIds.map((messageId, index) => ({
        conversationId,
        messageId,
        role: index % 2 === 0 ? "user" : "assistant",
        parts: [{ type: "text", text: `Message ${index + 1}` }],
        purgeAt: expiresAt,
      })),
    );
  }
  return { resumeToken, conversationId };
}

// Sorted: rows inserted together share a created_at.
async function savedMessageIds(conversationId: string) {
  const saved = await savedMessages(conversationId);
  return saved.map(({ messageId }) => messageId).sort();
}

async function savedMessages(conversationId: string) {
  return db
    .select({
      messageId: messages.messageId,
      role: messages.role,
      parts: messages.parts,
      completion: messages.completion,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "Web Chat School",
    slug,
    phone: schoolPhone,
    publishedAt: new Date(),
    offerings: [
      {
        name: "Kids BJJ",
        description: `Questions? Email ${coachEmail}`,
        minimumAge: 5,
        maximumAge: 12,
      },
      { name: "Adult Muay Thai", active: false },
    ],
  });
  schoolId = seeded.schoolId;
  kidsBjjId = requireRow(seeded.offeringIds[0], "Kids BJJ offering");
  await seedSchool(sql, {
    ownerId: otherOwnerId,
    name: "Another Web Chat School",
    slug: otherSlug,
    publishedAt: new Date(),
    offerings: [{ name: "BJJ" }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await deleteSchoolOwner(sql, otherOwnerId);
  await sql.end({ timeout: 5 });
});

describe("a web chat turn with no AI Gateway token", () => {
  it("loads the saved transcript for this school and token, or an empty list for an unknown token", async () => {
    const resumeToken = randomUUID();
    await (await sendMessage(resumeToken, "question-1", "Hi!")).text();

    const result = await loadWebTranscript({
      slug,
      preview: false,
      resumeToken,
    });
    expect(result).toEqual({
      ok: true,
      messages: [
        {
          id: "question-1",
          role: "user",
          parts: [{ type: "text", text: "Hi!" }],
        },
        expect.objectContaining({ role: "assistant" }),
      ],
    });
    expect(
      await loadWebTranscript({
        slug,
        preview: false,
        resumeToken: randomUUID(),
      }),
    ).toEqual({ ok: true, messages: [] });
  });

  it("saves the user message and a reply that lists the school's trial offerings, then releases the conversation lock", async () => {
    const resumeToken = randomUUID();

    const response = await sendMessage(
      resumeToken,
      "question-1",
      "What can my son try?",
    );
    expect(response.status).toBe(200);
    // The stream only ends once the reply has been saved.
    const stream = await response.text();

    const conversation = await conversationFor(resumeToken);
    expect(await savedMessages(conversation.id)).toEqual([
      {
        messageId: "question-1",
        role: "user",
        completion: "complete",
        parts: [{ type: "text", text: "What can my son try?" }],
      },
      {
        messageId: streamedReplyId(stream),
        role: "assistant",
        completion: "complete",
        parts: [
          { type: "step-start" },
          expect.objectContaining({
            type: "tool-list_trial_offerings",
            state: "output-available",
            output: {
              offerings: [
                expect.objectContaining({ id: kidsBjjId, name: "Kids BJJ" }),
              ],
              noMatch: false,
            },
          }),
          { type: "step-start" },
          expect.objectContaining({
            type: "text",
            text: "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.",
          }),
        ],
      },
    ]);
    expect(conversation.generatingAt).toBeNull();
  });

  it("answers a follow-up message with the earlier reply's tool parts loaded back as history", async () => {
    const resumeToken = randomUUID();
    await (await sendMessage(resumeToken, "question-1", "Hi!")).text();

    const response = await sendMessage(
      resumeToken,
      "question-2",
      "And for adults?",
    );
    expect(response.status).toBe(200);
    await response.text();

    const conversation = await conversationFor(resumeToken);
    const saved = await savedMessages(conversation.id);
    expect(saved.map(({ role, completion }) => [role, completion])).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
    expect(saved[3]?.parts).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.",
      }),
    );
  });
});

describe("a web chat turn's trace", () => {
  it("is one trace in the conversation's session, for the school, tagged web, with the message as input and the reply as output", async () => {
    const resumeToken = randomUUID();

    const response = await sendMessage(
      resumeToken,
      "question-1",
      "What can my son try?",
    );
    await response.text();

    const conversation = await conversationFor(resumeToken);
    const traces = await exportedTraces();
    expect(
      traces.filter(({ sessionId }) => sessionId === conversation.id),
    ).toEqual([
      expect.objectContaining({
        sessionId: conversation.id,
        userId: schoolId,
        tags: ["web"],
        input: "What can my son try?",
        output:
          "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.",
      }),
    ]);
  });

  it("nests the assistant's model calls and tool calls under the turn", async () => {
    const resumeToken = randomUUID();

    await (
      await sendMessage(resumeToken, "question-1", "What can my son try?")
    ).text();

    const conversation = await conversationFor(resumeToken);
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

  it("keeps the turns of two conversations replying at once in their own traces", async () => {
    const turns = [
      { resumeToken: randomUUID(), question: "Do you have adult classes?" },
      { resumeToken: randomUUID(), question: "What can my son try?" },
    ];

    await Promise.all(
      turns.map(async ({ resumeToken, question }) =>
        (await sendMessage(resumeToken, "question-1", question)).text(),
      ),
    );

    const spans = await exportedSpans();
    const traces = [
      ...Map.groupBy(spans, (span) => span.spanContext().traceId).values(),
    ].map((traceSpans) => {
      const question = String(
        traceSpans.find(isRoot)?.attributes["langfuse.observation.input"],
      );
      return {
        question,
        sessions: [
          ...new Set(traceSpans.map((span) => span.attributes["session.id"])),
        ],
        assistantRunsThatSawIt: traceSpans
          .filter(isAssistantRun)
          .map((span) =>
            String(span.attributes["gen_ai.input.messages"]).includes(question),
          ),
      };
    });
    expect(
      traces.toSorted((a, b) => a.question.localeCompare(b.question)),
    ).toEqual(
      await Promise.all(
        turns.map(async ({ resumeToken, question }) => ({
          question,
          sessions: [(await conversationFor(resumeToken)).id],
          assistantRunsThatSawIt: [true],
        })),
      ),
    );
  });

  it("records the saved message ids, how the reply ended, the model, and a short hash of the platform instructions", async () => {
    const resumeToken = randomUUID();

    await (
      await sendMessage(resumeToken, "question-1", "What can my son try?")
    ).text();

    const conversation = await conversationFor(resumeToken);
    const saved = await db
      .select({ id: messages.id, role: messages.role })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));
    const [turnTrace] = await exportedTraces();
    expect(turnTrace?.metadata).toEqual({
      inboundMessageId: saved.find(({ role }) => role === "user")?.id,
      replyMessageId: saved.find(({ role }) => role === "assistant")?.id,
      completion: "complete",
      modelId: "scripted-local",
      platformInstructionsHash: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
  });

  it("ends only once the reply has been saved", async () => {
    const { resumeToken, conversationId } = await existingConversation({});

    await whileSavingMessages(
      sql,
      { conversationId, role: "assistant", statement: "perform pg_sleep(0.5)" },
      async () => {
        await (
          await sendMessage(resumeToken, "question-1", "What can my son try?")
        ).text();
      },
    );

    const spans = await exportedSpans();
    const root = spans.find(isRoot);
    const assistantRun = spans.find(isAssistantRun);
    if (!root || !assistantRun) throw new Error("missing turn spans");
    // The assistant was done half a second before its reply was saved.
    expect(
      hrTimeToMilliseconds(root.endTime) -
        hrTimeToMilliseconds(assistantRun.endTime),
    ).toBeGreaterThan(400);
  });

  it("ends as an error when the reply can't be saved, and the lock is still released", async () => {
    // The assistant logs the failure to save.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { resumeToken, conversationId } = await existingConversation({});

    await whileSavingMessages(
      sql,
      {
        conversationId,
        role: "assistant",
        statement: "raise exception 'disk full'",
      },
      async () => {
        await (
          await sendMessage(resumeToken, "question-1", "What can my son try?")
        ).text();
      },
    );

    expect(await exportedTraces()).toEqual([
      expect.objectContaining({
        sessionId: conversationId,
        input: "What can my son try?",
        level: "ERROR",
        statusMessage: expect.stringContaining("disk full"),
      }),
    ]);
    expect(await savedMessageIds(conversationId)).toEqual(["question-1"]);
    expect((await conversationFor(resumeToken)).generatingAt).toBeNull();
  });

  it("masks email addresses and phone numbers in every exported span, but not names or ages", async () => {
    const resumeToken = randomUUID();

    await (
      await sendMessage(
        resumeToken,
        "question-1",
        "My daughter Ana is 8. Email ana.parent@example.com or call +44 7700 900123.\n(512) 555-0199 is our home number.",
      )
    ).text();

    const [turnTrace] = await exportedTraces();
    expect(turnTrace?.input).toBe(
      "My daughter Ana is 8. Email [email] or call [phone].\n[phone] is our home number.",
    );
    const spans = await exportedSpans();
    expect(
      leaks(spans, [
        "ana.parent@example.com",
        "+44 7700 900123",
        "(512) 555-0199",
        schoolPhone,
        coachEmail,
      ]),
    ).toEqual([]);
    const listing = spans.find(
      ({ name }) => name === "execute_tool list_trial_offerings",
    );
    expect(listing?.attributes["gen_ai.tool.call.result"]).toContain(
      "Questions? Email [email]",
    );
    const assistantRun = spans.find(isAssistantRun);
    expect(assistantRun?.attributes["gen_ai.system_instructions"]).toContain(
      "[phone]",
    );
  });
});

describe("a web chat turn whose browser disconnects mid-reply", () => {
  it("still saves the reply, releases the lock, and is traced once, with the saved reply as output", async () => {
    const { resumeToken, conversationId } = await existingConversation({});

    await whileSavingMessages(
      sql,
      { conversationId, role: "assistant", statement: "perform pg_sleep(0.5)" },
      async () => {
        const response = await sendMessage(
          resumeToken,
          "question-1",
          "What can my son try?",
        );
        const body = response.body?.getReader();
        await body?.read();
        await body?.cancel();

        // The browser left before the reply was saved.
        expect(await savedMessageIds(conversationId)).toEqual(["question-1"]);
        await vi.waitFor(
          async () =>
            expect(
              (await conversationFor(resumeToken)).generatingAt,
            ).toBeNull(),
          { timeout: 5_000 },
        );
      },
    );

    const [, reply] = await savedMessages(conversationId);
    expect(reply).toEqual(
      expect.objectContaining({ role: "assistant", completion: "complete" }),
    );
    expect(reply?.parts).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.",
      }),
    );
    await vi.waitFor(async () =>
      expect(await exportedTraces()).toEqual([
        expect.objectContaining({
          sessionId: conversationId,
          output:
            "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.",
        }),
      ]),
    );
  });
});

describe("a web chat turn whose trace can't be exported", () => {
  it("still replies, saves the reply, and releases the lock, logging the failure without the conversation", async () => {
    failSpanExports();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const resumeToken = randomUUID();

    const response = await sendMessage(
      resumeToken,
      "question-1",
      "What can my son try?",
    );
    expect(response.status).toBe(200);
    await response.text();

    const conversation = await conversationFor(resumeToken);
    const saved = await savedMessages(conversation.id);
    expect(saved.map(({ role, completion }) => [role, completion])).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
    expect(conversation.generatingAt).toBeNull();
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    const logs = inspect(logged.mock.calls, { depth: null });
    expect(logs).not.toContain("What can my son try?");
    expect(logs).not.toContain("Kids BJJ");
  });
});

describe("a rejected web chat message", () => {
  it("refuses a resume token belonging to another school and never returns its transcript", async () => {
    const { resumeToken, conversationId } = await existingConversation({
      messageIds: ["question-1", "reply-1"],
    });
    const input = { slug: otherSlug, preview: false, resumeToken };

    expect(
      await startWebTurn({
        ...input,
        message: {
          id: "question-2",
          role: "user",
          parts: [{ type: "text", text: "Hi!" }],
        },
      }),
    ).toEqual({ ok: false, reason: "invalid_conversation" });
    expect(await loadWebTranscript(input)).toEqual({ ok: true, messages: [] });
    expect(await savedMessageIds(conversationId)).toEqual([
      "question-1",
      "reply-1",
    ]);
    expect((await conversationFor(resumeToken)).generatingAt).toBeNull();
    expect(await exportedTraces()).toEqual([]);
  });

  it("refuses send and transcript requests for a missing school", async () => {
    const input = {
      slug: `missing-${suffix}`,
      preview: false,
      resumeToken: randomUUID(),
    };
    expect(
      await startWebTurn({
        ...input,
        message: {
          id: "question-1",
          role: "user",
          parts: [{ type: "text", text: "Hi!" }],
        },
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await loadWebTranscript(input)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await exportedTraces()).toEqual([]);
  });

  it("refuses while another reply is generating, saves nothing, leaves that reply's lock in place, and is not traced", async () => {
    const lockedAt = new Date(Date.now() - 5_000);
    const { resumeToken, conversationId } = await existingConversation({
      messageIds: ["question-1"],
      generatingAt: lockedAt,
    });

    const result = await startMessage(resumeToken, "question-2", "Hello?");

    expect(result).toEqual({ ok: false, reason: "generation_in_progress" });
    expect(await savedMessageIds(conversationId)).toEqual(["question-1"]);
    expect((await conversationFor(resumeToken)).generatingAt).toEqual(lockedAt);
    expect(await exportedTraces()).toEqual([]);
  });

  it("refuses when the message was already sent, saves no reply, releases the lock, and is not traced", async () => {
    const { resumeToken, conversationId } = await existingConversation({
      messageIds: ["question-1", "reply-1"],
    });

    const result = await startMessage(resumeToken, "question-1", "Hello?");

    expect(result).toEqual({ ok: false, reason: "duplicate" });
    expect(await savedMessageIds(conversationId)).toEqual([
      "question-1",
      "reply-1",
    ]);
    expect((await conversationFor(resumeToken)).generatingAt).toBeNull();
    expect(await exportedTraces()).toEqual([]);
  });

  it("refuses once the conversation is at its message limit, saves nothing, releases the lock, and is not traced", async () => {
    const messageIds = Array.from(
      { length: MAX_CHAT_MESSAGES_PER_CONVERSATION },
      (_, index) => `message-${index + 1}`,
    );
    const { resumeToken, conversationId } = await existingConversation({
      messageIds,
    });

    const result = await startMessage(resumeToken, "one-more", "Hello?");

    expect(result).toEqual({ ok: false, reason: "message_limit" });
    expect(await savedMessageIds(conversationId)).toEqual(
      messageIds.toSorted(),
    );
    expect((await conversationFor(resumeToken)).generatingAt).toBeNull();
    expect(await exportedTraces()).toEqual([]);
  });

  it("refuses once the conversation has expired, saves nothing, and is not traced", async () => {
    const { resumeToken, conversationId } = await existingConversation({
      messageIds: ["question-1"],
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await startMessage(resumeToken, "question-2", "Hello?");

    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(await savedMessageIds(conversationId)).toEqual(["question-1"]);
    expect((await conversationFor(resumeToken)).generatingAt).toBeNull();
    expect(await exportedTraces()).toEqual([]);
  });
});

describe("a web chat turn that fails before its reply starts", () => {
  it("releases the conversation lock and ends its trace as an error", async () => {
    const resumeToken = randomUUID();

    // Postgres cannot store a NUL character, so saving this message fails.
    await expect(
      sendMessage(resumeToken, "question-1", "Hello\u0000"),
    ).rejects.toThrow();

    const conversation = await conversationFor(resumeToken);
    expect(conversation.generatingAt).toBeNull();
    expect(await exportedTraces()).toEqual([
      expect.objectContaining({ sessionId: conversation.id, level: "ERROR" }),
    ]);
  });
});
