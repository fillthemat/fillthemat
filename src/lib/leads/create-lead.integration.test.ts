import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "@/db";
import {
  contacts,
  emailDeliveries,
  funnelEvents,
  landingSessions,
  schools,
  users,
} from "@/db/schema";
import { hashWaId } from "@/lib/crypto";
import { attemptPendingForLead } from "@/lib/email/deliveries";
import type { EmailMessage } from "@/lib/email/dependencies";
import { FUNNEL_EVENTS } from "@/lib/funnel";
import { createLead } from "@/lib/leads/create-lead";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";

loadLocalEnv();

const db = getDb();
const sql = authSql();
const suffix = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const slug = `wa-lead-${suffix}`;
const waId = `1650${Date.now().toString().slice(-7)}`;
let schoolId = "";

beforeAll(async () => {
  await insertAuthUser(sql, ownerId, `wa-lead-${suffix}@local.test`);
  await db.insert(users).values({
    id: ownerId,
    email: `wa-lead-${suffix}@local.test`,
    name: "WA Lead Owner",
  });
  const [school] = await db
    .insert(schools)
    .values({
      ownerUserId: ownerId,
      name: "WhatsApp Lead School",
      slug,
      timezone: "America/New_York",
      notificationEmail: `wa-lead-${suffix}@local.test`,
      approvedAt: new Date(),
      publishedAt: new Date(),
    })
    .returning({ id: schools.id });
  if (!school) throw new Error("failed to seed school");
  schoolId = school.id;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, ownerId));
  await deleteAuthUser(sql, ownerId);
  await sql.end({ timeout: 5 });
});

afterEach(() => vi.useRealTimers());

describe("createLead (WhatsApp no-email path)", () => {
  it("sends the owner lead alert inline when the app clock is behind the database", async () => {
    const [schoolRow] = await db
      .select()
      .from(schools)
      .where(eq(schools.id, schoolId));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() - 86_400_000));
    const lead = await createLead({
      school: requireRow(schoolRow, "school"),
      contact: { name: "Clock Skew Contact", email: null, phone: waId },
      source: { channel: "whatsapp", waId },
    });
    const send = vi.fn(async (_message: EmailMessage) => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: randomUUID(),
    }));
    await attemptPendingForLead(lead.id, { transport: { send } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      to: schoolRow?.notificationEmail,
      idempotencyKey: `owner-lead/${lead.id}`,
    });
    const [delivery] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.leadId, lead.id));
    expect(delivery?.state).toBe("sent");
    expect(delivery?.nextAttemptAt).toEqual(new Date());
  });

  it("creates a lead with a synthesized utm_source='whatsapp' session and phone-keyed contact", async () => {
    const [schoolRow] = await db
      .select()
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);
    const school = requireRow(schoolRow, "school");

    const lead = await createLead({
      school,
      contact: { name: "Alex Rivera", email: null, phone: waId },
      source: { channel: "whatsapp", waId },
      participantName: "Sam",
      participantAge: 8,
      statedNeed: "Beginner class after school",
    });

    expect(lead.schoolId).toBe(schoolId);
    expect(lead.participantName).toBe("Sam");

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, lead.contactId));
    expect(requireRow(contact, "contact").email).toBeNull();
    expect(contact?.phone).toBe(waId);

    const [session] = await db
      .select()
      .from(landingSessions)
      .where(eq(landingSessions.id, lead.landingSessionId));
    expect(session?.utmSource).toBe("whatsapp");

    const [funnel] = await db
      .select()
      .from(funnelEvents)
      .where(eq(funnelEvents.leadId, lead.id));
    expect(requireRow(funnel, "funnel event").eventType).toBe(
      FUNNEL_EVENTS.leadCaptured,
    );
    expect(funnel?.metadata).toEqual({
      channel: "whatsapp",
      hasOffering: false,
    });

    const [ownerEmail] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.leadId, lead.id));
    expect(ownerEmail?.kind).toBe("owner_lead");
    expect(ownerEmail?.recipient).toBe(school.notificationEmail);
  });

  it("upserts the phone-keyed contact and reuses the synthesized session on repeat leads", async () => {
    const [schoolRow] = await db
      .select()
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);
    const school = requireRow(schoolRow, "school");

    const first = await createLead({
      school,
      contact: { name: "Alex Rivera", email: null, phone: waId },
      source: { channel: "whatsapp", waId },
    });
    const contactsBefore = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.schoolId, schoolId), eq(contacts.phone, waId)));
    expect(contactsBefore).toHaveLength(1);

    const second = await createLead({
      school,
      contact: { name: "Alex Rivera", email: null, phone: waId },
      source: { channel: "whatsapp", waId },
    });
    const contactsAfter = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.schoolId, schoolId), eq(contacts.phone, waId)));
    expect(contactsAfter).toHaveLength(1);

    // The synthesized pseudo session is stable per wa id, so repeat leads share
    // it (keeps funnel analytics continuous).
    expect(second.landingSessionId).toBe(first.landingSessionId);
    const sessions = await db
      .select()
      .from(landingSessions)
      .where(
        and(
          eq(landingSessions.schoolId, schoolId),
          eq(
            landingSessions.sessionKeyHash,
            hashWaId(`whatsapp-landing:${waId}`),
          ),
        ),
      );
    expect(sessions).toHaveLength(1);
    expect(requireRow(sessions[0], "session").utmSource).toBe("whatsapp");
  });
});
