import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  bookings,
  contacts,
  funnelEvents,
  landingSessions,
  leads,
  participants,
  schools,
  trialOccurrences,
  trialOfferings,
  trialWindows,
  users,
} from "@/db/schema";
import { FUNNEL_EVENTS } from "@/lib/funnel";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import { formatBookingConversion } from "./format";
import { loadOverviewMetrics } from "./queries";

loadLocalEnv();

const sql = authSql();
const db = getDb();
const suffix = randomUUID().slice(0, 8);
const ownerA = randomUUID();
const ownerB = randomUUID();
const now = new Date("2026-06-15T15:00:00.000Z");

let schoolA = "";
let schoolB = "";
let offeringA = "";
let windowA = "";
let occurrenceA = "";
let contactA = "";
let participantA = "";

async function session(opts: {
  schoolId: string;
  qualified: boolean;
  preview?: boolean;
  bot?: boolean;
}) {
  const [row] = await db
    .insert(landingSessions)
    .values({
      schoolId: opts.schoolId,
      sessionKeyHash: randomUUID(),
      firstSeenAt: now,
      lastSeenAt: now,
      qualifiedAt: opts.qualified ? now : null,
      isPreview: Boolean(opts.preview),
      botExclusionReason: opts.bot ? "ua" : null,
    })
    .returning({ id: landingSessions.id });
  if (!row) throw new Error("session");
  return row.id;
}

async function booking(opts: {
  schoolId: string;
  offeringId: string;
  windowId: string;
  occurrenceId: string;
  contactId: string;
  participantId: string;
  status?: "booked" | "cancelled" | "showed";
  startAt: Date;
  landingSessionId?: string | null;
  name?: string;
}) {
  const startAt = opts.startAt;
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  const [row] = await db
    .insert(bookings)
    .values({
      schoolId: opts.schoolId,
      contactId: opts.contactId,
      participantId: opts.participantId,
      trialOfferingId: opts.offeringId,
      trialWindowId: opts.windowId,
      trialOccurrenceId: opts.occurrenceId,
      landingSessionId: opts.landingSessionId ?? null,
      idempotencyKey: randomUUID(),
      status: opts.status ?? "booked",
      cancelledAt: opts.status === "cancelled" ? now : null,
      participantNameSnapshot: opts.name ?? "Sam",
      participantAgeSnapshot: 8,
      offeringNameSnapshot: "Kids",
      timezoneSnapshot: "America/New_York",
      startAt,
      endAt,
      contactEmailSnapshot: `family-${suffix}@local.test`,
      contactNameSnapshot: "Alex",
      contactPhoneSnapshot: "555-0100",
      icsUid: `ics-${randomUUID()}`,
    })
    .returning({ id: bookings.id });
  if (!row) throw new Error("booking");
  return row.id;
}

