import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { contacts, conversations, messages, schools, users } from "@/db/schema";
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
});
