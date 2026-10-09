import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  conversations,
  messages,
  schools,
  trialOfferings,
  users,
} from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { MAX_CHAT_MESSAGES_PER_CONVERSATION } from "@/lib/security/limits";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import { POST } from "./route";

loadLocalEnv();

const db = getDb();
const sql = authSql();
const suffix = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const slug = `chat-${suffix}`;
let schoolId = "";
let kidsBjjId = "";

function sendMessage(resumeToken: string, id: string, text: string) {
  return POST(
    new Request("http://127.0.0.1:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug,
        resumeToken,
        message: { id, role: "user", parts: [{ type: "text", text }] },
      }),
    }),
  );
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

// A conversation as the route would have left it after earlier turns.
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
  await insertAuthUser(sql, ownerId, `chat-${suffix}@local.test`);
  await db.insert(users).values({
    id: ownerId,
    email: `chat-${suffix}@local.test`,
    name: "Web Chat Owner",
  });
  const [school] = await db
    .insert(schools)
    .values({
      ownerUserId: ownerId,
      name: "Web Chat School",
      slug,
      timezone: "America/New_York",
      notificationEmail: `chat-${suffix}@local.test`,
      approvedAt: new Date(),
      publishedAt: new Date(),
    })
    .returning({ id: schools.id });
  if (!school) throw new Error("failed to seed school");
  schoolId = school.id;
  const [kidsBjj] = await db
    .insert(trialOfferings)
    .values([
      { schoolId, name: "Kids BJJ", minimumAge: 5, maximumAge: 12 },
      { schoolId, name: "Adult Muay Thai", active: false },
    ])
    .returning({ id: trialOfferings.id });
  kidsBjjId = requireRow(kidsBjj, "Kids BJJ offering").id;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, ownerId));
  await deleteAuthUser(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("a web chat turn with no AI Gateway token", () => {
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

describe("a rejected web chat message", () => {
  it("gets 409 while another reply is generating, saves nothing, and leaves that reply's lock in place", async () => {
    const lockedAt = new Date(Date.now() - 5_000);
    const { resumeToken, conversationId } = await existingConversation({
      messageIds: ["question-1"],
      generatingAt: lockedAt,
    });

    const response = await sendMessage(resumeToken, "question-2", "Hello?");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "generation_in_progress" });
    expect(await savedMessageIds(conversationId)).toEqual(["question-1"]);
    expect((await conversationFor(resumeToken)).generatingAt).toEqual(lockedAt);
  });

  it("gets 409 when the message was already sent, saves no reply, and releases the lock", async () => {
    const { resumeToken, conversationId } = await existingConversation({
      messageIds: ["question-1", "reply-1"],
    });

    const response = await sendMessage(resumeToken, "question-1", "Hello?");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "duplicate" });
    expect(await savedMessageIds(conversationId)).toEqual([
      "question-1",
      "reply-1",
    ]);
    expect((await conversationFor(resumeToken)).generatingAt).toBeNull();
  });

  it("gets 429 once the conversation is at its message limit, saves nothing, and releases the lock", async () => {
    const messageIds = Array.from(
      { length: MAX_CHAT_MESSAGES_PER_CONVERSATION },
      (_, index) => `message-${index + 1}`,
    );
    const { resumeToken, conversationId } = await existingConversation({
      messageIds,
    });

    const response = await sendMessage(resumeToken, "one-more", "Hello?");

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "limit" });
    expect(await savedMessageIds(conversationId)).toEqual(
      messageIds.toSorted(),
    );
    expect((await conversationFor(resumeToken)).generatingAt).toBeNull();
  });

  it("gets 410 once the conversation has expired, and saves nothing", async () => {
    const { resumeToken, conversationId } = await existingConversation({
      messageIds: ["question-1"],
      expiresAt: new Date(Date.now() - 60_000),
    });

    const response = await sendMessage(resumeToken, "question-2", "Hello?");

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "expired" });
    expect(await savedMessageIds(conversationId)).toEqual(["question-1"]);
    expect((await conversationFor(resumeToken)).generatingAt).toBeNull();
  });
});

describe("a web chat turn that fails before its reply starts", () => {
  it("releases the conversation lock", async () => {
    const resumeToken = randomUUID();

    // Postgres cannot store a NUL character, so saving this message fails.
    await expect(
      sendMessage(resumeToken, "question-1", "Hello\u0000"),
    ).rejects.toThrow();

    expect((await conversationFor(resumeToken)).generatingAt).toBeNull();
  });
});