beforeAll(async () => {
  await insertAuthUser(sql, ownerA, `ovw-a-${suffix}@local.test`);
  await insertAuthUser(sql, ownerB, `ovw-b-${suffix}@local.test`);
  await db.insert(users).values([
    { id: ownerA, email: `ovw-a-${suffix}@local.test`, name: "A" },
    { id: ownerB, email: `ovw-b-${suffix}@local.test`, name: "B" },
  ]);
  const [a] = await db
    .insert(schools)
    .values({
      ownerUserId: ownerA,
      name: "Overview School A",
      slug: `ovw-a-${suffix}`,
      timezone: "America/New_York",
      notificationEmail: `ovw-a-${suffix}@local.test`,
      city: "Brooklyn",
      approvedAt: now,
      publishedAt: now,
    })
    .returning({ id: schools.id });
  const [b] = await db
    .insert(schools)
    .values({
      ownerUserId: ownerB,
      name: "Overview School B",
      slug: `ovw-b-${suffix}`,
      timezone: "America/Chicago",
      notificationEmail: `ovw-b-${suffix}@local.test`,
      city: "Austin",
      approvedAt: now,
      publishedAt: now,
    })
    .returning({ id: schools.id });
  if (!a || !b) throw new Error("schools");
  schoolA = a.id;
  schoolB = b.id;

  const [offering] = await db
    .insert(trialOfferings)
    .values({
      schoolId: schoolA,
      name: "Kids",
      active: true,
    })
    .returning({ id: trialOfferings.id });
  offeringA = requireRow(offering, "offering").id;
  const [window] = await db
    .insert(trialWindows)
    .values({
      schoolId: schoolA,
      trialOfferingId: offeringA,
      dayOfWeek: 1,
      startMinute: 18 * 60,
      durationMinutes: 60,
      capacity: 8,
      active: true,
    })
    .returning({ id: trialWindows.id });
  windowA = requireRow(window, "window").id;
  const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [occurrence] = await db
    .insert(trialOccurrences)
    .values({
      schoolId: schoolA,
      trialWindowId: windowA,
      trialOfferingId: offeringA,
      startAt: future,
      endAt: new Date(future.getTime() + 60 * 60 * 1000),
      capacity: 8,
      bookedCount: 0,
    })
    .returning({ id: trialOccurrences.id });
  occurrenceA = requireRow(occurrence, "occurrence").id;
  const [contact] = await db
    .insert(contacts)
    .values({
      schoolId: schoolA,
      email: `family-a-${suffix}@local.test`,
      name: "Alex",
      phone: "555-0100",
    })
    .returning({ id: contacts.id });
  contactA = requireRow(contact, "contact").id;
  const [participant] = await db
    .insert(participants)
    .values({
      schoolId: schoolA,
      contactId: contactA,
      name: "Sam",
      normalizedName: `sam-${suffix}`,
    })
    .returning({ id: participants.id });
  participantA = requireRow(participant, "participant").id;

  async function extraParticipant(name: string) {
    const [row] = await db
      .insert(participants)
      .values({
        schoolId: schoolA,
        contactId: contactA,
        name,
        normalizedName: `${name.toLowerCase().replace(/\s+/g, "-")}-${suffix}-${randomUUID().slice(0, 4)}`,
      })
      .returning({ id: participants.id });
    return requireRow(row, "participant").id;
  }

  const eligibleConverted = await session({
    schoolId: schoolA,
    qualified: true,
  });
  const eligibleUnconverted = await session({
    schoolId: schoolA,
    qualified: true,
  });
  void eligibleUnconverted;
  const preview = await session({
    schoolId: schoolA,
    qualified: false,
    preview: true,
  });
  const bot = await session({
    schoolId: schoolA,
    qualified: false,
    bot: true,
  });
  const unqualified = await session({
    schoolId: schoolA,
    qualified: false,
  });

  await booking({
    schoolId: schoolA,
    offeringId: offeringA,
    windowId: windowA,
    occurrenceId: occurrenceA,
    contactId: contactA,
    participantId: participantA,
    landingSessionId: eligibleConverted,
    startAt: future,
    name: "Sam One",
  });
  await booking({
    schoolId: schoolA,
    offeringId: offeringA,
    windowId: windowA,
    occurrenceId: occurrenceA,
    contactId: contactA,
    participantId: participantA,
    landingSessionId: eligibleConverted,
    startAt: future,
    status: "cancelled",
    name: "Sam Duplicate",
  });
  await booking({
    schoolId: schoolA,
    offeringId: offeringA,
    windowId: windowA,
    occurrenceId: occurrenceA,
    contactId: contactA,
    participantId: await extraParticipant("Preview kid"),
    landingSessionId: preview,
    startAt: future,
    name: "Preview booker",
  });
  await booking({
    schoolId: schoolA,
    offeringId: offeringA,
    windowId: windowA,
    occurrenceId: occurrenceA,
    contactId: contactA,
    participantId: await extraParticipant("Bot kid"),
    landingSessionId: bot,
    startAt: future,
    name: "Bot booker",
  });
  await booking({
    schoolId: schoolA,
    offeringId: offeringA,
    windowId: windowA,
    occurrenceId: occurrenceA,
    contactId: contactA,
    participantId: await extraParticipant("Unqualified kid"),
    landingSessionId: unqualified,
    startAt: future,
    name: "Unqualified booker",
  });
  await booking({
    schoolId: schoolA,
    offeringId: offeringA,
    windowId: windowA,
    occurrenceId: occurrenceA,
    contactId: contactA,
    participantId: await extraParticipant("No session kid"),
    landingSessionId: null,
    startAt: future,
    name: "No session",
  });
  await booking({
    schoolId: schoolA,
    offeringId: offeringA,
    windowId: windowA,
    occurrenceId: occurrenceA,
    contactId: contactA,
    participantId: await extraParticipant("Cancelled kid"),
    startAt: future,
    status: "cancelled",
    name: "Cancelled future",
  });

  await db.insert(funnelEvents).values({
    schoolId: schoolA,
    eventType: FUNNEL_EVENTS.bookingConfirmed,
    metadata: { source: "chat" },
  });
  await db.insert(funnelEvents).values({
    schoolId: schoolA,
    eventType: FUNNEL_EVENTS.bookingConfirmed,
    metadata: { source: "form" },
  });

  await db.insert(leads).values({
    schoolId: schoolA,
    landingSessionId: eligibleConverted,
    contactId: contactA,
    status: "open",
  });

  const [offeringB] = await db
    .insert(trialOfferings)
    .values({ schoolId: schoolB, name: "B class", active: true })
    .returning({ id: trialOfferings.id });
  const [windowB] = await db
    .insert(trialWindows)
    .values({
      schoolId: schoolB,
      trialOfferingId: requireRow(offeringB, "offering B").id,
      dayOfWeek: 2,
      startMinute: 17 * 60,
      durationMinutes: 45,
      capacity: 6,
      active: true,
    })
    .returning({ id: trialWindows.id });
  const [occurrenceB] = await db
    .insert(trialOccurrences)
    .values({
      schoolId: schoolB,
      trialWindowId: requireRow(windowB, "window B").id,
      trialOfferingId: requireRow(offeringB, "offering B").id,
      startAt: future,
      endAt: new Date(future.getTime() + 45 * 60 * 1000),
      capacity: 6,
      bookedCount: 0,
    })
    .returning({ id: trialOccurrences.id });
  const [contactB] = await db
    .insert(contacts)
    .values({
      schoolId: schoolB,
      email: `family-b-${suffix}@local.test`,
      name: "Bea",
      phone: "555-0101",
    })
    .returning({ id: contacts.id });
  const [participantB] = await db
    .insert(participants)
    .values({
      schoolId: schoolB,
      contactId: requireRow(contactB, "contact B").id,
      name: "Pat",
      normalizedName: `pat-${suffix}`,
    })
    .returning({ id: participants.id });
  const eligibleB = await session({ schoolId: schoolB, qualified: true });
  await booking({
    schoolId: schoolB,
    offeringId: requireRow(offeringB, "offering B").id,
    windowId: requireRow(windowB, "window B").id,
    occurrenceId: requireRow(occurrenceB, "occurrence B").id,
    contactId: requireRow(contactB, "contact B").id,
    participantId: requireRow(participantB, "participant B").id,
    landingSessionId: eligibleB,
    startAt: future,
    name: "School B",
  });
  await db.insert(leads).values({
    schoolId: schoolB,
    landingSessionId: eligibleB,
    contactId: requireRow(contactB, "contact B").id,
    status: "open",
  });
});

