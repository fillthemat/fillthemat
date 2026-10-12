import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "@/db";
import { type Conversation, conversations } from "@/db/schema";
import { appendPoppyEvent, setPoppyState } from "./conversation-events";

/** Every family mutation locks parent before child, including Turn commits. */
export async function lockPoppyConversationRow(id: string, tx: Transaction) {
  const [found] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  if (!found) return undefined;
  if (found.poppyParentConversationId)
    await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, found.poppyParentConversationId))
      .for("update");
  const [locked] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .for("update");
  return locked;
}

/** Caller holds the family lock; closure and direct events share its transaction. */
export async function closePoppyConversationRow(
  conversation: Conversation,
  reason: "closed" | "inactivity" | "message_limit",
  tx: Transaction,
  endedAt = new Date(),
): Promise<number> {
  const newlyClosed = !conversation.endedAt;
  if (newlyClosed) {
    await tx
      .update(conversations)
      .set({ endedAt, endReason: reason, updatedAt: endedAt })
      .where(eq(conversations.id, conversation.id));
    conversation.endedAt = endedAt;
  }
  await setPoppyState(conversation, "closed", tx);
  if (!newlyClosed) return 0;
  let closed = 1;
  if (conversation.poppyParentConversationId) {
    await appendPoppyEvent(
      {
        id: conversation.poppyParentConversationId,
        schoolId: conversation.schoolId,
      },
      { type: "direct_closed", conversation_id: conversation.id },
      tx,
    );
  } else {
    const children = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.schoolId, conversation.schoolId),
          eq(conversations.poppyParentConversationId, conversation.id),
          isNull(conversations.endedAt),
        ),
      )
      .for("update");
    for (const child of children)
      closed += await closePoppyConversationRow(child, reason, tx, endedAt);
  }
  return closed;
}
