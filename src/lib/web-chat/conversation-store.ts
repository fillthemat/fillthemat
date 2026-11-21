import "server-only";
import type { UIMessage } from "ai";
import { PostgrestError } from "@supabase/supabase-js";
import type { Json } from "@/db/types";
import { hashToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type Identity = { schoolId: string; resumeToken: string; now?: Date };

/** Token-scoped lookup only. The caller first checks public/owner preview access. */
export async function findConversation({ schoolId, resumeToken, now = new Date() }: Identity) {
  const { data, error } = await createAdminClient()
    .from("conversations")
    .select("id")
    .eq("school_id", schoolId)
    .eq("resume_token_hash", hashToken(resumeToken))
    .is("ended_at", null)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (error) throw new PostgrestError(error);
  return data;
}

export async function findOrCreateConversation({
  schoolId,
  resumeToken,
  now = new Date(),
}: Identity) {
  const { data, error } = await createAdminClient().rpc("resolve_web_conversation", {
    p_school_id: schoolId,
    p_token_hash: hashToken(resumeToken),
    p_now: now.toISOString(),
  });
  if (error) throw new PostgrestError(error);
  return { id: data };
}

export async function claimGeneration(schoolId: string, conversationId: string, now = new Date()) {
  const client = createAdminClient();
  const generation = now.toISOString();
  const abandonedBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("conversations")
    .update({ generating_at: generation })
    .eq("id", conversationId)
    .eq("school_id", schoolId)
    .is("ended_at", null)
    .or(`generating_at.is.null,generating_at.lt.${abandonedBefore}`)
    .select("id")
    .maybeSingle();
  if (error) throw new PostgrestError(error);
  if (!data) return undefined;
  let released: Promise<void> | undefined;
  return {
    generation,
    release() {
      released ??= (async () => {
        const { error } = await client
          .from("conversations")
          .update({ generating_at: null })
          .eq("id", conversationId)
          .eq("school_id", schoolId)
          .eq("generating_at", generation);
        if (error) throw new PostgrestError(error);
      })();
      return released;
    },
  };
}

export async function endConversationAtMessageLimit(
  schoolId: string,
  conversationId: string,
  generation: string,
  now: Date,
) {
  const { data, error } = await createAdminClient().rpc("end_web_conversation_at_limit", {
    p_school_id: schoolId,
    p_conversation_id: conversationId,
    p_generation: generation,
    p_now: now.toISOString(),
  });
  if (error) throw new PostgrestError(error);
  return data;
}

export async function loadTranscript(
  schoolId: string,
  conversationId: string,
): Promise<UIMessage[]> {
  const client = createAdminClient();
  const messages: UIMessage[] = [];
  // PostgREST caps result sets. Read every page, preserving stable ordering.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("messages")
      .select("message_id, role, parts, conversations!inner(school_id)")
      .eq("conversation_id", conversationId)
      .eq("conversations.school_id", schoolId)
      .order("created_at")
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new PostgrestError(error);
    messages.push(
      ...data.map((row) => ({
        id: row.message_id,
        role: row.role as UIMessage["role"],
        parts: row.parts as UIMessage["parts"],
      })),
    );
    if (data.length < 500) return messages;
  }
}

export async function appendMessage(input: {
  id: string;
  schoolId: string;
  conversationId: string;
  generation: string;
  messageId: string;
  role: "user" | "assistant";
  parts: UIMessage["parts"];
  completion?: "complete" | "aborted" | "error";
}) {
  const { data, error } = await createAdminClient().rpc("append_web_message", {
    p_school_id: input.schoolId,
    p_conversation_id: input.conversationId,
    p_generation: input.generation,
    p_id: input.id,
    p_message_id: input.messageId,
    p_role: input.role,
    p_parts: input.parts as Json,
    p_completion: input.completion ?? "complete",
    p_now: new Date().toISOString(),
  });
  if (error) throw new PostgrestError(error);
  return data;
}
