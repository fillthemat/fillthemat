import { and, asc, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  contacts,
  conversations,
  messages,
  schools,
  whatsappBookingIntents,
} from "@/db/schema";

export const conversationFiltersSchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    contact: z.string().trim().max(200).optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    message: "The start date must be on or before the end date.",
    path: ["from"],
  });

export type ConversationFilters = z.infer<typeof conversationFiltersSchema>;

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
export async function loadConversations(
  schoolId: string,
  input: ConversationFilters = {},
) {
  const filters = conversationFiltersSchema.parse(input);
  const search = filters.contact
    ? `%${filters.contact.replace(/[\\%_]/g, "\\$&")}%`
    : undefined;
  return getDb()
    .select(conversationSummary)
    .from(conversations)
    .innerJoin(schools, eq(schools.id, conversations.schoolId))
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
        filters.from
          ? gte(
              conversations.createdAt,
              sql`${filters.from}::date::timestamp at time zone ${schools.timezone}`,
            )
          : undefined,
        filters.to
          ? lt(
              conversations.createdAt,
              sql`(${filters.to}::date + 1)::timestamp at time zone ${schools.timezone}`,
            )
          : undefined,
        search
          ? or(
              ilike(contacts.name, search),
              ilike(contacts.email, search),
              ilike(contacts.phone, search),
            )
          : undefined,
      ),
    )
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
    bookingIntents:
      conversation.channel === "whatsapp"
        ? await db
            .select({
              id: whatsappBookingIntents.id,
              createdAt: whatsappBookingIntents.createdAt,
            })
            .from(whatsappBookingIntents)
            .where(
              and(
                eq(whatsappBookingIntents.schoolId, schoolId),
                eq(whatsappBookingIntents.conversationId, conversationId),
              ),
            )
            .orderBy(
              asc(whatsappBookingIntents.createdAt),
              asc(whatsappBookingIntents.id),
            )
        : rows.flatMap((message) =>
            message.role === "assistant" && Array.isArray(message.parts)
              ? message.parts.flatMap((part, index) =>
                  part?.type === "tool-prepare_booking" &&
                  part.state === "output-available" &&
                  part.output?.ok === true
                    ? [
                        {
                          id: `web-${message.id}-${index}`,
                          createdAt: message.createdAt,
                        },
                      ]
                    : [],
                )
              : [],
          ),
    messages: rows.map(({ parts, ...message }) => ({
      ...message,
      text: messageText(parts),
    })),
  };
}
