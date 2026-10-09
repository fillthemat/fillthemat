import type { UIMessage } from "ai";
import { addDays } from "date-fns";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages, schools } from "@/db/schema";
import { hashToken, hashWaId, randomToken } from "@/lib/crypto";
import { TRANSCRIPT_RETENTION_DAYS } from "@/lib/schedule/constants";
import type { InboundWhatsAppMessage } from "./parse";

export type ResolveInboundResult =
  | {
      resolved: true;
      schoolId: string;
      conversationId: string;
      purgeAt: Date;
    }
  | { resolved: false; reason: "unknown_phone_number" | "empty_text" };

/**
 * Resolve the school from `metadata.phone_number_id` and find/create the
 * WhatsApp conversation keyed `(school_id, wa_id_hash)`. Dedupe is at the job
 * layer (`whatsapp_jobs.dedupe_key` = wamid); this only resolves identity and
 * slides the conversation expiry forward while the thread is active.
 */
export async function resolveInboundConversation(
  input: InboundWhatsAppMessage,
  now = new Date(),
): Promise<ResolveInboundResult> {
  if (!input.text) return { resolved: false, reason: "empty_text" };

  const db = getDb();
  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.whatsappPhoneNumberId, input.phoneNumberId))
    .limit(1);
  if (!school) return { resolved: false, reason: "unknown_phone_number" };

  const waIdHash = hashWaId(input.waId);
  const purgeAt = addDays(now, TRANSCRIPT_RETENTION_DAYS);

  let [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, school.id),
        eq(conversations.waIdHash, waIdHash),
      ),
    )
    .limit(1);

  if (!conversation) {
    const [inserted] = await db
      .insert(conversations)
      .values({
        schoolId: school.id,
        // Web conversations keep `resume_token_hash` as their identity; this
        // random value satisfies the column but is never used for lookups.
        resumeTokenHash: hashToken(randomToken()),
        waIdHash,
        expiresAt: purgeAt,
      })
      .onConflictDoNothing({
        target: [conversations.schoolId, conversations.waIdHash],
        where: sql`${conversations.waIdHash} IS NOT NULL`,
      })
      .returning();
    conversation = inserted;
    if (!conversation) {
      const [again] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.schoolId, school.id),
            eq(conversations.waIdHash, waIdHash),
          ),
        )
        .limit(1);
      conversation = again;
    }
  }
  if (!conversation) throw new Error("whatsapp_conversation_resolution_failed");

  await db
    .update(conversations)
    .set({ expiresAt: purgeAt, updatedAt: now })
    .where(eq(conversations.id, conversation.id));

  return {
    resolved: true,
    schoolId: school.id,
    conversationId: conversation.id,
    purgeAt,
  };
}

export async function messageExists(
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.messageId, messageId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function persistUserMessage({
  id,
  conversationId,
  wamid,
  text,
  purgeAt,
}: {
  /** The saved row's id, chosen before saving. */
  id: string;
  conversationId: string;
  /** WhatsApp's id for the message, saved as its message id. */
  wamid: string;
  text: string;
  purgeAt: Date;
}): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .insert(messages)
    .values({
      id,
      conversationId,
      messageId: wamid,
      role: "user",
      parts: [{ type: "text", text }],
      completion: "complete",
      purgeAt,
    })
    .onConflictDoNothing({
      target: [messages.conversationId, messages.messageId],
    })
    .returning({ id: messages.id });
  return Boolean(row);
}

/** Returns the saved row's id, or undefined if the message was already saved. */
export async function persistAssistantMessage({
  conversationId,
  messageId,
  parts,
  purgeAt,
}: {
  conversationId: string;
  messageId: string;
  parts: UIMessage["parts"];
  purgeAt: Date;
}): Promise<string | undefined> {
  const db = getDb();
  const [row] = await db
    .insert(messages)
    .values({
      conversationId,
      messageId,
      role: "assistant",
      parts,
      completion: "complete",
      purgeAt,
    })
    .onConflictDoNothing({
      target: [messages.conversationId, messages.messageId],
    })
    .returning({ id: messages.id });
  return row?.id;
}

export async function claimGenerating(
  conversationId: string,
  now: Date,
): Promise<boolean> {
  const db = getDb();
  for (let attempt = 0; attempt < 120; attempt++) {
    const [claimed] = await db
      .update(conversations)
      .set({ generatingAt: now, updatedAt: now })
      .where(
        and(
          eq(conversations.id, conversationId),
          isNull(conversations.generatingAt),
        ),
      )
      .returning({ id: conversations.id });
    if (claimed) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

export async function releaseGenerating(conversationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(conversations)
    .set({ generatingAt: null, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}
