import "server-only";
import { hashToken, hashWaId, randomToken } from "@/lib/crypto";
import { sleep as defaultSleep } from "@/lib/sleep";
import { createAdminClient } from "@/lib/supabase/admin";
import * as shared from "@/lib/web-chat/conversation-store";

type ConversationInput = {
  schoolId: string;
  identity: { channel: "whatsapp"; waId: string };
  now?: Date;
};

export async function findConversation({
  schoolId,
  identity,
  now = new Date(),
}: ConversationInput) {
  const { data } = await createAdminClient()
    .from("conversations")
    .select("id")
    .eq("school_id", schoolId)
    .eq("wa_id_hash", hashWaId(identity.waId))
    .is("ended_at", null)
    .gt("expires_at", now.toISOString())
    .maybeSingle()
    .throwOnError();
  return data ?? undefined;
}

export async function findOrCreateConversation({
  schoolId,
  identity,
  now = new Date(),
}: ConversationInput) {
  const { data } = await createAdminClient()
    .rpc("resolve_whatsapp_conversation", {
      p_school_id: schoolId,
      p_wa_id_hash: hashWaId(identity.waId),
      p_token_hash: hashToken(randomToken()),
      p_now: now.toISOString(),
    })
    .throwOnError();
  if (!data) throw new Error("conversation_missing");
  return { ok: true as const, conversation: { id: data } };
}

/** Waiting is channel policy; the claim and release fence are shared with web chat. */
export async function claimGeneration(
  schoolId: string,
  conversationId: string,
  {
    wait = false,
    now = new Date(),
    sleep = defaultSleep,
  }: { wait?: boolean; now?: Date; sleep?: (milliseconds: number) => Promise<void> } = {},
) {
  for (let attempt = 0; attempt < (wait ? 120 : 1); attempt++) {
    const lock = await shared.claimGeneration(schoolId, conversationId, now);
    if (lock) return lock;
    if (wait) await sleep(25);
  }
  return undefined;
}

export const appendMessage = shared.appendMessage;
export const loadTranscript = shared.loadTranscript;
export const endConversationAtMessageLimit = shared.endConversationAtMessageLimit;

export async function hasWhatsAppMessage({
  schoolId,
  waId,
  messageId,
}: {
  schoolId: string;
  waId: string;
  messageId: string;
}) {
  const { data } = await createAdminClient()
    .from("messages")
    .select("id, conversations!inner(school_id, wa_id_hash)")
    .eq("conversations.school_id", schoolId)
    .eq("conversations.wa_id_hash", hashWaId(waId))
    .eq("message_id", messageId)
    .limit(1)
    .throwOnError();
  return Boolean(data?.length);
}

export async function endInactiveConversations(now = new Date()) {
  const { data } = await createAdminClient()
    .rpc("end_inactive_conversations", {
      p_now: now.toISOString(),
    })
    .throwOnError();
  return data ?? 0;
}
