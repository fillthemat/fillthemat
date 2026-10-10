import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  bookings,
  contacts,
  emailDeliveries,
  participants,
  trialOccurrences,
  trialWindows,
  whatsappDeliveries,
} from "@/db/schema";
import { runEmailSendOnce } from "@/lib/email/deliveries";
import type { EmailMessage, EmailSendOutcome } from "@/lib/email/dependencies";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import type { WhatsAppSendOutcome } from "./client";
import { applyWhatsAppStatuses, enqueueWhatsAppDelivery } from "./deliveries";
import { runWhatsAppWorkerOnce } from "./worker";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const classStart = new Date("2018-01-01T18:00:00Z");
let now = classStart;
let schoolId = "";
let bookingId = "";
beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "Confirmation School",
    slug: `confirm-${ownerId.slice(0, 8)}`,
    offerings: [{ name: "Kids BJJ" }],
  });
  schoolId = seeded.schoolId;
  const offeringId = requireRow(seeded.offeringIds[0], "offering");
  const [contact] = await db
    .insert(contacts)
    .values({ schoolId, name: "Sam Rivera", phone: "16505550086" })
    .returning();
  const contactId = requireRow(contact, "contact").id;
  const [participant] = await db
    .insert(participants)
    .values({
      schoolId,
      contactId,
      name: "Alex Rivera",
      normalizedName: "alex rivera",
    })
    .returning();
  const [window] = await db
    .insert(trialWindows)
    .values({
      schoolId,
      trialOfferingId: offeringId,
      dayOfWeek: 1,
      startMinute: 780,
      durationMinutes: 60,
      capacity: 8,
    })
    .returning();
  const windowId = requireRow(window, "window").id;
  const endAt = new Date("2018-01-01T19:00:00Z");
  const [occurrence] = await db
    .insert(trialOccurrences)
    .values({
      schoolId,
      trialOfferingId: offeringId,
      trialWindowId: windowId,
      startAt: classStart,
      endAt,
      capacity: 8,
    })
    .returning();
  const [booking] = await db
    .insert(bookings)
    .values({
      schoolId,
      contactId,
      participantId: requireRow(participant, "participant").id,
      trialOfferingId: offeringId,
      trialWindowId: windowId,
      trialOccurrenceId: requireRow(occurrence, "occurrence").id,
      idempotencyKey: randomUUID(),
      participantNameSnapshot: "Alex Rivera",
      participantAgeSnapshot: 8,
      offeringNameSnapshot: "Kids BJJ",
      timezoneSnapshot: "America/New_York",
      startAt: classStart,
      endAt,
      contactNameSnapshot: "Sam Rivera",
      contactPhoneSnapshot: "16505550086",
      icsUid: randomUUID(),
    })
    .returning();
  bookingId = requireRow(booking, "booking").id;
});
afterEach(async () => {
  await db
    .delete(whatsappDeliveries)
    .where(eq(whatsappDeliveries.schoolId, schoolId));
  await db
    .delete(emailDeliveries)
    .where(eq(emailDeliveries.schoolId, schoolId));
  now = classStart;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});
