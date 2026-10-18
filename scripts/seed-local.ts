import { createClient } from "@supabase/supabase-js";
import { and, eq, gte } from "drizzle-orm";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../src/db";
import {
  bookings,
  contacts,
  participants,
  schools,
  trialOccurrences,
  trialOfferings,
  trialWindows,
  users,
} from "../src/db/schema";
import { bookingIcsUid } from "../src/lib/email/ics";
import { LOCAL_WHATSAPP_PHONE_NUMBER_ID } from "../src/lib/whatsapp/config";
import { getSupabaseEnv } from "./local-env";
import { fail } from "./local-process";

export const LOCAL_OWNER_EMAIL = "owner@local.test";
export const LOCAL_OWNER_PASSWORD = "local-dev-password";
export const LOCAL_SCHOOL_SLUG = "demo";

async function ensureAuthUser(apiUrl: string, serviceRoleKey: string) {
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: LOCAL_OWNER_EMAIL,
    password: LOCAL_OWNER_PASSWORD,
    email_confirm: true,
    user_metadata: { name: "Local Owner" },
  });
  if (!createError && created.user) return created.user;

  const duplicate =
    createError?.message?.toLowerCase().includes("already") || createError?.status === 422;
  if (!duplicate) {
    fail(`Could not create local owner: ${createError?.message ?? "unknown"}`);
  }

  const { data: list, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) fail(`Could not list auth users: ${listError.message}`);
  const existing = list.users.find((user) => user.email?.toLowerCase() === LOCAL_OWNER_EMAIL);
  if (!existing) fail("Local owner exists but could not be loaded.");
  return existing;
}

export async function seedLocal() {
  const supabaseEnv = await getSupabaseEnv();
  if (!supabaseEnv["SERVICE_ROLE_KEY"]) {
    fail("supabase status did not include SERVICE_ROLE_KEY.");
  }

  const authUser = await ensureAuthUser(supabaseEnv["API_URL"], supabaseEnv["SERVICE_ROLE_KEY"]);
  const db = getDb();

  await db
    .insert(users)
    .values({
      id: authUser.id,
      email: LOCAL_OWNER_EMAIL,
      name: "Local Owner",
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: LOCAL_OWNER_EMAIL,
        name: "Local Owner",
        updatedAt: new Date(),
      },
    });

  const [existingSchool] = await db
    .select()
    .from(schools)
    .where(eq(schools.ownerUserId, authUser.id))
    .limit(1);

  let schoolId = existingSchool?.id;
  if (!schoolId) {
    const [inserted] = await db
      .insert(schools)
      .values({
        ownerUserId: authUser.id,
        name: "Demo Dojo",
        slug: LOCAL_SCHOOL_SLUG,
        timezone: "America/New_York",
        city: "Brooklyn",
        address: "123 Demo Street",
        phone: "555-0100",
        notificationEmail: LOCAL_OWNER_EMAIL,
        country: "US",
        approvedAt: new Date(),
        whatsappPhoneNumberId: LOCAL_WHATSAPP_PHONE_NUMBER_ID,
        welcomeMessage: "Welcome to the local demo school.",
      })
      .onConflictDoNothing()
      .returning({ id: schools.id });
    schoolId = inserted?.id;
  }
  if (!schoolId) {
    const [bySlug] = await db
      .select()
      .from(schools)
      .where(eq(schools.slug, LOCAL_SCHOOL_SLUG))
      .limit(1);
    schoolId = bySlug?.id;
  }
  if (!schoolId) fail("Could not seed demo school.");

  await db
    .update(schools)
    .set({
      approvedAt: existingSchool?.approvedAt ?? new Date(),
      city: existingSchool?.city ?? "Brooklyn",
      whatsappPhoneNumberId: LOCAL_WHATSAPP_PHONE_NUMBER_ID,
      updatedAt: new Date(),
    })
    .where(eq(schools.id, schoolId));

  const [offering] = await db
    .select()
    .from(trialOfferings)
    .where(eq(trialOfferings.schoolId, schoolId))
    .limit(1);
  let offeringId = offering?.id;
  if (!offeringId) {
    const [createdOffering] = await db
      .insert(trialOfferings)
      .values({
        schoolId,
        name: "Kids beginner trial",
        description: "A 45-minute intro class for new students.",
        minimumAge: 5,
        maximumAge: 12,
        active: true,
      })
      .returning({ id: trialOfferings.id });
    offeringId = createdOffering?.id;
  }
  if (!offeringId) fail("Could not seed trial offering.");

  let [window] = await db
    .select()
    .from(trialWindows)
    .where(eq(trialWindows.schoolId, schoolId))
    .limit(1);
  if (!window) {
    const [createdWindow] = await db
      .insert(trialWindows)
      .values({
        schoolId,
        trialOfferingId: offeringId,
        dayOfWeek: 1,
        startMinute: 18 * 60,
        durationMinutes: 60,
        capacity: 8,
        label: "Monday 6pm",
        active: true,
      })
      .returning();
    window = createdWindow;
  }
  if (!window) fail("Could not seed class time.");

  const [school] = await db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) fail("Could not load demo school.");
  await seedUpcomingBooking({
    schoolId,
    timezone: school.timezone,
    offeringId,
    offeringName: offering?.name ?? "Kids beginner trial",
    windowId: window.id,
    capacity: window.capacity,
    durationMinutes: window.durationMinutes,
  });

  console.log(
    `Seeded ${LOCAL_OWNER_EMAIL} / ${LOCAL_OWNER_PASSWORD} with school /s/${LOCAL_SCHOOL_SLUG} (approved, unpublished).`,
  );
}

