import { type UIMessage, validateUIMessages } from "ai";
import { addDays } from "date-fns";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { type Database, getDb } from "@/db";
import {
  type Conversation,
  conversations,
  messages,
  whatsappBookingIntents,
} from "@/db/schema";
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
  { schoolId, identity, now = new Date() }: ConversationInput,
  db: ConversationDb = getDb(),
): Promise<Conversation | undefined> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, schoolId),
        identityPredicate(identity),
        isNull(conversations.endedAt),
        gt(conversations.expiresAt, now),
      ),
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
  db: Database = getDb(),
): Promise<FindOrCreateConversationResult> {
  const expiresAt = addDays(now, TRANSCRIPT_RETENTION_DAYS);
  return db.transaction(async (tx) => {
    for (;;) {
      // Even an ended token belongs to its original school. It must never be
      // adopted by another school after the active-only index releases it.
      if (identity.channel === "web") {
        const [owner] = await tx
          .select({ schoolId: conversations.schoolId })
          .from(conversations)
          .where(identityPredicate(identity))
          .limit(1);
        if (owner && owner.schoolId !== schoolId) {
          return { ok: false, reason: "invalid_conversation" };
        }
      }
      const [current] = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.schoolId, schoolId),
            identityPredicate(identity),
            isNull(conversations.endedAt),
          ),
        )
        .limit(1);
      if (current && current.expiresAt > now)
        return { ok: true, conversation: current };
      if (current)
        await endMatchingConversations(
          and(
            eq(conversations.id, current.id),
            lte(conversations.expiresAt, now),
          ),
          "inactivity",
          now,
          tx,
        );
      const [inserted] = await tx
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
            ? {
                target: conversations.resumeTokenHash,
                where: sql`${conversations.endedAt} IS NULL`,
              }
            : {
                target: [conversations.schoolId, conversations.waIdHash],
                where: sql`${conversations.waIdHash} IS NOT NULL AND ${conversations.endedAt} IS NULL`,
              },
        )
        .returning();
      if (inserted) return { ok: true, conversation: inserted };
      // A concurrent first message won the partial unique index. Re-read its
      // conversation, including if it was ended again before this statement.
    }
  });
}

export type ConversationEndReason = NonNullable<Conversation["endReason"]>;

async function endMatchingConversations(
  predicate: SQL | undefined,
  reason: ConversationEndReason,
  now: Date,
  db: ConversationDb,
): Promise<number> {
  const ended = await db
    .update(conversations)
    .set({ endedAt: now, endReason: reason, updatedAt: now })
    .where(and(isNull(conversations.endedAt), predicate))
    .returning({ id: conversations.id });
  if (ended.length === 0) return 0;
  await db
    .update(whatsappBookingIntents)
    .set({ state: "expired", updatedAt: now })
    .where(
      and(
        inArray(
          whatsappBookingIntents.conversationId,
          ended.map(({ id }) => id),
        ),
        eq(whatsappBookingIntents.state, "pending"),
      ),
    );
  return ended.length;
}

/** Terminal and idempotent: keep the record and expire its pending booking intent. */
export async function endConversation(
  conversationId: string,
  reason: ConversationEndReason,
  now = new Date(),
): Promise<boolean> {
  return getDb().transaction(
    async (tx) =>
      (await endMatchingConversations(
        eq(conversations.id, conversationId),
        reason,
        now,
        tx,
      )) > 0,
  );
}

export type GenerationLock = { release: () => Promise<void> };

// Longer than a live function can run, so only abandoned turns are recovered.
const GENERATION_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

/** Maintenance never interrupts a live reply, but an abandoned lock cannot retain an inactive conversation. */
export async function endInactiveConversations(
  now = new Date(),
): Promise<number> {
  return getDb().transaction((tx) =>
    endMatchingConversations(
      and(
        lte(conversations.expiresAt, now),
        or(
          isNull(conversations.generatingAt),
          lt(
            conversations.generatingAt,
            new Date(now.getTime() - GENERATION_LOCK_TIMEOUT_MS),
          ),
        ),
      ),
      "inactivity",
      now,
      tx,
    ),
  );
}

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
          isNull(conversations.endedAt),
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
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        id,
        conversationId,
        messageId,
        role,
        parts,
        completion,
        purgeAt,
      })
      .onConflictDoNothing({
        target: [messages.conversationId, messages.messageId],
      })
      .returning({ id: messages.id });
    if (row && role === "user") {
      const now = new Date();
      await tx
        .update(conversations)
        .set({
          expiresAt: addDays(now, TRANSCRIPT_RETENTION_DAYS),
          updatedAt: now,
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            isNull(conversations.endedAt),
          ),
        );
    }
    return row?.id;
  });
}

/** Tenant-check and attach the first contact within the booking transaction. */
export async function attachConversationContact(
  {
    schoolId,
    conversationId,
    contactId,
    now = new Date(),
  }: {
    schoolId: string;
    conversationId: string;
    contactId: string;
    now?: Date;
  },
  db: ConversationDb = getDb(),
): Promise<string | undefined> {
  const [conversation] = await db
    .update(conversations)
    .set({
      contactId: sql`coalesce(${conversations.contactId}, ${contactId}::uuid)`,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversations.schoolId, schoolId),
        eq(conversations.id, conversationId),
        isNull(conversations.endedAt),
        gt(conversations.expiresAt, now),
      ),
    )
    .returning({ id: conversations.id });
  return conversation?.id;
}
