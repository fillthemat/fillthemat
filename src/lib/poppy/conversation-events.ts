import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { type Database, getDb, type Transaction } from "@/db";
import {
  type Conversation,
  conversations,
  poppyConversationEvents,
} from "@/db/schema";
import { PoppyError } from "./errors";

export type PoppyConversationStatus = "working" | "idle" | "queued" | "closed";
export type PoppyEvent = Record<string, unknown> & { type: string };

/** Appends are serialized by the Conversation row, never by a sortable public id. */
export async function appendPoppyEvent(
  conversation: Pick<Conversation, "id" | "schoolId">,
  event: PoppyEvent,
  tx: Pick<Database, "insert" | "update">,
) {
  const [row] = await tx
    .update(conversations)
    .set({
      poppyEventSequence: sql`${conversations.poppyEventSequence} + 1`,
    })
    .where(eq(conversations.id, conversation.id))
    .returning({ sequence: conversations.poppyEventSequence });
  if (!row) throw new Error("conversation_missing");
  const id = `evt_${randomUUID()}`;
  const createdAt = new Date();
  await tx.insert(poppyConversationEvents).values({
    id,
    schoolId: conversation.schoolId,
    conversationId: conversation.id,
    sequence: row.sequence,
    createdAt,
    event: { ...event, id, created_at: createdAt.toISOString() },
  });
  return { id, sequence: row.sequence };
}

export function conversationState(conversation: Conversation) {
  return {
    conversation_id: conversation.id,
    status: conversation.endedAt ? "closed" : conversation.poppyStatus,
    responder: "agent" as const,
  };
}

/** Caller holds the row lock; every state transition records both wire fields. */
export async function setPoppyState(
  conversation: Conversation,
  status: PoppyConversationStatus,
  tx: Transaction,
) {
  if (conversation.poppyStatus === status) return;
  await tx
    .update(conversations)
    .set({ poppyStatus: status })
    .where(eq(conversations.id, conversation.id));
  await appendPoppyEvent(
    conversation,
    { type: "state", status, responder: "agent" },
    tx,
  );
  conversation.poppyStatus = status;
}

export async function readPoppyEvents(
  conversation: Conversation,
  cursor: string | null,
  db: Pick<Database, "select"> = getDb(),
) {
  let sequence = 0;
  if (cursor) {
    const [event] = await db
      .select({ sequence: poppyConversationEvents.sequence })
      .from(poppyConversationEvents)
      .where(
        and(
          eq(poppyConversationEvents.conversationId, conversation.id),
          eq(poppyConversationEvents.id, cursor),
        ),
      )
      .limit(1);
    if (!event) throw new PoppyError("invalid_cursor");
    sequence = event.sequence;
  }
  const rows = await db
    .select()
    .from(poppyConversationEvents)
    .where(
      and(
        eq(poppyConversationEvents.conversationId, conversation.id),
        gt(poppyConversationEvents.sequence, sequence),
      ),
    )
    .orderBy(asc(poppyConversationEvents.sequence))
    .limit(101);
  const page = rows.slice(0, 100);
  return {
    ...conversationState(conversation),
    events: page.map((row) => row.event),
    cursor: page.at(-1)?.id ?? cursor,
    has_more: rows.length > 100,
  };
}
