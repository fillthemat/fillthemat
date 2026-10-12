import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb } from "@/db";
import { landingSessions, schools, trialWindows } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { createLead } from "@/lib/leads/create-lead";
import { bookSlot } from "@/lib/schedule/book-slot";
import { listOpenSlots } from "@/lib/schedule/occurrences";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { loadBookings } from "./bookings/queries";
import { loadLeads } from "./leads/queries";

loadLocalEnv();
const db = getDb();
const auth = authSql();
const ownerId = randomUUID();
let schoolId = "";
let offeringId = "";

beforeAll(async () => {
  const seeded = await seedSchool(auth, {
    ownerId,
    name: "Dashboard Channel School",
    slug: `channel-${ownerId.slice(0, 8)}`,
    publishedAt: new Date(),
    offerings: [{ name: "Trial" }],
  });
  schoolId = seeded.schoolId;
  offeringId = requireRow(seeded.offeringIds[0], "offering");
  await db.insert(trialWindows).values(
    Array.from({ length: 7 }, (_, dayOfWeek) => ({
      schoolId,
      trialOfferingId: offeringId,
      dayOfWeek,
      startMinute: 1020,
      durationMinutes: 60,
      capacity: 10,
    })),
  );
});

afterAll(async () => {
  await deleteSchoolOwner(auth, ownerId);
  await auth.end({ timeout: 5 });
});

it("shows the stored channel on each school booking without conversation or session inference", async () => {
  const [schoolRow] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, schoolId));
  const school = requireRow(schoolRow, "school");
  const windows = await db
    .select()
    .from(trialWindows)
    .where(eq(trialWindows.schoolId, schoolId));
  const slot = requireRow(
    listOpenSlots({
      offeringId,
      timezone: school.timezone,
      windows,
      occurrences: [],
      now: new Date(),
    })[0],
    "trial",
  );
  for (const channel of ["web", "whatsapp"] as const) {
    const result = await bookSlot({
      school,
      channel,
      offeringId,
      slotId: slot.slotId,
      idempotencyKey: randomUUID(),
      contact: {
        name: `${channel} Contact`,
        email: `${randomUUID()}@local.test`,
        phone: channel === "web" ? "16505550011" : "16505550012",
      },
      participant: { name: `${channel} Participant`, age: 8 },
    });
    expect(result.ok).toBe(true);
  }
  const rows = await loadBookings({ schoolId, filter: "all" });
  expect(
    rows.map(({ participantNameSnapshot, channel }) => ({
      participantNameSnapshot,
      channel,
    })),
  ).toEqual(
    expect.arrayContaining([
      { participantNameSnapshot: "web Participant", channel: "web" },
      { participantNameSnapshot: "whatsapp Participant", channel: "whatsapp" },
    ]),
  );
  expect(await loadBookings({ schoolId: randomUUID(), filter: "all" })).toEqual(
    [],
  );
});

it("shows each lead's channel separately from its landing campaign", async () => {
  const [schoolRow] = await db
    .select()
    .from(schools)
    .where(eq(schools.id, schoolId));
  const school = requireRow(schoolRow, "school");
  const token = randomUUID();
  await db.insert(landingSessions).values({
    schoolId,
    sessionKeyHash: hashToken(token),
    utmSource: "whatsapp",
  });
  await createLead({
    school,
    contact: {
      name: "Web Lead",
      email: `${randomUUID()}@local.test`,
      phone: "16505550021",
    },
    source: { channel: "web", landingSessionToken: token },
  });
  await createLead({
    school,
    contact: { name: "WhatsApp Lead", email: null, phone: "16505550022" },
    source: { channel: "whatsapp", waId: "16505550022" },
  });
  const rows = await loadLeads(schoolId);
  expect(
    rows.map(({ lead, contact }) => ({
      name: contact.name,
      channel: lead.channel,
    })),
  ).toEqual(
    expect.arrayContaining([
      { name: "Web Lead", channel: "web" },
      { name: "WhatsApp Lead", channel: "whatsapp" },
    ]),
  );
  expect(await loadLeads(randomUUID())).toEqual([]);
});
