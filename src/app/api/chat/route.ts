import { type UIMessage, validateUIMessages } from "ai";
import { addDays } from "date-fns";
import { and, asc, eq, isNull } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { PLATFORM_INSTRUCTIONS_HASH, streamedReply } from "@/lib/ai/assistant";
import { hashToken } from "@/lib/crypto";
import { TRANSCRIPT_RETENTION_DAYS } from "@/lib/schedule/constants";
import {
  getSchoolForLandingAccess,
  loadSchoolCatalog,
} from "@/lib/schools/public";
import {
  MAX_CHAT_MESSAGES_PER_CONVERSATION,
  MAX_USER_MESSAGE_CHARS,
  requestBodyTooLarge,
} from "@/lib/security/limits";
import { startTurnTrace } from "@/lib/tracing/turn-trace";

function textFromMessage(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

export async function POST(request: Request) {
  if (requestBodyTooLarge(request.headers.get("content-length"))) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  const body = (await request.json()) as {
    slug?: string;
    resumeToken?: string;
    preview?: boolean;
    message?: UIMessage;
  };
  if (
    !body.slug ||
    !body.resumeToken ||
    !body.message ||
    body.message.role !== "user"
  ) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const userText = textFromMessage(body.message);
  if (!userText || userText.length > MAX_USER_MESSAGE_CHARS) {
    return Response.json({ error: "invalid_message" }, { status: 400 });
  }

  const school = await getSchoolForLandingAccess(body.slug, {
    preview: Boolean(body.preview),
  });
  if (!school) return Response.json({ error: "not_found" }, { status: 404 });

  const db = getDb();
  const tokenHash = hashToken(body.resumeToken);
  const now = new Date();
  const purgeAt = addDays(now, TRANSCRIPT_RETENTION_DAYS);

  let [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, school.id),
        eq(conversations.resumeTokenHash, tokenHash),
      ),
    )
    .limit(1);

  if (!conversation) {
    const [created] = await db
      .insert(conversations)
      .values({
        schoolId: school.id,
        resumeTokenHash: tokenHash,
        expiresAt: purgeAt,
      })
      .onConflictDoNothing({ target: conversations.resumeTokenHash })
      .returning();
    conversation = created;
    if (!conversation) {
      const [again] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.resumeTokenHash, tokenHash))
        .limit(1);
      if (!again || again.schoolId !== school.id) {
        return Response.json(
          { error: "invalid_conversation" },
          { status: 403 },
        );
      }
      conversation = again;
    }
  }

  if (conversation.expiresAt <= now) {
    return Response.json({ error: "expired" }, { status: 410 });
  }

  const claimed = await db
    .update(conversations)
    .set({ generatingAt: now, updatedAt: now })
    .where(
      and(
        eq(conversations.id, conversation.id),
        isNull(conversations.generatingAt),
      ),
    )
    .returning();
  if (!claimed[0]) {
    return Response.json({ error: "generation_in_progress" }, { status: 409 });
  }

  const releaseLock = async () => {
    await db
      .update(conversations)
      .set({ generatingAt: null, updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
  };

  // Every way out of this handler releases the lock, unless the reply has
  // started streaming: then its onFinish releases it once the reply is saved.
  let replyOwnsLock = false;
  try {
    const stored = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(asc(messages.createdAt));

    if (stored.length >= MAX_CHAT_MESSAGES_PER_CONVERSATION) {
      return Response.json({ error: "limit" }, { status: 429 });
    }

    if (stored.some((row) => row.messageId === body.message?.id)) {
      return Response.json({ error: "duplicate" }, { status: 409 });
    }

    // The message is accepted, so it starts a turn. Its trace is exported
    // after the response, once the turn has ended: a browser that disconnects
    // early closes the response before the reply is saved.
    const message = body.message;
    const turn = startTurnTrace({
      channel: "web",
      conversationId: conversation.id,
      schoolId: school.id,
      inboundMessageId: message.id,
      inboundText: userText,
    });
    try {
      after(() => turn.exportWhenEnded());
    } catch {
      // after() needs a Next request scope, which tests and scripts lack.
      void turn.exportWhenEnded();
    }

    const response = await turn.run(async () => {
      const catalog = await loadSchoolCatalog(school.id);

      const history = stored.map((row) => ({
        id: row.messageId,
        role: row.role as UIMessage["role"],
        parts: row.parts as UIMessage["parts"],
      }));
      const uiMessages = await validateUIMessages({
        messages: [...history, message],
      });

      await db.insert(messages).values({
        conversationId: conversation.id,
        messageId: message.id,
        role: "user",
        parts: message.parts,
        completion: "complete",
        purgeAt,
      });

      return streamedReply({
        school,
        catalog,
        messages: uiMessages,
        now,
        onFinish: async ({ reply, completion, modelId }) => {
          // Saving the reply is the last of the turn's work.
          await turn.run(async () => {
            try {
              await db.insert(messages).values({
                conversationId: conversation.id,
                messageId: reply.id,
                role: "assistant",
                parts: reply.parts,
                completion,
                purgeAt,
              });
            } finally {
              await releaseLock();
            }
          });
          turn.end({
            replyMessageId: reply.id,
            replyText: textFromMessage(reply),
            completion,
            assistant: {
              modelId,
              platformInstructionsHash: PLATFORM_INSTRUCTIONS_HASH,
            },
          });
        },
      });
    });
    replyOwnsLock = true;
    return response;
  } finally {
    if (!replyOwnsLock) await releaseLock();
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const resumeToken = url.searchParams.get("resumeToken");
  const preview = url.searchParams.get("preview") === "1";
  if (!slug || !resumeToken) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const school = await getSchoolForLandingAccess(slug, { preview });
  if (!school) return Response.json({ error: "not_found" }, { status: 404 });
  const db = getDb();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, school.id),
        eq(conversations.resumeTokenHash, hashToken(resumeToken)),
      ),
    )
    .limit(1);
  if (!conversation) return Response.json({ messages: [] });
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(asc(messages.createdAt));
  return Response.json({
    messages: rows.map((row) => ({
      id: row.messageId,
      role: row.role,
      parts: row.parts,
    })),
  });
}
