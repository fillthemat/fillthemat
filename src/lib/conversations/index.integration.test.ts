import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import {
  type ConversationIdentity,
  claimGeneration,
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
});
