import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, type Transaction } from "@/db";
import { type Conversation, conversations } from "@/db/schema";
import { loadTranscript } from "@/lib/conversations/conversation-store";
import { PoppyError } from "./errors";

export async function assertNoDirectChild(
  conversation: Conversation,
  tx: Transaction,
) {
  const [child] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, conversation.schoolId),
        eq(conversations.poppyParentConversationId, conversation.id),
        isNull(conversations.endedAt),
      ),
    )
    .limit(1);
  if (child)
    throw new PoppyError("direct_conversation_open", 409, undefined, {
      conversation_id: child.id,
    });
}

/** Retained child history remains available after returning to the parent. */
export async function loadPoppyTranscript(conversation: Conversation) {
  const parentId = conversation.poppyParentConversationId ?? conversation.id;
  const family = await getDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, conversation.schoolId),
        or(
          eq(conversations.id, parentId),
          eq(conversations.poppyParentConversationId, parentId),
        ),
      ),
    );
  return loadTranscript(family.map(({ id }) => id));
}
