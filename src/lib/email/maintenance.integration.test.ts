import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  conversations,
  cronRuns,
  messages,
  whatsappBookingIntents,
} from "@/db/schema";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { runMaintenance } from "./maintenance";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
let schoolId = "";
let offeringId = "";
const runIds: string[] = [];

beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "Maintenance School",
    slug: `maintenance-${ownerId}`,
    offerings: [{ name: "Trial" }],
  });
  schoolId = seeded.schoolId;
  offeringId = requireRow(seeded.offeringIds[0], "offering");
});
afterAll(async () => {
  for (const id of runIds) await db.delete(cronRuns).where(eq(cronRuns.id, id));
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("maintenance", () => {
  it("ends inactive conversations including abandoned locks, expires pending intents, and keeps every message intact", async () => {
    const now = new Date();
    const oldDeadline = addDays(now, -1);
    const rows = await db
      .insert(conversations)
      .values([
        { schoolId, resumeTokenHash: randomUUID(), expiresAt: oldDeadline },
        {
          schoolId,
          resumeTokenHash: randomUUID(),
          expiresAt: oldDeadline,
          generatingAt: new Date(now.getTime() - 11 * 60_000),
        },
        { schoolId, resumeTokenHash: randomUUID(), expiresAt: addDays(now, 1) },
      ])
      .returning();
    const inactive = requireRow(rows[0], "inactive conversation");
    const abandoned = requireRow(rows[1], "abandoned conversation");
    const active = requireRow(rows[2], "active conversation");
    const content = [{ type: "text", text: "Keep my enquiry" }];
    const saved = await db
      .insert(messages)
      .values(
        rows.map(({ id }) => ({
          conversationId: id,
          messageId: randomUUID(),
          role: "user",
          parts: content,
        })),
      )
      .returning();
    const [intent] = await db
      .insert(whatsappBookingIntents)
      .values({
        schoolId,
        conversationId: abandoned.id,
        offeringId,
        slotId: "pending-slot",
        expiresAt: addDays(now, 1),
      })
      .returning();
    const run = await runMaintenance();
    runIds.push(run.id);
    expect(run.result).toBe("success");
    expect(run.endedConversationCount).toBe(2);
    const [recordedRun] = await db
      .select()
      .from(cronRuns)
      .where(eq(cronRuns.id, run.id));
    expect(recordedRun?.endedConversationCount).toBe(2);
    const kept = await db
      .select()
      .from(conversations)
      .where(eq(conversations.schoolId, schoolId));
    expect(kept).toHaveLength(3);
    for (const id of [inactive.id, abandoned.id]) {
      const ended = kept.find((row) => row.id === id);
      expect(ended?.endReason).toBe("inactivity");
      expect(ended?.endedAt).toBeInstanceOf(Date);
    }
    expect(kept.find(({ id }) => id === active.id)?.endedAt).toBeNull();
    for (const message of saved) {
      const [keptMessage] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, message.id));
      expect(keptMessage?.parts).toEqual(content);
    }
    const [expired] = await db
      .select()
      .from(whatsappBookingIntents)
      .where(eq(whatsappBookingIntents.id, requireRow(intent, "intent").id));
    expect(expired?.state).toBe("expired");
    const again = await runMaintenance();
    runIds.push(again.id);
    expect(again.endedConversationCount).toBe(0);
    expect(
      await db
        .select()
        .from(conversations)
        .where(eq(conversations.schoolId, schoolId)),
    ).toEqual(kept);
  });
});
