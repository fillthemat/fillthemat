import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
  faqs,
  schools,
  trialOfferings,
  trialWindows,
  users,
} from "@/db/schema";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import {
  insertFaq,
  insertOffering,
  MISSING_FAQ,
  MISSING_OFFERING,
  STALE_EDIT,
  setOfferingActive,
  updateFaq,
  updateOffering,
  updateProfile,
} from "./mutations";
import { LIMITS, profileSchema } from "./schemas";

loadLocalEnv();

const sql = authSql();
const db = getDb();

const ownerA = randomUUID();
const ownerB = randomUUID();
const suffix = randomUUID().slice(0, 8);
const slugA = `mut-a-${suffix}`;
const slugB = `mut-b-${suffix}`;

let schoolA = "";
let schoolB = "";
let offeringA = "";
let windowA = "";

beforeAll(async () => {
  await insertAuthUser(sql, ownerA, `mut-a-${suffix}@local.test`);
  await insertAuthUser(sql, ownerB, `mut-b-${suffix}@local.test`);
  await db.insert(users).values([
    { id: ownerA, email: `mut-a-${suffix}@local.test`, name: "A" },
    { id: ownerB, email: `mut-b-${suffix}@local.test`, name: "B" },
  ]);
  const [a] = await db
    .insert(schools)
    .values({
      ownerUserId: ownerA,
      name: "Mutation School A",
      slug: slugA,
      timezone: "America/New_York",
      notificationEmail: `mut-a-${suffix}@local.test`,
      city: "Brooklyn",
    })
    .returning({ id: schools.id });
  const [b] = await db
    .insert(schools)
    .values({
      ownerUserId: ownerB,
      name: "Mutation School B",
      slug: slugB,
      timezone: "America/Chicago",
      notificationEmail: `mut-b-${suffix}@local.test`,
      city: "Austin",
    })
    .returning({ id: schools.id });
  if (!a || !b) throw new Error("Could not insert test schools");
  schoolA = a.id;
  schoolB = b.id;

  const created = await insertOffering(db, schoolA, {
    name: "Kids beginner trial",
    description: "Original description",
    minimumAge: 5,
    maximumAge: 12,
    attire: "Gi",
    expectations: "Warm-up",
    waiverNotes: "Keep this waiver note",
  });
  offeringA = created.values?.id ?? "";
  if (!offeringA) throw new Error("Could not create offering");

  const [window] = await db
    .insert(trialWindows)
    .values({
      schoolId: schoolA,
      trialOfferingId: offeringA,
      dayOfWeek: 1,
      startMinute: 18 * 60,
      durationMinutes: 60,
      capacity: 8,
      active: true,
    })
    .returning({ id: trialWindows.id });
  if (!window) throw new Error("Could not create window");
  windowA = window.id;
});

afterAll(async () => {
  await deleteAuthUser(sql, ownerA);
  await deleteAuthUser(sql, ownerB);
  await sql.end({ timeout: 5 });
});

describe("updateProfile", () => {
  it("sets, edits and clears a public contact email independently of private notifications", async () => {
    for (const [email, expected] of [
      ["  HELLO@school.test  ", "hello@school.test"],
      ["frontdesk@school.test", "frontdesk@school.test"],
      ["", ""],
    ]) {
      const result = await updateProfile(db, schoolA, {
        ...profileSchema.parse({
          name: "Mutation School A",
          publicContactEmail: email,
          notificationEmail: `mut-a-${suffix}@local.test`,
          phone: "+15125550100",
          website: "",
          address: "",
          city: "Brooklyn",
          country: "US",
          parkingNotes: "",
          accessNotes: "",
          trialGuidance: "",
        }),
        slug: slugA,
        timezone: "America/New_York",
      });
      expect(result.status).toBe("success");
      expect(result.values?.publicContactEmail).toBe(expected);
      expect(result.values?.notificationEmail).toBe(
        `mut-a-${suffix}@local.test`,
      );
      const [saved] = await db
        .select()
        .from(schools)
        .where(eq(schools.id, schoolA));
      expect(saved?.publicContactEmail).toBe(expected || null);
      expect(saved?.notificationEmail).toBe(`mut-a-${suffix}@local.test`);
      const [other] = await db
        .select()
        .from(schools)
        .where(eq(schools.id, schoolB));
      expect(other?.publicContactEmail).toBeNull();
      expect(other?.notificationEmail).toBe(`mut-b-${suffix}@local.test`);
    }
  });
});

