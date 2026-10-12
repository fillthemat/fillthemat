import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bookings,
  emailDeliveries,
  messages,
  whatsappDeliveries,
} from "@/db/schema";

export const MAX_BOOKINGS_PER_EMAIL_PER_DAY = 6;
export const MAX_OUTBOUND_RECIPIENTS_PER_DAY = 12;
export const MAX_CHAT_MESSAGES_PER_CONVERSATION = 30;
export const MAX_USER_MESSAGE_CHARS = 2000;
export const MAX_REQUEST_BYTES = 32_768;
export const MAX_AGENT_STEPS = 8;
export const MAX_POPPY_NEW_CLIENTS_PER_DAY = 25;
export const MAX_POPPY_SESSIONS_PER_CLIENT_PER_HOUR = 60;

// WhatsApp abuse controls (Phase 5). These mirror the email patterns above but
// key on the Meta-verified `wa_id` and are intentionally DISTINCT budgets from
// `MAX_OUTBOUND_RECIPIENTS_PER_DAY`, which counts `email_deliveries` only.
export const MAX_BOOKINGS_PER_WA_ID_PER_DAY = 6;
export const MAX_WHATSAPP_OUTBOUND_PER_WA_ID_PER_DAY = 12;

export async function emailBookingQuotaExceeded(
  schoolId: string,
  email: string,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.schoolId, schoolId),
        eq(bookings.contactEmailSnapshot, email),
        gte(bookings.createdAt, since),
      ),
    );
  return (row?.count ?? 0) >= MAX_BOOKINGS_PER_EMAIL_PER_DAY;
}

export async function recipientQuotaExceeded(
  schoolId: string,
  recipient: string,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailDeliveries)
    .where(
      and(
        eq(emailDeliveries.schoolId, schoolId),
        eq(emailDeliveries.recipient, recipient),
        gte(emailDeliveries.createdAt, since),
      ),
    );
  return (row?.count ?? 0) >= MAX_OUTBOUND_RECIPIENTS_PER_DAY;
}

export async function conversationMessageCount(
  conversationId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  return row?.count ?? 0;
}

export async function whatsappBookingQuotaExceeded(
  schoolId: string,
  waId: string,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        eq(bookings.schoolId, schoolId),
        eq(bookings.contactPhoneSnapshot, waId),
        gte(bookings.createdAt, since),
      ),
    );
  return (row?.count ?? 0) >= MAX_BOOKINGS_PER_WA_ID_PER_DAY;
}

export async function whatsappOutboundQuotaExceeded(
  schoolId: string,
  waId: string,
  now = new Date(),
): Promise<boolean> {
  const db = getDb();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(whatsappDeliveries)
    .where(
      and(
        eq(whatsappDeliveries.schoolId, schoolId),
        eq(whatsappDeliveries.recipientWaId, waId),
        gte(whatsappDeliveries.createdAt, since),
      ),
    );
  return (row?.count ?? 0) >= MAX_WHATSAPP_OUTBOUND_PER_WA_ID_PER_DAY;
}

export function requestBodyTooLarge(contentLength: string | null): boolean {
  if (!contentLength) return false;
  const size = Number(contentLength);
  return Number.isFinite(size) && size > MAX_REQUEST_BYTES;
}
