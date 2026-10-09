import { randomUUID } from "node:crypto";
import { type UIMessage, validateUIMessages } from "ai";
import { after } from "next/server";
import { streamedReply } from "@/lib/ai/assistant";
import {
  appendMessage,
  claimGeneration,
  findConversation,
  findOrCreateConversation,
  loadTranscript,
} from "@/lib/conversations";
import {
  getSchoolForLandingAccess,
  loadSchoolCatalog,
} from "@/lib/schools/public";
import { MAX_CHAT_MESSAGES_PER_CONVERSATION } from "@/lib/security/limits";
import { startTurnTrace } from "@/lib/tracing/turn-trace";

type WebConversationInput = {
  slug: string;
  preview: boolean;
  resumeToken: string;
};

export type WebTurnResult =
  | { ok: true; response: Response }
  | {
      ok: false;
      reason:
        | "not_found"
        | "invalid_conversation"
        | "generation_in_progress"
        | "duplicate"
        | "message_limit"
        | "expired";
    };

export type WebTranscriptResult =
  | { ok: true; messages: UIMessage[] }
  | { ok: false; reason: "not_found" };

/** Read only: an unknown token never creates a conversation. */
export async function loadWebTranscript({
  slug,
  preview,
  resumeToken,
}: WebConversationInput): Promise<WebTranscriptResult> {
  const school = await getSchoolForLandingAccess(slug, { preview });
  if (!school) return { ok: false, reason: "not_found" };
  const conversation = await findConversation({
    schoolId: school.id,
    identity: { channel: "web", resumeToken },
  });
  return {
    ok: true,
    messages: conversation ? await loadTranscript(conversation.id) : [],
  };
}

function textFromMessage(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

/** Accept one web turn, handing its lock to the reply until it is saved. */
export async function startWebTurn({
  slug,
  preview,
  resumeToken,
  message,
}: WebConversationInput & { message: UIMessage }): Promise<WebTurnResult> {
  const school = await getSchoolForLandingAccess(slug, { preview });
  if (!school) return { ok: false, reason: "not_found" };

  const now = new Date();
  const resolved = await findOrCreateConversation({
    schoolId: school.id,
    identity: { channel: "web", resumeToken },
    now,
  });
  if (!resolved.ok) return resolved;
  const { conversation } = resolved;
  // Preserved until the lifecycle ticket replaces past-deadline conversations.
  if (conversation.expiresAt <= now) return { ok: false, reason: "expired" };

  const lock = await claimGeneration(conversation.id, { now });
  if (!lock) return { ok: false, reason: "generation_in_progress" };

  let replyOwnsLock = false;
  try {
    const history = await loadTranscript(conversation.id);
    if (history.length >= MAX_CHAT_MESSAGES_PER_CONVERSATION) {
      return { ok: false, reason: "message_limit" };
    }
    if (history.some(({ id }) => id === message.id)) {
      return { ok: false, reason: "duplicate" };
    }

    const inboundMessageId = randomUUID();
    const turn = startTurnTrace({
      channel: "web",
      conversationId: conversation.id,
      schoolId: school.id,
      inboundMessageId,
      inboundText: textFromMessage(message),
    });
    try {
      after(() => turn.exportWhenEnded());
    } catch {
      // Tests and scripts have no Next request scope. Export still waits for
      // the saved reply, including when a browser disconnects mid-stream.
      void turn.exportWhenEnded();
    }

    const response = await turn.run(async () => {
      const catalog = await loadSchoolCatalog(school.id);
      const uiMessages = await validateUIMessages({
        messages: [...history, message],
      });
      await appendMessage({
        id: inboundMessageId,
        conversationId: conversation.id,
        messageId: message.id,
        role: "user",
        parts: message.parts,
      });

      return streamedReply({
        school,
        catalog,
        messages: uiMessages,
        now,
        onFinish: async ({ reply, completion, provenance }) => {
          const replyMessageId = randomUUID();
          await turn.run(async () => {
            try {
              await appendMessage({
                id: replyMessageId,
                conversationId: conversation.id,
                messageId: reply.id,
                role: "assistant",
                parts: reply.parts,
                completion,
              });
            } finally {
              await lock.release();
            }
          });
          turn.end({
            text: textFromMessage(reply),
            messageId: replyMessageId,
            completion,
            provenance,
          });
        },
      });
    });
    replyOwnsLock = true;
    return { ok: true, response };
  } finally {
    if (!replyOwnsLock) await lock.release();
  }
}