const DEMO_CONTACT_EMAIL = "family@local.test";
const DEMO_BOOKING_KEY = "seed:demo-upcoming";

async function seedUpcomingBooking({
  schoolId,
  timezone,
  offeringId,
  offeringName,
  windowId,
  capacity,
  durationMinutes,
}: {
  schoolId: string;
  timezone: string;
  offeringId: string;
  offeringName: string;
  windowId: string;
  capacity: number;
  durationMinutes: number;
}) {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.schoolId, schoolId),
        eq(bookings.status, "booked"),
        gte(bookings.startAt, now),
      ),
    )
    .limit(1);
  if (existing) return;

  const startAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

  const [contact] = await db
    .insert(contacts)
    .values({
      schoolId,
      email: DEMO_CONTACT_EMAIL,
      name: "Alex Rivera",
      phone: "555-0199",
    })
    .onConflictDoUpdate({
      target: [contacts.schoolId, contacts.email],
      set: { name: "Alex Rivera", phone: "555-0199", updatedAt: new Date() },
    })
    .returning();
  if (!contact) fail("Could not seed demo contact.");

  const [participant] = await db
    .insert(participants)
    .values({
      schoolId,
      contactId: contact.id,
      name: "Sam Rivera",
      normalizedName: "sam rivera",
    })
    .onConflictDoUpdate({
      target: [participants.contactId, participants.normalizedName],
      set: { name: "Sam Rivera", updatedAt: new Date() },
    })
    .returning();
  if (!participant) fail("Could not seed demo participant.");

  await db
    .insert(trialOccurrences)
    .values({
      schoolId,
      trialWindowId: windowId,
      trialOfferingId: offeringId,
      startAt,
      endAt,
      capacity,
      bookedCount: 0,
    })
    .onConflictDoNothing({
      target: [trialOccurrences.trialWindowId, trialOccurrences.startAt],
    });

  const [occurrence] = await db
    .select()
    .from(trialOccurrences)
    .where(
      and(
        eq(trialOccurrences.schoolId, schoolId),
        eq(trialOccurrences.trialWindowId, windowId),
        eq(trialOccurrences.startAt, startAt),
      ),
    )
    .limit(1);
  if (!occurrence) fail("Could not seed demo occurrence.");

  const [booking] = await db
    .insert(bookings)
    .values({
      schoolId,
      contactId: contact.id,
      participantId: participant.id,
      trialOfferingId: offeringId,
      trialWindowId: windowId,
      trialOccurrenceId: occurrence.id,
      idempotencyKey: DEMO_BOOKING_KEY,
      status: "booked",
      participantNameSnapshot: "Sam Rivera",
      participantAgeSnapshot: 8,
      offeringNameSnapshot: offeringName,
      timezoneSnapshot: timezone,
      startAt,
      endAt,
      contactEmailSnapshot: DEMO_CONTACT_EMAIL,
      contactNameSnapshot: "Alex Rivera",
      contactPhoneSnapshot: "555-0199",
      icsUid: "pending",
    })
    .onConflictDoNothing({
      target: [bookings.schoolId, bookings.idempotencyKey],
    })
    .returning({ id: bookings.id });

  if (booking) {
    await db
      .update(bookings)
      .set({ icsUid: bookingIcsUid(booking.id) })
      .where(eq(bookings.id, booking.id));
    await db
      .update(trialOccurrences)
      .set({
        bookedCount: occurrence.bookedCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(trialOccurrences.id, occurrence.id));
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  await seedLocal();
  process.exit(0);
}