async function enqueue(
  extra: Partial<typeof whatsappDeliveries.$inferInsert> = {},
) {
  const id = requireRow(
    await enqueueWhatsAppDelivery(
      {
        schoolId,
        bookingId,
        phoneNumberId: `confirmation-${ownerId}`,
        recipientWaId: "16505550086",
        templateName: "booking_confirmation",
        templateParams: [
          "Confirmation School",
          "Alex Rivera",
          "Kids BJJ",
          "Monday",
        ],
        providerIdempotencyKey: randomUUID(),
      },
      now,
    ),
    "delivery",
  );
  if (Object.keys(extra).length)
    await db
      .update(whatsappDeliveries)
      .set(extra)
      .where(eq(whatsappDeliveries.id, id));
  return id;
}
async function stored(id: string) {
  return requireRow(
    (
      await db
        .select()
        .from(whatsappDeliveries)
        .where(eq(whatsappDeliveries.id, id))
    )[0],
    "stored delivery",
  );
}
async function emails() {
  return db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.schoolId, schoolId));
}
function dependencies(send: () => Promise<WhatsAppSendOutcome>) {
  return {
    now: () => new Date(now),
    transport: { sendText: send, sendInteractive: send, sendTemplate: send },
  };
}
describe("booking confirmation delivery through the worker", () => {
  it("stops a failed in-flight confirmation as stale when class starts during the request", async () => {
    now = new Date("2018-01-01T17:59:59Z");
    const id = await enqueue();
    await runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(async () => {
        now = classStart;
        return {
          ok: false,
          kind: "network_error",
          message: "network unavailable",
        };
      }),
    );
    expect(await stored(id)).toMatchObject({
      state: "dead",
      terminalCause: "stale",
      failureReason: "booking_confirmation_stale",
      attempts: 1,
    });
    expect(await emails()).toEqual([]);
  });
  it("notifies on the fifth transient failure but not on the four retryable failures", async () => {
    now = new Date("2018-01-01T17:00:00Z");
    const id = await enqueue();
    const send = vi.fn(
      async (): Promise<WhatsAppSendOutcome> => ({
        ok: false,
        kind: "network_error",
        message: "network unavailable",
      }),
    );
    for (let execution = 1; execution <= 5; execution++) {
      await runWhatsAppWorkerOnce(randomUUID(), dependencies(send));
      const row = await stored(id);
      expect(row.attempts).toBe(execution);
      expect(row.state).toBe(execution < 5 ? "failed" : "dead");
      expect(await emails()).toHaveLength(execution < 5 ? 0 : 1);
      now = row.nextAttemptAt;
    }
    expect(await stored(id)).toMatchObject({
      terminalCause: "attempts_exhausted",
    });
    expect(send).toHaveBeenCalledTimes(5);
  });
  it("never notifies for ordinary replies or other booking-linked templates that die", async () => {
    now = new Date("2018-01-01T17:00:00Z");
    await enqueue({
      bookingId: null,
      templateName: null,
      body: "Assistant reply",
      windowExpiresAt: new Date("2018-01-02T17:00:00Z"),
    });
    await enqueue({ templateName: "booking_reminder" });
    await enqueue({
      templateName: null,
      body: "Booking proposal",
      interactiveButtons: [{ id: "confirm", title: "Confirm" }],
      windowExpiresAt: new Date("2018-01-02T17:00:00Z"),
    });
    await runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(async () => ({
        ok: false,
        kind: "missing_credentials",
        message: "not configured",
      })),
    );
    expect(await emails()).toEqual([]);
  });
  it("allows a confirmation before class start to succeed, without emailing the owner", async () => {
    now = new Date("2018-01-01T17:59:59.999Z");
    const id = await enqueue({ attempts: 4 });
    const send = vi.fn(
      async (): Promise<WhatsAppSendOutcome> => ({
        ok: true,
        kind: "accepted",
        providerId: randomUUID(),
      }),
    );
    await runWhatsAppWorkerOnce(randomUUID(), dependencies(send));
    expect(await stored(id)).toMatchObject({
      state: "sent",
      attempts: 5,
      terminalCause: null,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await emails()).toEqual([]);
  });
  it("sends owner-facing participant, offering, class time and contact details without provider internals", async () => {
    now = new Date("2018-01-01T17:00:00Z");
    await enqueue();
    await runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(async () => ({
        ok: false,
        kind: "whatsapp_error",
        code: 131026,
        subcode: null,
        details: "Graph provider internals",
        status: 400,
        message: "undeliverable raw wamid",
      })),
    );
    const pending = await emails();
    const sent: EmailMessage[] = [];
    const result = await runEmailSendOnce(
      randomUUID(),
      {
        now: () => now,
        transport: {
          send: async (message): Promise<EmailSendOutcome> => {
            sent.push(message);
            return { ok: true, kind: "accepted", providerId: randomUUID() };
          },
        },
      },
      { ids: pending.map((row) => row.id) },
    );
    expect(result.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(
      "We couldn't confirm this booking with Alex Rivera on WhatsApp. Please contact them",
    );
    expect(sent[0].text).toContain("Kids BJJ");
    expect(sent[0].text).toContain(
      "Monday, January 1, 2018 at 1:00 PM (America/New_York)",
    );
    expect(sent[0].text).toContain("Sam Rivera");
    expect(sent[0].text).toContain("16505550086");
    expect(sent[0].text).not.toMatch(
      /131026|Graph|wamid|executions|retry|dead|provider/i,
    );
    expect((await emails())[0]).toMatchObject({ state: "sent", attempts: 1 });
  });
  it("recovers a crashed confirmation at class start as stale, ahead of exhaustion or requeueing", async () => {
    const id = await enqueue({
      state: "claimed",
      attempts: 5,
      claimedAt: new Date("2018-01-01T17:54:00Z"),
      claimedBy: "crashed",
    });
    const send = vi.fn(
      async (): Promise<WhatsAppSendOutcome> => ({
        ok: true,
        kind: "accepted",
        providerId: randomUUID(),
      }),
    );
    const result = await runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(send),
    );
    expect(result.deliveries.dead).toBe(1);
    expect(await stored(id)).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "stale",
    });
    expect(await emails()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
  it("notifies the owner once when a crashed fifth execution is recovered before class", async () => {
    now = new Date("2018-01-01T17:00:00Z");
    const id = await enqueue({
      state: "claimed",
      attempts: 5,
      claimedAt: new Date("2018-01-01T16:54:00Z"),
      claimedBy: "crashed",
    });
    const send = vi.fn(
      async (): Promise<WhatsAppSendOutcome> => ({
        ok: true,
        kind: "accepted",
        providerId: randomUUID(),
      }),
    );
    const result = await runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(send),
    );
    expect(result.deliveries.dead).toBe(1);
    expect(await stored(id)).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
    });
    expect(await emails()).toMatchObject([
      { kind: "owner_whatsapp_confirmation_failed", bookingId },
    ]);
    await runWhatsAppWorkerOnce(randomUUID(), dependencies(send));
    expect(await emails()).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("enqueues one ordinary owner email per booking after a permanent confirmation failure", async () => {
    now = new Date("2018-01-01T17:00:00Z");
    const first = await enqueue();
    const second = await enqueue();
    const send = vi.fn(
      async (): Promise<WhatsAppSendOutcome> => ({
        ok: false,
        kind: "whatsapp_error",
        code: 131026,
        subcode: null,
        details: null,
        status: 400,
        message: "Provider internals must not appear in owner mail",
      }),
    );
    const result = await runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(send),
    );
    expect(result.deliveries.dead).toBe(2);
    expect(await stored(first)).toMatchObject({
      state: "dead",
      terminalCause: "permanent",
      attempts: 1,
    });
    expect(await stored(second)).toMatchObject({
      state: "dead",
      terminalCause: "permanent",
      attempts: 1,
    });
    expect(await emails()).toMatchObject([
      {
        kind: "owner_whatsapp_confirmation_failed",
        bookingId,
        state: "pending",
        attempts: 0,
        recipient: `confirm-${ownerId.slice(0, 8)}@local.test`,
        providerIdempotencyKey: `owner-whatsapp-confirmation-failed/${bookingId}`,
      },
    ]);
    await runWhatsAppWorkerOnce(randomUUID(), dependencies(send));
    expect(await emails()).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2);
    const wamid = `confirmation-dead/${randomUUID()}`;
    await db
      .update(whatsappDeliveries)
      .set({ providerId: wamid })
      .where(eq(whatsappDeliveries.id, first));
    const callback = {
      wamid,
      recipientId: "16505550086",
      status: "failed" as const,
      timestamp: 1514826060,
      errorCode: "131026",
      errorMessage: "undeliverable",
    };
    await applyWhatsAppStatuses([callback, callback]);
    expect(await emails()).toHaveLength(1);
    expect(await stored(first)).toMatchObject({ state: "dead", attempts: 1 });
  });
  it("stops an unsent confirmation exactly at class start without sending or notifying the owner", async () => {
    const id = await enqueue();
    const send = vi.fn(
      async (): Promise<WhatsAppSendOutcome> => ({
        ok: true,
        kind: "accepted",
        providerId: randomUUID(),
      }),
    );
    const result = await runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(send),
    );
    expect(result.deliveries.dead).toBe(1);
    expect(await stored(id)).toMatchObject({
      state: "dead",
      terminalCause: "stale",
      failureReason: "booking_confirmation_stale",
      attempts: 0,
      claimedBy: null,
      claimedAt: null,
    });
    expect(send).not.toHaveBeenCalled();
    expect(await emails()).toEqual([]);
  });
});