afterAll(async () => {
  await deleteAuthUser(sql, ownerA);
  await deleteAuthUser(sql, ownerB);
  await sql.end({ timeout: 5 });
});

describe("loadOverviewMetrics", () => {
  it("counts converted sessions as a subset of eligible sessions", async () => {
    const metrics = await loadOverviewMetrics(schoolA, now);
    expect(metrics.eligibleSessions).toBe(2);
    expect(metrics.convertedSessions).toBe(1);
    expect(metrics.convertedSessions).toBeLessThanOrEqual(metrics.eligibleSessions);
    expect(formatBookingConversion(metrics.convertedSessions, metrics.eligibleSessions).value).toBe(
      "50%",
    );
  });

  it("counts duplicate bookings per session once and keeps cancelled conversions", async () => {
    const metrics = await loadOverviewMetrics(schoolA, now);
    expect(metrics.convertedSessions).toBe(1);
  });

  it("excludes preview, bot, and unqualified sessions from the denominator", async () => {
    const metrics = await loadOverviewMetrics(schoolA, now);
    expect(metrics.eligibleSessions).toBe(2);
  });

  it("does not count bookings without a session in the numerator", async () => {
    const metrics = await loadOverviewMetrics(schoolA, now);
    expect(metrics.convertedSessions).toBe(1);
  });

  it("matches upcoming booked count including cancelled-future fixtures", async () => {
    const metrics = await loadOverviewMetrics(schoolA, now);
    // Booked future: Sam One, Preview, Bot, Unqualified, No session = 5
    // Cancelled future bookings are excluded.
    expect(metrics.upcomingBookings).toBe(5);
  });

  it("is school-scoped", async () => {
    const a = await loadOverviewMetrics(schoolA, now);
    const b = await loadOverviewMetrics(schoolB, now);
    expect(a.leads).toBe(1);
    expect(b.leads).toBe(1);
    expect(b.eligibleSessions).toBe(1);
    expect(b.convertedSessions).toBe(1);
    expect(b.upcomingBookings).toBe(1);
    expect(a.eligibleSessions).not.toBe(b.eligibleSessions);
  });

  it("labels chat-assisted bookings as recorded events", async () => {
    const metrics = await loadOverviewMetrics(schoolA, now);
    expect(metrics.chatAssistedBookingEvents).toBe(1);
  });

  it("shows an undefined conversion when the denominator is zero", async () => {
    const emptyOwner = randomUUID();
    await insertAuthUser(sql, emptyOwner, `ovw-z-${suffix}@local.test`);
    await db.insert(users).values({
      id: emptyOwner,
      email: `ovw-z-${suffix}@local.test`,
      name: "Z",
    });
    const [empty] = await db
      .insert(schools)
      .values({
        ownerUserId: emptyOwner,
        name: "Empty",
        slug: `ovw-z-${suffix}`,
        timezone: "UTC",
        notificationEmail: `ovw-z-${suffix}@local.test`,
      })
      .returning({ id: schools.id });
    const metrics = await loadOverviewMetrics(requireRow(empty, "empty school").id, now);
    expect(metrics.eligibleSessions).toBe(0);
    expect(metrics.convertedSessions).toBe(0);
    expect(formatBookingConversion(metrics.convertedSessions, metrics.eligibleSessions).value).toBe(
      "—",
    );
    await deleteAuthUser(sql, emptyOwner);
  });
});
