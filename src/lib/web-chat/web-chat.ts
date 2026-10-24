import { PostgrestError } from "@supabase/supabase-js";
import { type UIMessage, validateUIMessages } from "ai";
import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { streamedReply } from "@/lib/ai/assistant";
import { textFromMessage } from "@/lib/chat/messages";
import { getSchoolForLandingAccess, loadSchoolCatalog } from "@/lib/schools/public";
import { createAdminClient } from "@/lib/supabase/admin";
import { startTurnTrace } from "@/lib/tracing/turn-trace";
import {
  appendMessage,
  claimGeneration,
  endConversationAtMessageLimit,
  findConversation,
  findOrCreateConversation,
  loadTranscript,
} from "./conversation-store";

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
        | "message_limit";
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
    resumeToken,
  });
  return {
    ok: true,
    messages: conversation ? await loadTranscript(school.id, conversation.id) : [],
  };
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
    resumeToken,
    now,
  });
  if (!resolved.ok) return resolved;
  const { conversation } = resolved;
  const lock = await claimGeneration(school.id, conversation.id, now);
  if (!lock) return { ok: false, reason: "generation_in_progress" };

  let replyOwnsLock = false;
  try {
    const history = await loadTranscript(school.id, conversation.id);
    if (history.some(({ id }) => id === message.id)) {
      return { ok: false, reason: "duplicate" };
    }
    if (await endConversationAtMessageLimit(school.id, conversation.id, lock.generation, now)) {
      return { ok: false, reason: "message_limit" };
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
        schoolId: school.id,
        generation: lock.generation,
        id: inboundMessageId,
        conversationId: conversation.id,
        messageId: message.id,
        role: "user",
        parts: message.parts,
      });

      // Owner instructions are private server configuration, not landing RPC data.
      const { data: settings, error } = await createAdminClient()
        .from("school_settings")
        .select("agent_instructions")
        .eq("school_id", school.id)
        .single();
      if (error) throw new PostgrestError(error);
      return streamedReply({
        school: { ...school, agentInstructions: settings.agent_instructions },
        catalog,
        messages: uiMessages,
        now,
        onFinish: async ({ reply, completion, provenance }) => {
          const replyMessageId = randomUUID();
          await turn.run(async () => {
            try {
              await appendMessage({
                schoolId: school.id,
                generation: lock.generation,
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
