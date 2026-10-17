import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bookings,
  cronRuns,
  emailDeliveries,
  funnelEvents,
  landingSessions,
  leads,
  trialOfferings,
  trialWindows,
} from "@/db/schema";
import { FUNNEL_EVENTS } from "@/lib/funnel";

/**
 * School-scoped overview summaries. Independent aggregates run concurrently.
 * Callers receive counts only — never raw sessions or bookings.
 */
export type OverviewMetrics = {
  upcomingBookings: number;
  leads: number;
  eligibleSessions: number;
  convertedSessions: number;
  chatAssistedBookingEvents: number;
  activeTrialClasses: number;
  activeClassTimes: number;
  failedEmails: number;
  lastMaintenanceAt: Date | null;
};

function countRow(rows: Array<{ count: number }> | undefined): number {
  return rows?.[0]?.count ?? 0;
}

export async function loadOverviewMetrics(
  schoolId: string,
  now: Date = new Date(),
): Promise<OverviewMetrics> {
  const db = getDb();

  const [
    upcoming,
    leadCount,
    eligible,
    converted,
    chatConverted,
    offeringCount,
    windowCount,
    failedEmail,
    lastRun,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.schoolId, schoolId),
          eq(bookings.status, "booked"),
          gte(bookings.startAt, now),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.schoolId, schoolId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(landingSessions)
      .where(and(eq(landingSessions.schoolId, schoolId), isNotNull(landingSessions.qualifiedAt))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(landingSessions)
      .where(
        and(
          eq(landingSessions.schoolId, schoolId),
          isNotNull(landingSessions.qualifiedAt),
          sql`${landingSessions.id} in (
            select ${bookings.landingSessionId}
            from ${bookings}
            where ${bookings.schoolId} = ${schoolId}
              and ${bookings.landingSessionId} is not null
          )`,
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(funnelEvents)
      .where(
        and(
          eq(funnelEvents.schoolId, schoolId),
          eq(funnelEvents.eventType, FUNNEL_EVENTS.bookingConfirmed),
          sql`${funnelEvents.metadata} ->> 'source' = 'chat'`,
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(trialOfferings)
      .where(and(eq(trialOfferings.schoolId, schoolId), eq(trialOfferings.active, true))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(trialWindows)
      .where(and(eq(trialWindows.schoolId, schoolId), eq(trialWindows.active, true))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailDeliveries)
      .where(and(eq(emailDeliveries.schoolId, schoolId), eq(emailDeliveries.state, "failed"))),
    db.select().from(cronRuns).orderBy(desc(cronRuns.startedAt)).limit(1),
  ]);

  return {
    upcomingBookings: countRow(upcoming),
    leads: countRow(leadCount),
    eligibleSessions: countRow(eligible),
    convertedSessions: countRow(converted),
    chatAssistedBookingEvents: countRow(chatConverted),
    activeTrialClasses: countRow(offeringCount),
    activeClassTimes: countRow(windowCount),
    failedEmails: countRow(failedEmail),
    lastMaintenanceAt: lastRun[0]?.finishedAt ?? null,
  };
}
