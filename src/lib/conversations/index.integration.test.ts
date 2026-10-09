import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import {
  attachConversationContact,
  type ConversationIdentity,
  claimGeneration,
  endConversation,
  findConversation,
  findOrCreateConversation,
} from ".";

loadLocalEnv();
const sql = authSql();
const ownerIds = [randomUUID(), randomUUID()];
const schoolIds: string[] = [];

beforeAll(async () => {
  for (const ownerId of ownerIds) {
    const { schoolId } = await seedSchool(sql, {
      ownerId,
      name: "Conversations School",
      slug: `conversations-${ownerId.slice(0, 8)}`,
      offerings: [{ name: "Trial", active: true }],
    });
    schoolIds.push(schoolId);
  }
});

afterAll(async () => {
  for (const ownerId of ownerIds) await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("conversations", () => {
  it.each(["ended", "past-deadline"] as const)(
    "Book Trial does not attach a contact to a %s conversation",
    async (state) => {
      const resolved = await findOrCreateConversation({
        schoolId: schoolIds[0],
        identity: { channel: "web", resumeToken: randomUUID() },
        now:
          state === "past-deadline"
            ? new Date("2026-01-01T00:00:00.000Z")
            : undefined,
      });
      if (!resolved.ok) throw new Error("conversation refused");
      if (state === "ended")
        await endConversation(resolved.conversation.id, "message_limit");
      const [contact] =
        await sql`insert into app.contacts (school_id, name, phone) values (${schoolIds[0]}, 'Book Trial contact', ${randomUUID()}) returning id`;
      expect(
        await attachConversationContact({
          schoolId: schoolIds[0],
          conversationId: resolved.conversation.id,
          contactId: contact.id,
        }),
      ).toBeUndefined();
      const [kept] =
        await sql`select contact_id from app.conversations where id = ${resolved.conversation.id}`;
      expect(kept.contact_id).toBeNull();
    },
  );
  it.each(["inactivity", "message_limit"] as const)(
    "ending for %s is terminal and idempotent, and an ended web token still belongs to its school",
    async (reason) => {
      const identity: ConversationIdentity = {
        channel: "web",
        resumeToken: randomUUID(),
      };
      const input = { schoolId: schoolIds[0], identity };
      const original = await findOrCreateConversation(input);
      if (!original.ok) throw new Error("conversation refused");
      expect(await endConversation(original.conversation.id, reason)).toBe(
        true,
      );
      expect(await endConversation(original.conversation.id, reason)).toBe(
        false,
      );
      expect(await findConversation(input)).toBeUndefined();
      expect(await claimGeneration(original.conversation.id)).toBeUndefined();
      expect(
        await findOrCreateConversation({ schoolId: schoolIds[1], identity }),
      ).toEqual({ ok: false, reason: "invalid_conversation" });
      const replacement = await findOrCreateConversation(input);
      if (!replacement.ok) throw new Error("conversation refused");
      expect(replacement.conversation.id).not.toBe(original.conversation.id);
    },
  );
  it.each(["web", "whatsapp"] as const)(
    "find on %s hides a past-deadline conversation without creating another",
    async (channel) => {
      const identity: ConversationIdentity =
        channel === "web"
          ? { channel, resumeToken: randomUUID() }
          : { channel, waId: randomUUID() };
      const input = { schoolId: schoolIds[0], identity };
      const original = await findOrCreateConversation({
        ...input,
        now: new Date("2026-01-01T12:00:00.000Z"),
      });
      expect(original.ok).toBe(true);
      expect(
        await findConversation({
          ...input,
          now: new Date("2026-01-31T12:00:00.000Z"),
        }),
      ).toBeUndefined();
    },
  );
  it.each(["web", "whatsapp"] as const)(
    "concurrent messages on %s replace an inactive conversation once and keep its record",
    async (channel) => {
      const identity: ConversationIdentity =
        channel === "web"
          ? { channel, resumeToken: randomUUID() }
          : { channel, waId: randomUUID() };
      const input = { schoolId: schoolIds[0], identity };
      const original = await findOrCreateConversation({
        ...input,
        now: new Date("2026-01-01T12:00:00.000Z"),
      });
      if (!original.ok) throw new Error("conversation refused");
      const now = new Date("2026-01-31T12:00:00.000Z");
      const replacements = await Promise.all(
        Array.from({ length: 8 }, () =>
          findOrCreateConversation({ ...input, now }),
        ),
      );
      const ids = replacements.map((result) => {
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("conversation refused");
        return result.conversation.id;
      });
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).not.toBe(original.conversation.id);
      expect((await findConversation({ ...input, now }))?.id).toBe(ids[0]);
      const [kept] =
        await sql`select ended_at, end_reason from app.conversations where id = ${original.conversation.id}`;
      expect(kept).toEqual({ ended_at: now, end_reason: "inactivity" });
    },
  );

  it.each(["web", "whatsapp"] as const)(
    "concurrent first messages on %s resolve to one conversation",
    async (channel) => {
      const identity: ConversationIdentity =
        channel === "web"
          ? { channel, resumeToken: randomUUID() }
          : { channel, waId: randomUUID() };
      const input = { schoolId: schoolIds[0], identity };
      const results = await Promise.all(
        Array.from({ length: 8 }, () => findOrCreateConversation(input)),
      );
      const ids = results.map((result) => {
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("conversation refused");
        return result.conversation.id;
      });
      expect(new Set(ids).size).toBe(1);
      expect((await findConversation(input))?.id).toBe(ids[0]);
    },
  );

  it("refuses a web resume token belonging to another school", async () => {
    const identity: ConversationIdentity = {
      channel: "web",
      resumeToken: randomUUID(),
    };
    const original = await findOrCreateConversation({
      schoolId: schoolIds[0],
      identity,
    });
    expect(original.ok).toBe(true);
    expect(
      await findOrCreateConversation({ schoolId: schoolIds[1], identity }),
    ).toEqual({ ok: false, reason: "invalid_conversation" });
    expect(
      await findConversation({ schoolId: schoolIds[1], identity }),
    ).toBeUndefined();
    if (!original.ok) throw new Error("conversation refused");
    expect(
      (await findConversation({ schoolId: schoolIds[0], identity }))?.id,
    ).toBe(original.conversation.id);
  });

  it("claims generation exclusively and releases its lock idempotently", async () => {
    const result = await findOrCreateConversation({
      schoolId: schoolIds[0],
      identity: { channel: "web", resumeToken: randomUUID() },
    });
    if (!result.ok) throw new Error("conversation refused");
    const id = result.conversation.id;
    const lock = await claimGeneration(id);
    expect(lock).toBeDefined();
    expect(await claimGeneration(id)).toBeUndefined();
    if (!lock) throw new Error("lock not claimed");
    await Promise.all([lock.release(), lock.release()]);
    const nextLock = await claimGeneration(id);
    expect(nextLock).toBeDefined();
    await lock.release();
    expect(await claimGeneration(id)).toBeUndefined();
    await nextLock?.release();
  });

  it("takes an abandoned generation lock only after more than ten minutes", async () => {
    const result = await findOrCreateConversation({
      schoolId: schoolIds[0],
      identity: { channel: "web", resumeToken: randomUUID() },
    });
    if (!result.ok) throw new Error("conversation refused");
    const id = result.conversation.id;
    const abandonedAt = new Date("2026-10-09T12:00:00.000Z");
    const abandoned = await claimGeneration(id, { now: abandonedAt });
    expect(abandoned).toBeDefined();
    expect(
      await claimGeneration(id, { now: new Date("2026-10-09T12:09:59.999Z") }),
    ).toBeUndefined();
    expect(
      await claimGeneration(id, { now: new Date("2026-10-09T12:10:00.000Z") }),
    ).toBeUndefined();

    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        claimGeneration(id, { now: new Date("2026-10-09T12:10:00.001Z") }),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    const recovered = claims.find(Boolean);
    expect(recovered).toBeDefined();
    await abandoned?.release();
    expect(
      await claimGeneration(id, { now: new Date("2026-10-09T12:10:00.002Z") }),
    ).toBeUndefined();
    await recovered?.release();
  });
});
