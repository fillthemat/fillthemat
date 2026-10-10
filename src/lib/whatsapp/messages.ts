import { type UIMessage, validateUIMessages } from "ai";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";

/**
 * Load a conversation's stored messages as `UIMessage[]` and re-validate them
 * server-side before they re-enter the model context.
 *
 * This mirrors the POST `/api/chat` load path (`chat/route.ts`): rows are
 * ordered oldest-first, their persisted parts are cast back to UIMessage
 * parts, and `validateUIMessages` guards against rows written by an older
 * schema.
 */
export async function loadValidatedConversationMessages(
  conversationId: string,
): Promise<UIMessage[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  if (rows.length === 0) return [];

  const history = rows.map((row) => ({
    id: row.messageId,
    role: row.role as UIMessage["role"],
    parts: row.parts as UIMessage["parts"],
  }));

  return validateUIMessages({ messages: history });
}
