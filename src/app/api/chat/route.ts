import {
  createAgentUIStreamResponse,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { addDays } from "date-fns";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { createBookingAgent } from "@/lib/ai/assistant";
import { hashToken } from "@/lib/crypto";
import { isLocalAiStub } from "@/lib/dev-flags";
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

    const catalog = await loadSchoolCatalog(school.id);

    const history = stored.map((row) => ({
      id: row.messageId,
      role: row.role as UIMessage["role"],
      parts: row.parts as UIMessage["parts"],
    }));
    const uiMessages = await validateUIMessages({
      messages: [...history, body.message],
    });

    await db.insert(messages).values({
      conversationId: conversation.id,
      messageId: body.message.id,
      role: "user",
      parts: body.message.parts,
      completion: "complete",
      purgeAt,
    });

    const persistAssistant = async ({
      responseMessage,
      isAborted,
      outcome,
    }: {
      responseMessage: UIMessage;
      isAborted: boolean;
      outcome: { status: string };
    }) => {
      const completion =
        isAborted || outcome.status === "aborted"
          ? "aborted"
          : outcome.status === "failed"
            ? "error"
            : "complete";
      await db.insert(messages).values({
        conversationId: conversation.id,
        messageId: responseMessage.id,
        role: "assistant",
        parts: responseMessage.parts,
        completion,
        purgeAt,
      });
      await db
        .update(conversations)
        .set({ generatingAt: null, updatedAt: new Date() })
        .where(eq(conversations.id, conversation.id));
    };

    if (isLocalAiStub()) {
      const offeringNames = catalog.offerings
        .filter((offering) => offering.active)
        .map((offering) => offering.name);
      const stubText =
        offeringNames.length > 0
          ? `Local chat stub (no VERCEL_OIDC_TOKEN). ${school.name} offers ${offeringNames.join(", ")}. Use Book Trial to confirm a slot.`
          : `Local chat stub (no VERCEL_OIDC_TOKEN). Use Book Trial on this page to pick a time at ${school.name}.`;
      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          originalMessages: uiMessages as never,
          generateId,
          execute: ({ writer }) => {
            writer.write({ type: "text-start", id: "stub" });
            writer.write({
              type: "text-delta",
              id: "stub",
              delta: stubText,
            });
            writer.write({ type: "text-end", id: "stub" });
          },
          onEnd: persistAssistant,
        }),
      });
    }

    const agent = createBookingAgent({
      school,
      offerings: catalog.offerings,
      windows: catalog.windows,
      occurrences: catalog.occurrences,
      faqs: catalog.faqs,
      now,
    });

    return createAgentUIStreamResponse({
      agent,
      uiMessages: uiMessages as never,
      originalMessages: uiMessages as never,
      generateMessageId: generateId,
      consumeSseStream: async ({ stream }) => {
        await stream.pipeTo(new WritableStream({ write() {} }));
      },
      onEnd: persistAssistant,
    });
  } catch (error) {
    await db
      .update(conversations)
      .set({ generatingAt: null, updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
    throw error;
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
