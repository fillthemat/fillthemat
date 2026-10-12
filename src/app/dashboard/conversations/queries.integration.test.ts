import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  contacts,
  conversations,
  messages,
  schools,
  trialOfferings,
  users,
  whatsappBookingIntents,
} from "@/db/schema";
import { findOrCreateConversation } from "@/lib/conversations/conversation-store";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import { loadConversation, loadConversations } from "./queries";

loadLocalEnv();
const sql = authSql();
const db = getDb();
const suffix = randomUUID();
const owners = [randomUUID(), randomUUID()];
let schoolA = "";
let schoolB = "";
let webId = "";
let whatsappId = "";

beforeAll(async () => {
  const schoolIds: string[] = [];
  for (const owner of owners) {
    const email = `${owner}@local.test`;
    await insertAuthUser(sql, owner, email);
    await db.insert(users).values({ id: owner, email });
    const [school] = await db
      .insert(schools)
      .values({
        ownerUserId: owner,
        name: "Conversations school",
        slug: `conv-${owner.slice(0, 8)}`,
        timezone: "America/New_York",
        notificationEmail: email,
      })
      .returning();
    schoolIds.push(requireRow(school, "school").id);
  }
  schoolA = requireRow(schoolIds[0], "school A");
  schoolB = requireRow(schoolIds[1], "school B");

  const web = await findOrCreateConversation({
    schoolId: schoolA,
    identity: { channel: "web", resumeToken: `web-${suffix}` },
  });
  const whatsapp = await findOrCreateConversation({
    schoolId: schoolA,
    identity: { channel: "whatsapp", waId: `wa-${suffix}` },
  });
  if (!web.ok || !whatsapp.ok) throw new Error("conversation creation failed");
  webId = web.conversation.id;
  whatsappId = whatsapp.conversation.id;
  const [contact] = await db
    .insert(contacts)
    .values({
      schoolId: schoolA,
      name: "Alex",
      phone: "+15550100100",
      email: "alex@local.test",
    })
    .returning();
  await db
    .update(conversations)
    .set({ createdAt: new Date("2026-10-01T12:00:00Z") })
    .where(eq(conversations.id, webId));
  await db
    .update(conversations)
    .set({
      contactId: requireRow(contact, "contact").id,
      createdAt: new Date("2026-10-02T12:00:00Z"),
      endedAt: new Date("2026-10-03T12:00:00Z"),
      endReason: "inactivity",
    })
    .where(eq(conversations.id, whatsappId));
});

afterAll(async () => {
  for (const owner of owners) await deleteAuthUser(sql, owner);
  await sql.end({ timeout: 5 });
});

