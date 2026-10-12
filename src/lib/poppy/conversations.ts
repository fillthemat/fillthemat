import { createHash, randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Transaction } from "@/db";
import {
  type Conversation,
  conversations,
  messages,
  poppyConversationEvents,
  poppyConversationMessages,
} from "@/db/schema";
import { GENERATION_LOCK_TIMEOUT_MS } from "@/lib/conversations/conversation-store";
import { hashToken, randomToken } from "@/lib/crypto";
import { CONVERSATION_INACTIVITY_DAYS } from "@/lib/schedule/constants";
import { MAX_CHAT_MESSAGES_PER_CONVERSATION } from "@/lib/security/limits";
import { consumeConversationBudget } from "./budgets";
import { assertNoDirectChild } from "./conversation-direct";
import {
  appendPoppyEvent,
  conversationState,
  readPoppyEvents,
  setPoppyState,
} from "./conversation-events";
import {
  closePoppyConversationRow,
  lockPoppyConversationRow,
} from "./conversation-lifecycle";
import type { PoppyMessage } from "./conversation-requests";
import { PoppyError } from "./errors";
import type { PoppyPrincipal } from "./protected-request";

export { closePoppyConversationRow } from "./conversation-lifecycle";

function owner(principal: PoppyPrincipal) {
  return and(
    eq(conversations.schoolId, principal.schoolId),
    eq(conversations.poppyClientId, principal.clientId),
    eq(conversations.poppyUserId, principal.userId),
  );
}

/** Ownership includes ended Conversations and deliberately excludes Session identity. */
export async function ownedPoppyConversation(
  principal: PoppyPrincipal,
  id: string,
  tx: Transaction,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new PoppyError("conversation_not_found", 404);
  const [found] = await tx
    .select()
    .from(conversations)
    .where(and(owner(principal), eq(conversations.id, id)));
  if (!found) throw new PoppyError("conversation_not_found", 404);
  if (found.poppyParentConversationId)
    await ownedPoppyConversation(
      principal,
      found.poppyParentConversationId,
      tx,
    );
  const conversation = await lockPoppyConversationRow(id, tx);
  if (!conversation) throw new PoppyError("conversation_not_found", 404);
  if (
    !conversation.endedAt &&
    conversation.expiresAt <= new Date() &&
    (!conversation.generatingAt ||
      conversation.generatingAt.getTime() <
        Date.now() - GENERATION_LOCK_TIMEOUT_MS)
  )
    await closePoppyConversationRow(conversation, "inactivity", tx);
  // Maintenance may have ended the shared Conversation before this request.
  if (conversation.endedAt && conversation.poppyStatus !== "closed")
    await setPoppyState(conversation, "closed", tx);
  return conversation;
}

export async function getPoppyConversation(
  principal: PoppyPrincipal,
  id: string,
) {
  return getDb().transaction((tx) => ownedPoppyConversation(principal, id, tx));
}

/** State and its event page share one locked snapshot, so a concurrent reply
 * cannot return an idle event alongside a stale working response. */
export async function getPoppyConversationEvents(
  principal: PoppyPrincipal,
  id: string,
  cursor: string | null,
) {
  return getDb().transaction(async (tx) => {
    const conversation = await ownedPoppyConversation(principal, id, tx);
    return readPoppyEvents(conversation, cursor, tx);
  });
}

export async function closePoppyConversation(
  principal: PoppyPrincipal,
  id: string,
) {
  return getDb().transaction(async (tx) => {
    const conversation = await ownedPoppyConversation(principal, id, tx);
    await closePoppyConversationRow(conversation, "closed", tx);
    return conversationState(conversation);
  });
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
      );
    return item;
  });
}

/** The receipt and inbound event are committed before model work. A hash bounds
 * the database key without truncating the client/User/message identity tuple. */
