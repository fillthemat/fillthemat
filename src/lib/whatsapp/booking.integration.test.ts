import { createHmac, randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import { getDb } from "@/db";
import {
  bookings,
  conversations,
  emailDeliveries,
  messages,
  schools,
  trialOccurrences,
  trialOfferings,
  trialWindows,
  users,
  whatsappBookingIntents,
  whatsappDeliveries,
  whatsappJobs,
} from "@/db/schema";
import { hashToken, hashWaId, randomToken } from "@/lib/crypto";
import { listOpenSlots } from "@/lib/schedule/occurrences";
import {
  MAX_BOOKINGS_PER_WA_ID_PER_DAY,
  MAX_CHAT_MESSAGES_PER_CONVERSATION,
  whatsappBookingQuotaExceeded,
} from "@/lib/security/limits";
import { confirmWhatsAppBooking } from "@/lib/whatsapp/booking";
import { WHATSAPP_STUB_APP_SECRET } from "@/lib/whatsapp/config";
import { confirmBookingButtonId } from "@/lib/whatsapp/confirmation";
import {
  type BookingIntentInput,
  upsertPendingBookingIntent,
} from "@/lib/whatsapp/intents";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import { scopedWhatsAppRunner } from "@/test/whatsapp-worker";

loadLocalEnv();

const db = getDb();
const sql = authSql();
const suffix = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const phoneNumberId = `299${Date.now().toString().slice(-9)}`;
const { runWhatsAppWorkerOnce } = scopedWhatsAppRunner(() => [phoneNumberId]);
const slug = `wa-bk-${suffix}`;
const waA = "16505551234";
const waB = "16505559999";
let schoolId = "";
let offeringId = "";
let windowId = "";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", WHATSAPP_STUB_APP_SECRET)
    .update(body)
    .digest("hex")}`;
}

function buttonReplyPayload(waId: string, wamid: string, buttonId: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "test-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "Alex Rivera" }, wa_id: waId }],
              messages: [
                {
                  from: waId,
                  id: wamid,
                  timestamp: "1690000060",
                  type: "interactive",
                  interactive: {
                    type: "button_reply",
                    button_reply: { id: buttonId, title: "Confirm booking" },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function post(payload: unknown): Request {
  const body = JSON.stringify(payload);
  return new Request("http://127.0.0.1:3050/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(body),
    },
    body,
  });
}

async function makeConversation(waId: string): Promise<string> {
  const waIdHash = hashWaId(waId);
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, schoolId),
        eq(conversations.waIdHash, waIdHash),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(conversations)
    .values({
      schoolId,
      resumeTokenHash: hashToken(randomToken()),
      waIdHash,
      expiresAt: addDays(new Date(), 30),
    })
    .returning({ id: conversations.id });
  return requireRow(inserted, "conversation").id;
}

async function seedIntent(
  conversationId: string,
  slotId: string,
  overrides?: Partial<BookingIntentInput>,
): Promise<string> {
  const intent = await upsertPendingBookingIntent({
    schoolId,
    conversationId,
    offeringId,
    slotId,
    participantName: "Alex",
    participantAge: 8,
    ...overrides,
  });
  return intent.id;
}

async function fetchIntent(intentId: string) {
  const [intent] = await db
    .select()
    .from(whatsappBookingIntents)
    .where(eq(whatsappBookingIntents.id, intentId))
    .limit(1);
  return requireRow(intent, "intent");
}

beforeAll(async () => {
  await insertAuthUser(sql, ownerId, `wa-bk-${suffix}@local.test`);
  await db.insert(users).values({
    id: ownerId,
    email: `wa-bk-${suffix}@local.test`,
    name: "WA Booking Owner",
  });
  const [school] = await db
    .insert(schools)
    .values({
      ownerUserId: ownerId,
      name: "WhatsApp Booking School",
      slug,
      timezone: "America/New_York",
      notificationEmail: `wa-bk-${suffix}@local.test`,
      whatsappPhoneNumberId: phoneNumberId,
      approvedAt: new Date(),
      publishedAt: new Date(),
    })
    .returning({ id: schools.id });
  if (!school) throw new Error("failed to seed school");
  schoolId = school.id;

  const [offering] = await db
    .insert(trialOfferings)
    .values({
      schoolId,
      name: "Kids beginner trial",
      minimumAge: 5,
      maximumAge: 12,
      active: true,
    })
    .returning({ id: trialOfferings.id });
  if (!offering) throw new Error("failed to seed offering");
  offeringId = offering.id;

  const [window] = await db
    .insert(trialWindows)
    .values({
      schoolId,
      trialOfferingId: offeringId,
      dayOfWeek: 1,
      startMinute: 18 * 60,
      durationMinutes: 60,
      capacity: 8,
      active: true,
    })
    .returning({ id: trialWindows.id });
  if (!window) throw new Error("failed to seed window");
  windowId = window.id;
});

afterAll(async () => {
  // `whatsapp_jobs.school_id` is `ON DELETE SET NULL`, so enqueued jobs survive
  // the school cascade (the webhook inserts them with NULL school_id). Delete
  // them by the test's phone_number_id so they cannot pollute later runs in the
  // shared local database.
  await db
    .delete(whatsappJobs)
    .where(eq(whatsappJobs.phoneNumberId, phoneNumberId));
  await db.delete(users).where(eq(users.id, ownerId));
  await deleteAuthUser(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("WhatsApp booking funnel (Phase 5)", () => {
  it("a Confirm booking tap after conversation inactivity expires the old intent and sends the expired notice", async () => {
    const waId = "16505550063";
    const conversationId = await makeConversation(waId);
    const intentId = await seedIntent(conversationId, "stale-slot");
    await db
      .update(conversations)
      .set({ expiresAt: addDays(new Date(), -1) })
      .where(eq(conversations.id, conversationId));
    const before = await db
      .select()
      .from(bookings)
      .where(eq(bookings.schoolId, schoolId));
    expect(
      (
        await POST(
          post(
            buttonReplyPayload(
              waId,
              `wamid.inactive-confirm.${suffix}`,
              confirmBookingButtonId(intentId),
            ),
          ),
        )
      ).status,
    ).toBe(200);
    await runWhatsAppWorkerOnce(randomUUID());
    expect((await fetchIntent(intentId)).state).toBe("expired");
    expect(
      await db.select().from(bookings).where(eq(bookings.schoolId, schoolId)),
    ).toEqual(before);
    const [notice] = await db
      .select()
      .from(whatsappDeliveries)
      .where(
        and(
          eq(whatsappDeliveries.schoolId, schoolId),
          eq(whatsappDeliveries.recipientWaId, waId),
        ),
      );
    expect(notice?.body).toBe(
      "That booking option has expired or was replaced. Please ask for available times again.",
    );
    expect(notice?.state).toBe("sent");
  });
  it("confirms a reply-button booking at the message limit: row + occupancy + normal confirmation", async () => {
    const conversationId = await makeConversation(waA);
    await db.insert(messages).values(
      Array.from(
        { length: MAX_CHAT_MESSAGES_PER_CONVERSATION },
        (_, index) => ({
          conversationId,
          messageId: `earlier-${index}`,
          role: index % 2 === 0 ? "user" : "assistant",
          parts: [{ type: "text", text: `Message ${index + 1}` }],
        }),
      ),
    );

    const [window] = await db
      .select()
      .from(trialWindows)
      .where(eq(trialWindows.id, windowId))
      .limit(1);
    const slots = listOpenSlots({
      offeringId,
      timezone: "America/New_York",
      windows: [window],
      occurrences: [],
      now: new Date(),
    });
    const slot = requireRow(slots[0], "open slot");
    const intentId = await seedIntent(conversationId, slot.slotId);

    const wamid = `wamid.book.${suffix}`;
    expect(
      (
        await POST(
          post(
            buttonReplyPayload(waA, wamid, confirmBookingButtonId(intentId)),
          ),
        )
      ).status,
    ).toBe(200);
    const workerNow = new Date();
    await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => new Date(workerNow),
      sleep: async () => {
        throw new Error("unexpected booking pause");
      },
      transport: {
        sendText: async () => ({
          ok: true,
          kind: "accepted",
          providerId: `fake-text:${suffix}`,
        }),
        sendInteractive: async () => ({
          ok: true,
          kind: "accepted",
          providerId: `fake-interactive:${suffix}`,
        }),
        sendTemplate: async () => ({
          ok: true,
          kind: "accepted",
          providerId: `fake-booking:${suffix}`,
        }),
      },
    });

    const bookingRows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.schoolId, schoolId));
    expect(bookingRows).toHaveLength(1);
    const booking = bookingRows[0];
    expect(booking.contactEmailSnapshot).toBeNull();
    expect(booking.contactPhoneSnapshot).toBe(waA);
    expect(booking.conversationId).toBe(conversationId);

    const replies = await db
      .select({ parts: messages.parts })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.role, "assistant"),
        ),
      );
    expect(replies).toContainEqual({
      parts: [
        {
          type: "text",
          text: expect.stringMatching(
            /^Booked! Alex's trial for Kids beginner trial/,
          ),
        },
      ],
    });

    const [occurrence] = await db
      .select()
      .from(trialOccurrences)
      .where(eq(trialOccurrences.id, booking.trialOccurrenceId));
    expect(requireRow(occurrence, "occurrence").bookedCount).toBe(1);

    const [intent] = await db
      .select()
      .from(whatsappBookingIntents)
      .where(eq(whatsappBookingIntents.id, intentId));
    expect(intent?.state).toBe("confirmed");

    const deliveries = await db
      .select()
      .from(whatsappDeliveries)
      .where(eq(whatsappDeliveries.bookingId, booking.id));
    const templateDelivery = deliveries.find(
      (row) => row.templateName === "booking_confirmation",
    );
    expect(templateDelivery).toBeTruthy();
    expect(templateDelivery?.state).toBe("sent");
    expect(templateDelivery?.recipientWaId).toBe(waA);
    expect(templateDelivery?.providerId).toBe(`fake-booking:${suffix}`);
    expect(templateDelivery?.sentAt).toEqual(workerNow);

    const ownerEmails = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.bookingId, booking.id));
    expect(ownerEmails.map((row) => row.kind)).toContain("owner_booking");
  });

  it("does not double-book on a duplicate wamid replay", async () => {
    const wamid = `wamid.book.${suffix}`;

    const before = await db
      .select()
      .from(bookings)
      .where(eq(bookings.schoolId, schoolId));

    // Replay the exact same confirmed button payload (same wamid → job dedupe).
    expect(
      (
        await POST(
          post(
            buttonReplyPayload(
              waA,
              wamid,
              "confirm_booking:a1b2c3d4-0000-0000-0000-000000000000",
            ),
          ),
        )
      ).status,
    ).toBe(200);
    await runWhatsAppWorkerOnce(randomUUID());

    const after = await db
      .select()
      .from(bookings)
      .where(eq(bookings.schoolId, schoolId));
    expect(after).toHaveLength(before.length);

    const occurrences = await db
      .select()
      .from(trialOccurrences)
      .where(eq(trialOccurrences.schoolId, schoolId));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].bookedCount).toBe(1);
  });

  it("returns the 429-equivalent (rate limited) once the per-wa_id cap is hit", async () => {
    const conversationB = await makeConversation(waB);

    // One window per weekday so each confirmation books a distinct occurrence.
    const windows = await db
      .select()
      .from(trialWindows)
      .where(eq(trialWindows.schoolId, schoolId));
    for (let day = 2; day <= 6; day += 1) {
      const [extra] = await db
        .insert(trialWindows)
        .values({
          schoolId,
          trialOfferingId: offeringId,
          dayOfWeek: day,
          startMinute: 18 * 60,
          durationMinutes: 60,
          capacity: 8,
          active: true,
        })
        .returning();
      if (extra) windows.push(extra);
    }

    const allSlots = listOpenSlots({
      offeringId,
      timezone: "America/New_York",
      windows,
      occurrences: [],
      now: new Date(),
    });
    const slotsPerWindow = new Map<string, string>();
    for (const slot of allSlots) {
      if (!slotsPerWindow.has(slot.windowId)) {
        slotsPerWindow.set(slot.windowId, slot.slotId);
      }
    }
    const slotIds = [...slotsPerWindow.values()].slice(
      0,
      MAX_BOOKINGS_PER_WA_ID_PER_DAY,
    );
    expect(slotIds).toHaveLength(MAX_BOOKINGS_PER_WA_ID_PER_DAY);

    for (let i = 0; i < MAX_BOOKINGS_PER_WA_ID_PER_DAY; i += 1) {
      const intentId = await seedIntent(conversationB, slotIds[i], {
        participantName: `Kid ${i}`,
      });
      const outcome = await confirmWhatsAppBooking({
        schoolId,
        conversationId: conversationB,
        intent: await fetchIntent(intentId),
        waId: waB,
        phoneNumberId,
        wamid: `wamid.quota.${i}.${suffix}`,
        profileName: "Alex Rivera",
        runId: randomUUID(),
      });
      expect(outcome.status).toBe("booked");
    }

    expect(await whatsappBookingQuotaExceeded(schoolId, waB)).toBe(true);

    // A fresh confirmation now trips the cap and returns the 429-equivalent.
    const intentId = await seedIntent(conversationB, slotIds[0], {
      participantName: "Kid over cap",
    });
    const outcome = await confirmWhatsAppBooking({
      schoolId,
      conversationId: conversationB,
      intent: await fetchIntent(intentId),
      waId: waB,
      phoneNumberId,
      wamid: `wamid.quota.over.${suffix}`,
      profileName: "Alex Rivera",
      runId: randomUUID(),
    });
    expect(outcome.status).toBe("rate_limited");

    const [stillPending] = await db
      .select()
      .from(whatsappBookingIntents)
      .where(eq(whatsappBookingIntents.id, intentId));
    expect(stillPending?.state).toBe("pending");

    const notices = await db
      .select()
      .from(whatsappDeliveries)
      .where(
        eq(
          whatsappDeliveries.providerIdempotencyKey,
          `wa-notice/${waB}/wamid.quota.over.${suffix}`,
        ),
      );
    expect(notices).toHaveLength(1);
  }, 60_000);
});