describe("Conversations tab queries", () => {
  it("filters conversation start dates inclusively in the school's timezone", async () => {
    const rows = await loadConversations(schoolA, {
      from: "2026-10-02",
      to: "2026-10-02",
    });
    expect(rows.map(({ id }) => id)).toEqual([whatsappId]);
    expect(await loadConversations(schoolA, { from: "2026-10-03" })).toEqual(
      [],
    );
    expect(
      (await loadConversations(schoolA, { to: "2026-10-01" })).map(
        ({ id }) => id,
      ),
    ).toEqual([webId]);
  });

  it("lists both channels newest first, including ended history and known or unknown contacts", async () => {
    const rows = await loadConversations(schoolA);
    expect(rows.map(({ id, channel }) => ({ id, channel }))).toEqual([
      { id: whatsappId, channel: "whatsapp" },
      { id: webId, channel: "web" },
    ]);
    expect(rows[0]?.contact).toEqual({
      name: "Alex",
      phone: "+15550100100",
      email: "alex@local.test",
    });
    expect(rows[1]?.contact).toBeNull();
  });

  it("finds contacts by name, email, or phone without treating search text as SQL wildcards", async () => {
    for (const contact of [" aLEX ", "ALEX@LOCAL", "0100100"]) {
      expect(
        (await loadConversations(schoolA, { contact })).map(({ id }) => id),
      ).toEqual([whatsappId]);
    }
    expect(await loadConversations(schoolA, { contact: "%" })).toEqual([]);
    expect(await loadConversations(schoolA, { contact: "_" })).toEqual([]);
    expect(await loadConversations(schoolA, { contact: "unknown" })).toEqual(
      [],
    );
    expect(
      await loadConversations(schoolA, { contact: "Alex", to: "2026-10-01" }),
    ).toEqual([]);
    expect(await loadConversations(schoolB, { contact: "Alex" })).toEqual([]);
    expect(
      (await loadConversations(schoolA, { contact: " " })).map(({ id }) => id),
    ).toEqual([whatsappId, webId]);
  });

  it("opens an ordered transcript with timestamps and only public message text", async () => {
    await db.insert(messages).values([
      {
        conversationId: whatsappId,
        messageId: "reply",
        role: "assistant",
        createdAt: new Date("2026-10-02T12:01:00Z"),
        parts: [
          { type: "reasoning", text: "Private reasoning" },
          { type: "text", text: "Yes, beginners are welcome." },
          { type: "tool-listTrialOfferings", output: { internal: true } },
        ],
      },
      {
        conversationId: whatsappId,
        messageId: "question",
        role: "user",
        createdAt: new Date("2026-10-02T12:00:00Z"),
        parts: [{ type: "text", text: "Can beginners join?" }],
      },
    ]);
    const transcript = await loadConversation(schoolA, whatsappId);
    expect(transcript?.channel).toBe("whatsapp");
    expect(transcript?.messages).toEqual([
      expect.objectContaining({
        role: "user",
        text: "Can beginners join?",
        createdAt: new Date("2026-10-02T12:00:00Z"),
      }),
      expect.objectContaining({
        role: "assistant",
        text: "Yes, beginners are welcome.",
        createdAt: new Date("2026-10-02T12:01:00Z"),
      }),
    ]);
  });

  it("never lists or opens another school's conversations, even with a known ID", async () => {
    const other = await findOrCreateConversation({
      schoolId: schoolB,
      identity: { channel: "web", resumeToken: `other-${suffix}` },
    });
    if (!other.ok) throw new Error("other conversation creation failed");
    expect((await loadConversations(schoolB)).map(({ id }) => id)).toEqual([
      other.conversation.id,
    ]);
    expect((await loadConversations(schoolA)).map(({ id }) => id)).toEqual([
      whatsappId,
      webId,
    ]);
    expect(await loadConversation(schoolB, whatsappId)).toBeUndefined();
    expect(
      await loadConversation(schoolA, other.conversation.id),
    ).toBeUndefined();
    expect(await loadConversation(schoolA, randomUUID())).toBeUndefined();
    expect((await loadConversation(schoolA, webId))?.messages).toEqual([]);
  });

  it("keeps the contact before the reply when a committed turn shares a timestamp", async () => {
    const createdAt = new Date("2026-10-01T12:00:00Z");
    await db.insert(messages).values([
      {
        id: `f${randomUUID().slice(1)}`,
        conversationId: webId,
        messageId: "tied-question",
        role: "user",
        createdAt,
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: `0${randomUUID().slice(1)}`,
        conversationId: webId,
        messageId: "tied-reply",
        role: "assistant",
        createdAt,
        parts: [{ type: "text", text: "Welcome" }],
      },
    ]);
    const transcript = await loadConversation(schoolA, webId);
    expect(transcript?.messages.map(({ text }) => text)).toEqual([
      "Hello",
      "Welcome",
    ]);
  });

  it("marks each successful web Booking Intent at its persisted message timestamp without exposing tool data", async () => {
    const web = await findOrCreateConversation({
      schoolId: schoolA,
      identity: { channel: "web", resumeToken: `markers-${suffix}` },
    });
    if (!web.ok) throw new Error("conversation creation failed");
    const createdAt = new Date("2026-10-02T12:02:00Z");
    await db.insert(messages).values({
      conversationId: web.conversation.id,
      messageId: "web-intents",
      role: "assistant",
      createdAt,
      parts: [
        {
          type: "tool-prepare_booking",
          state: "output-available",
          toolCallId: "failed",
          output: { ok: false, reason: "slot_unavailable" },
        },
        {
          type: "tool-prepare_booking",
          state: "input-available",
          toolCallId: "unfinished",
          input: { private: "hidden" },
        },
        {
          type: "tool-prepare_booking",
          state: "output-available",
          toolCallId: "success",
          output: {
            ok: true,
            offering: { id: randomUUID(), name: "Beginners" },
            slot: { slotId: "test-slot" },
            participantName: "Private participant",
          },
        },
        { type: "text", text: "Would you like to confirm?" },
      ],
    });
    const transcript = await loadConversation(schoolA, web.conversation.id);
    expect(transcript?.bookingIntents).toEqual([
      { id: expect.any(String), createdAt },
    ]);
    expect(transcript?.messages[0]?.text).toBe("Would you like to confirm?");
    expect(JSON.stringify(transcript)).not.toContain("Private participant");
    expect(
      await loadConversation(schoolB, web.conversation.id),
    ).toBeUndefined();
  });

  it("keeps superseded, expired, confirmed, and pending WhatsApp intent markers in creation order and scoped to the school", async () => {
    const [offering] = await db
      .insert(trialOfferings)
      .values({ schoolId: schoolA, name: "Beginners" })
      .returning();
    const dates = [
      "2026-10-02T12:00:30Z",
      "2026-10-02T12:01:30Z",
      "2026-10-02T12:02:30Z",
      "2026-10-02T12:03:30Z",
    ].map((date) => new Date(date));
    const states = ["superseded", "expired", "confirmed", "pending"] as const;
    await db.insert(whatsappBookingIntents).values(
      states.map((state, index) => ({
        schoolId: schoolA,
        conversationId: whatsappId,
        offeringId: requireRow(offering, "offering").id,
        slotId: "test-slot",
        state,
        participantName: "Private participant",
        createdAt: requireRow(dates[index], "creation date"),
        expiresAt: new Date("2026-10-02T13:00:00Z"),
      })),
    );
    const transcript = await loadConversation(schoolA, whatsappId);
    expect(transcript?.bookingIntents).toEqual(
      dates.map((createdAt) => ({ id: expect.any(String), createdAt })),
    );
    expect(JSON.stringify(transcript)).not.toContain("Private participant");
    expect(await loadConversation(schoolB, whatsappId)).toBeUndefined();
    expect((await loadConversation(schoolA, webId))?.bookingIntents).toEqual(
      [],
    );
  });

  it("includes both midnight boundaries correctly across a daylight-saving change", async () => {
    const dates = [
      "2026-11-01T03:59:59Z",
      "2026-11-01T04:00:00Z",
      "2026-11-02T04:59:59Z",
      "2026-11-02T05:00:00Z",
    ];
    const ids: string[] = [];
    for (const date of dates) {
      const [conversation] = await db
        .insert(conversations)
        .values({
          schoolId: schoolB,
          channel: "web",
          resumeTokenHash: randomUUID(),
          expiresAt: new Date("2026-12-01T00:00:00Z"),
          createdAt: new Date(date),
        })
        .returning();
      ids.push(requireRow(conversation, "boundary conversation").id);
    }
    expect(
      (
        await loadConversations(schoolB, {
          from: "2026-11-01",
          to: "2026-11-01",
        })
      ).map(({ id }) => id),
    ).toEqual([ids[2], ids[1]]);
    expect(
      await loadConversations(schoolA, {
        from: "2026-11-01",
        to: "2026-11-01",
      }),
    ).toEqual([]);
  });

  it("rejects invalid or reversed date ranges instead of silently showing unfiltered history", async () => {
    await expect(
      loadConversations(schoolA, { from: "2026-02-30" }),
    ).rejects.toThrow();
    await expect(
      loadConversations(schoolA, { from: "2026-10-03", to: "2026-10-01" }),
    ).rejects.toThrow();
  });
});
