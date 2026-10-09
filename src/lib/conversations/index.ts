import { type UIMessage, validateUIMessages } from "ai";
import { addDays } from "date-fns";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { type Database, getDb } from "@/db";
import { type Conversation, conversations, messages } from "@/db/schema";
import { hashToken, hashWaId, randomToken } from "@/lib/crypto";
import { TRANSCRIPT_RETENTION_DAYS } from "@/lib/schedule/constants";

export type ConversationIdentity =
  | { channel: "web"; resumeToken: string }
  | { channel: "whatsapp"; waId: string };

type ConversationInput = {
  schoolId: string;
  identity: ConversationIdentity;
  now?: Date;
};

// Book Trial uses these operations inside its existing booking transaction.
type ConversationDb = Pick<Database, "select" | "insert" | "update">;

function identityPredicate(identity: ConversationIdentity) {
  return identity.channel === "web"
    ? eq(conversations.resumeTokenHash, hashToken(identity.resumeToken))
    : eq(conversations.waIdHash, hashWaId(identity.waId));
}

/** Lookup only: never creates a conversation or changes its deadline. */
export async function findConversation(
  { schoolId, identity }: ConversationInput,
  db: ConversationDb = getDb(),
): Promise<Conversation | undefined> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.schoolId, schoolId), identityPredicate(identity)),
    )
    .limit(1);
  return conversation;
}

export type FindOrCreateConversationResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; reason: "invalid_conversation" };

/** The unique identity indexes settle concurrent first-message inserts. */
export async function findOrCreateConversation(
  { schoolId, identity, now = new Date() }: ConversationInput,
  db: ConversationDb = getDb(),
): Promise<FindOrCreateConversationResult> {
  let conversation = await findConversation({ schoolId, identity }, db);
  const expiresAt = addDays(now, TRANSCRIPT_RETENTION_DAYS);
  if (!conversation) {
    const [inserted] = await db
      .insert(conversations)
      .values({
        schoolId,
        resumeTokenHash: hashToken(
          identity.channel === "web" ? identity.resumeToken : randomToken(),
        ),
        waIdHash:
          identity.channel === "whatsapp" ? hashWaId(identity.waId) : null,
        expiresAt,
      })
      .onConflictDoNothing(
        identity.channel === "web"
          ? { target: conversations.resumeTokenHash }
          : {
              target: [conversations.schoolId, conversations.waIdHash],
              where: sql`${conversations.waIdHash} IS NOT NULL`,
            },
      )
      .returning();
    conversation =
      inserted ?? (await findConversation({ schoolId, identity }, db));
  }
  if (!conversation) {
    if (identity.channel === "web") {
      return { ok: false, reason: "invalid_conversation" };
    }
    throw new Error("conversation_resolution_failed");
  }

  // Preserve WhatsApp's existing sliding deadline during this prefactor.
  if (identity.channel === "whatsapp") {
    const [updated] = await db
      .update(conversations)
      .set({ expiresAt, updatedAt: now })
      .where(eq(conversations.id, conversation.id))
      .returning();
    if (!updated) throw new Error("conversation_missing");
    conversation = updated;
  }
  return { ok: true, conversation };
}

export type GenerationLock = { release: () => Promise<void> };

// Longer than a live function can run, so only abandoned turns are recovered.
const GENERATION_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

/** Fail fast by default; WhatsApp can wait. Claims older than ten minutes recover. */
export async function claimGeneration(
  conversationId: string,
  { wait = false, now = new Date() }: { wait?: boolean; now?: Date } = {},
): Promise<GenerationLock | undefined> {
  const db = getDb();
  const attempts = wait ? 120 : 1;
  const abandonedBefore = new Date(now.getTime() - GENERATION_LOCK_TIMEOUT_MS);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const [claimed] = await db
      .update(conversations)
      .set({ generatingAt: now, updatedAt: now })
      .where(
        and(
          eq(conversations.id, conversationId),
          or(
            isNull(conversations.generatingAt),
            lt(conversations.generatingAt, abandonedBefore),
          ),
        ),
      )
      .returning({ id: conversations.id });
    if (claimed) {
      let released: Promise<void> | undefined;
      return {
        release() {
          released ??= db
            .update(conversations)
            .set({ generatingAt: null, updatedAt: new Date() })
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.generatingAt, now),
              ),
            )
            .then(() => {});
          return released;
        },
      };
    }
    if (wait) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

/** Stored UI messages, oldest first, validated before entering model context. */
export async function loadTranscript(
  conversationId: string,
): Promise<UIMessage[]> {
  const rows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  if (rows.length === 0) return [];
  return validateUIMessages({
    messages: rows.map((row) => ({
      id: row.messageId,
      role: row.role as UIMessage["role"],
      parts: row.parts as UIMessage["parts"],
    })),
  });
}

export async function hasConversationMessage(
  conversationId: string,
  messageId: string,
): Promise<boolean> {
  const [row] = await getDb()
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

/** Returns the saved row id, or undefined for an already-saved message. */
export async function appendMessage({
  id,
  conversationId,
  messageId,
  role,
  parts,
  completion = "complete",
  purgeAt = addDays(new Date(), TRANSCRIPT_RETENTION_DAYS),
}: {
  id?: string;
  conversationId: string;
  messageId: string;
  role: UIMessage["role"];
  parts: UIMessage["parts"];
  completion?: typeof messages.$inferInsert.completion;
  purgeAt?: Date;
}): Promise<string | undefined> {
  const [row] = await getDb()
    .insert(messages)
    .values({ id, conversationId, messageId, role, parts, completion, purgeAt })
    .onConflictDoNothing({
      target: [messages.conversationId, messages.messageId],
    })
    .returning({ id: messages.id });
  return row?.id;
}

/** Tenant-check and attach the first contact within the booking transaction. */
export async function attachConversationContact(
  {
    schoolId,
    conversationId,
    contactId,
  }: { schoolId: string; conversationId: string; contactId: string },
  db: ConversationDb = getDb(),
): Promise<string | undefined> {
  const [conversation] = await db
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, schoolId),
        eq(conversations.id, conversationId),
      ),
    )
    .limit(1);
  if (conversation && !conversation.contactId) {
    await db
      .update(conversations)
      .set({ contactId, updatedAt: new Date() })
      .where(
        and(
          eq(conversations.id, conversation.id),
          isNull(conversations.contactId),
        ),
      );
  }
  return conversation?.id;
}