describe("updateOffering", () => {
  it("updates the existing id and preserves hidden fields and schedule links", async () => {
    const [before] = await db
      .select()
      .from(trialOfferings)
      .where(eq(trialOfferings.id, offeringA));
    if (!before) throw new Error("missing offering");

    const result = await updateOffering(
      db,
      schoolA,
      offeringA,
      before.updatedAt,
      {
        name: "Kids intro class",
        description: "Corrected description",
        minimumAge: 6,
        maximumAge: 11,
        attire: "Comfortable clothes",
        expectations: "Games and basics",
      },
    );
    expect(result.status).toBe("success");
    expect(result.values?.id).toBe(offeringA);

    const [after] = await db
      .select()
      .from(trialOfferings)
      .where(eq(trialOfferings.id, offeringA));
    expect(after?.name).toBe("Kids intro class");
    expect(after?.minimumAge).toBe(6);
    expect(after?.maximumAge).toBe(11);
    expect(after?.waiverNotes).toBe("Keep this waiver note");
    expect(after?.active).toBe(true);

    const linked = await db
      .select({ id: trialWindows.id })
      .from(trialWindows)
      .where(
        and(
          eq(trialWindows.id, windowA),
          eq(trialWindows.trialOfferingId, offeringA),
        ),
      );
    expect(linked).toHaveLength(1);
  });

  it("does not report success for a foreign school's id", async () => {
    const foreign = await insertOffering(db, schoolB, {
      name: "Other school class",
      description: null,
      minimumAge: null,
      maximumAge: null,
      attire: null,
      expectations: null,
    });
    const foreignId = requireRow(foreign.values?.id, "foreign id");
    const [row] = await db
      .select()
      .from(trialOfferings)
      .where(eq(trialOfferings.id, foreignId));
    const result = await updateOffering(
      db,
      schoolA,
      foreignId,
      requireRow(row, "foreign offering").updatedAt,
      {
        name: "Hijack",
        description: null,
        minimumAge: null,
        maximumAge: null,
        attire: null,
        expectations: null,
      },
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(MISSING_OFFERING);
    expect(result.message).not.toMatch(/Other school/);
    const [unchanged] = await db
      .select()
      .from(trialOfferings)
      .where(eq(trialOfferings.id, foreignId));
    expect(unchanged?.name).toBe("Other school class");
  });

  it("rejects a stale updatedAt and keeps typed values on the client contract", async () => {
    const [current] = await db
      .select()
      .from(trialOfferings)
      .where(eq(trialOfferings.id, offeringA));
    const currentRow = requireRow(current, "current offering");
    const stale = new Date(currentRow.updatedAt.getTime() - 60_000);
    const result = await updateOffering(db, schoolA, offeringA, stale, {
      name: "Should not land",
      description: currentRow.description,
      minimumAge: currentRow.minimumAge,
      maximumAge: currentRow.maximumAge,
      attire: currentRow.attire,
      expectations: currentRow.expectations,
    });
    expect(result.status).toBe("error");
    expect(result.message).toBe(STALE_EDIT);
    const [after] = await db
      .select()
      .from(trialOfferings)
      .where(eq(trialOfferings.id, offeringA));
    expect(after?.name).not.toBe("Should not land");
  });
});

describe("setOfferingActive", () => {
  it("uses the desired state instead of inverting", async () => {
    const first = await setOfferingActive(db, schoolA, offeringA, false);
    expect(first.status).toBe("success");
    const [off] = await db
      .select()
      .from(trialOfferings)
      .where(eq(trialOfferings.id, offeringA));
    expect(off?.active).toBe(false);

    const again = await setOfferingActive(db, schoolA, offeringA, false);
    expect(again.status).toBe("success");
    expect(again.message).toMatch(/already not offered/);
    expect(again.values?.unchanged).toBe("true");

    const on = await setOfferingActive(db, schoolA, offeringA, true);
    expect(on.status).toBe("success");
    const [restored] = await db
      .select()
      .from(trialOfferings)
      .where(eq(trialOfferings.id, offeringA));
    expect(restored?.active).toBe(true);
  });
});

describe("updateFaq", () => {
  it("edits in place at the 20-question limit without changing count or order", async () => {
    const existing = await db
      .select({ id: faqs.id })
      .from(faqs)
      .where(eq(faqs.schoolId, schoolA));
    const toCreate = LIMITS.faqCount - existing.length;
    for (let i = 0; i < toCreate; i += 1) {
      const result = await insertFaq(db, schoolA, {
        question: `Question ${i + 1} ${suffix}?`,
        answer: `Answer ${i + 1}`,
      });
      expect(result.status).toBe("success");
    }
    const rows = await db.select().from(faqs).where(eq(faqs.schoolId, schoolA));
    expect(rows).toHaveLength(LIMITS.faqCount);
    const order = rows.map((row) => row.sortOrder);

    const blocked = await insertFaq(db, schoolA, {
      question: "One more?",
      answer: "Should not insert",
    });
    expect(blocked.status).toBe("error");

    const target = requireRow(rows[rows.length - 1], "faq");
    const updated = await updateFaq(db, schoolA, target.id, target.updatedAt, {
      question: target.question,
      answer: "Corrected answer at the limit.",
    });
    expect(updated.status).toBe("success");
    expect(updated.values?.id).toBe(target.id);

    const after = await db
      .select()
      .from(faqs)
      .where(eq(faqs.schoolId, schoolA));
    expect(after).toHaveLength(LIMITS.faqCount);
    expect(after.map((row) => row.sortOrder)).toEqual(order);
    expect(after.find((row) => row.id === target.id)?.answer).toBe(
      "Corrected answer at the limit.",
    );
  });

  it("does not report success for a missing FAQ", async () => {
    const result = await updateFaq(db, schoolA, randomUUID(), new Date(), {
      question: "Gone?",
      answer: "No",
    });
    expect(result.status).toBe("error");
    expect(result.message).toBe(MISSING_FAQ);
  });
});
