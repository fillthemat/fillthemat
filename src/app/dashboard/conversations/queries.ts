import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, conversations, messages } from "@/db/schema";

const conversationSummary = {
  id: conversations.id,
  channel: conversations.channel,
  createdAt: conversations.createdAt,
  contact: {
    name: contacts.name,
    email: contacts.email,
    phone: contacts.phone,
  },
};

/** The caller supplies the signed-in owner's school, never a request's school ID. */
export async function loadConversations(schoolId: string) {
  return getDb()
    .select(conversationSummary)
    .from(conversations)
    .leftJoin(
      contacts,
      and(
        eq(contacts.schoolId, conversations.schoolId),
        eq(contacts.id, conversations.contactId),
      ),
    )
    .where(eq(conversations.schoolId, schoolId))
    .orderBy(desc(conversations.createdAt), desc(conversations.id));
}

/** Historic parts need no current SDK validation; never expose reasoning or tool payloads. */
function messageText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .flatMap((part) =>
      part && part.type === "text" && typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n");
}

export async function loadConversation(
  schoolId: string,
  conversationId: string,
) {
  const db = getDb();
  const [conversation] = await db
    .select(conversationSummary)
    .from(conversations)
    .leftJoin(
      contacts,
      and(
        eq(contacts.schoolId, conversations.schoolId),
        eq(contacts.id, conversations.contactId),
      ),
    )
    .where(
      and(
        eq(conversations.schoolId, schoolId),
        eq(conversations.id, conversationId),
      ),
    )
    .limit(1);
  if (!conversation) return undefined;
  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      parts: messages.parts,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.schoolId, schoolId),
        eq(conversations.id, conversationId),
      ),
    )
    // A WhatsApp turn commits its contact message and reply in one transaction,
    // so defaultNow can give both the same timestamp.
    .orderBy(
      asc(messages.createdAt),
      asc(sql`case when ${messages.role} = 'user' then 0 else 1 end`),
      asc(messages.id),
    );
  return {
    ...conversation,
    messages: rows.map(({ parts, ...message }) => ({
      ...message,
      text: messageText(parts),
    })),
  };
}
