import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, faqs, trialOccurrences, trialOfferings, trialWindows } from "@/db/schema";

/**
 * Server-only reads for the settings screen. Kept out of `actions.ts` so they
 * are never exposed as callable server endpoints.
 */

export type OfferingRow = typeof trialOfferings.$inferSelect;
export type FaqRow = typeof faqs.$inferSelect;

export type WindowRow = typeof trialWindows.$inferSelect & {
  offeringName: string;
  offeringActive: boolean;
  /** Any occurrence has been generated, so the row can no longer be deleted. */
  onCalendar: boolean;
  /** An upcoming booking exists, so capacity and deletion are restricted. */
  hasUpcomingBooking: boolean;
  /** Highest booked count across future occurrences. */
  maxUpcomingBooked: number;
};

export async function loadOfferings(schoolId: string): Promise<OfferingRow[]> {
  const db = getDb();
  return db
    .select()
    .from(trialOfferings)
    .where(eq(trialOfferings.schoolId, schoolId))
    .orderBy(asc(trialOfferings.createdAt));
}

export async function loadFaqs(schoolId: string): Promise<FaqRow[]> {
  const db = getDb();
  return db
    .select()
    .from(faqs)
    .where(eq(faqs.schoolId, schoolId))
    .orderBy(asc(faqs.sortOrder), asc(faqs.createdAt));
}

export async function loadWindows(schoolId: string): Promise<WindowRow[]> {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = await db
    .select({
      window: trialWindows,
      offeringName: trialOfferings.name,
      offeringActive: trialOfferings.active,
      occurrenceCount: sql<number>`(
        select count(*)::int from ${trialOccurrences}
        where ${trialOccurrences.trialWindowId} = ${trialWindows.id}
      )`,
      maxUpcomingBooked: sql<number>`(
        select coalesce(max(${trialOccurrences.bookedCount}), 0)::int
        from ${trialOccurrences}
        where ${trialOccurrences.trialWindowId} = ${trialWindows.id}
          and ${trialOccurrences.startAt} > ${now}::timestamptz
      )`,
      upcomingBookings: sql<number>`(
        select count(*)::int from ${bookings}
        where ${bookings.trialWindowId} = ${trialWindows.id}
          and ${bookings.status} <> 'cancelled'
          and ${bookings.startAt} > ${now}::timestamptz
      )`,
    })
    .from(trialWindows)
    .innerJoin(
      trialOfferings,
      and(
        eq(trialOfferings.id, trialWindows.trialOfferingId),
        eq(trialOfferings.schoolId, trialWindows.schoolId),
      ),
    )
    .where(eq(trialWindows.schoolId, schoolId))
    .orderBy(asc(trialWindows.dayOfWeek), asc(trialWindows.startMinute));

  return rows.map((row) => ({
    ...row.window,
    offeringName: row.offeringName,
    offeringActive: row.offeringActive,
    onCalendar: row.occurrenceCount > 0,
    hasUpcomingBooking: row.upcomingBookings > 0,
    maxUpcomingBooked: row.maxUpcomingBooked,
  }));
}

export async function windowHasFutureBooking(schoolId: string, windowId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.schoolId, schoolId),
        eq(bookings.trialWindowId, windowId),
        ne(bookings.status, "cancelled"),
        gt(bookings.startAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(row);
}