export async function acceptPoppyMessage(
  principal: PoppyPrincipal,
  message: PoppyMessage,
  conversationId?: string,
  cursor: string | null = null,
  parentConversationId?: string,
) {
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        principal.schoolId,
        principal.clientId,
        principal.userId,
        message.id,
      ]),
    )
    .digest("hex");
  return getDb().transaction(async (tx) => {
    // Principal-wide first-message retries must serialize even before an id exists.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
    let conversation = conversationId
      ? await ownedPoppyConversation(principal, conversationId, tx)
      : undefined;
    const [receipt] = await tx
      .select()
      .from(poppyConversationMessages)
      .where(eq(poppyConversationMessages.key, key));
    if (receipt) {
      if (canonical(receipt.message) !== canonical(message))
        throw new PoppyError("message_id_conflict", 409);
      if (!conversationId) {
        const [original] = await tx
          .select({ parentId: conversations.poppyParentConversationId })
          .from(conversations)
          .where(eq(conversations.id, receipt.conversationId));
        if ((original?.parentId ?? null) !== (parentConversationId ?? null))
          throw new PoppyError("message_id_conflict", 409);
      }
      await validateCursor(receipt.conversationId, cursor, tx);
      return {
        conversationId: receipt.conversationId,
        messageKey: key,
        response: receipt.response,
        retry: true,
      };
    }
    if (conversation?.endedAt) return { error: "conversation_closed" as const };
    if (conversation) await assertNoDirectChild(conversation, tx);
    let parent: Conversation | undefined;
    if (parentConversationId) {
      parent = await ownedPoppyConversation(
        principal,
        parentConversationId,
        tx,
      );
      if (parent.poppyParentConversationId)
        throw new PoppyError("conversation_not_found", 404);
      if (parent.endedAt) return { error: "conversation_closed" as const };
      await assertNoDirectChild(parent, tx);
    }
    if (cursor) {
      if (!conversation) throw new PoppyError("invalid_cursor");
      await validateCursor(conversation.id, cursor, tx);
    }
    const now = new Date();
    if (!conversation) {
      await consumeConversationBudget(principal, tx, now);
      const [created] = await tx
        .insert(conversations)
        .values({
          id: randomUUID(),
          schoolId: principal.schoolId,
          resumeTokenHash: hashToken(randomToken()),
          poppyClientId: principal.clientId,
          poppyUserId: principal.userId,
          poppyParentConversationId: parent?.id,
          poppyContext: parent?.poppyContext,
          expiresAt: addDays(now, CONVERSATION_INACTIVITY_DAYS),
        })
        .returning();
      if (!created) throw new Error("conversation_missing");
      conversation = created;
      if (parent)
        await appendPoppyEvent(
          parent,
          { type: "direct_opened", conversation_id: created.id },
          tx,
        );
    }
    const [saved] = await tx
      .select({ count: count() })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));
    const [pending] = await tx
      .select({ count: count() })
      .from(poppyConversationMessages)
      .where(
        and(
          eq(poppyConversationMessages.conversationId, conversation.id),
          isNull(poppyConversationMessages.completedAt),
        ),
      );
    if (
      (saved?.count ?? 0) + (pending?.count ?? 0) * 2 >=
      MAX_CHAT_MESSAGES_PER_CONVERSATION
    ) {
      // Do not close in-flight accepted Turns; the final commit closes at the cap.
      if (!pending?.count)
        await closePoppyConversationRow(conversation, "message_limit", tx);
      return { error: "conversation_closed" as const };
    }
    const context = { ...conversation.poppyContext, ...message.context };
    await tx
      .update(conversations)
      .set({
        poppyContext: context,
        expiresAt: addDays(now, CONVERSATION_INACTIVITY_DAYS),
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));
    const inboundEvent = await appendPoppyEvent(
      conversation,
      {
        type: "message",
        message: {
          id: message.id,
          role: "user",
          sender: message.sender,
          ...(message.text !== undefined ? { text: message.text } : {}),
          ...(message.data !== undefined ? { data: message.data } : {}),
        },
      },
      tx,
    );
    await tx.insert(poppyConversationMessages).values({
      key,
      schoolId: principal.schoolId,
      conversationId: conversation.id,
      sessionId: principal.sessionId,
      message,
      context,
      sequence: inboundEvent.sequence,
    });
    await setPoppyState(conversation, "working", tx);
    return {
      conversationId: conversation.id,
      messageKey: key,
      response: null,
      retry: false,
    };
  });
}

/** First successful wire result wins, including concurrent retries. Retained
 * independently of the Conversation's later events and terminal state. */
export async function savePoppyMessageResponse(
  key: string,
  response: Record<string, unknown>,
) {
  return getDb().transaction(async (tx) => {
    const [receipt] = await tx
      .update(poppyConversationMessages)
      .set({ response })
      .where(
        and(
          eq(poppyConversationMessages.key, key),
          isNull(poppyConversationMessages.response),
        ),
      )
      .returning({ response: poppyConversationMessages.response });
    if (receipt?.response) return receipt.response;
    const [original] = await tx
      .select({ response: poppyConversationMessages.response })
      .from(poppyConversationMessages)
      .where(eq(poppyConversationMessages.key, key));
    if (!original?.response) throw new Error("message_receipt_missing");
    return original.response;
  });
}

async function validateCursor(
  conversationId: string,
  cursor: string | null,
  tx: Transaction,
) {
  if (!cursor) return;
  const [event] = await tx
    .select({ id: poppyConversationEvents.id })
    .from(poppyConversationEvents)
    .where(
      and(
        eq(poppyConversationEvents.conversationId, conversationId),
        eq(poppyConversationEvents.id, cursor),
      ),
    )
    .limit(1);
  if (!event) throw new PoppyError("invalid_cursor");
}
