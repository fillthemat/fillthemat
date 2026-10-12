import { and, eq, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Database } from "@/db";
import { faqs, schools, trialOfferings } from "@/db/schema";
import { errorState, type SettingsFormState, successState } from "./form-state";
import { nullToEmpty, serializeTimestamp } from "./form-utils";
import { LIMITS, type profileSchema } from "./schemas";

export async function updateProfile(
  db: Database,
  schoolId: string,
  input: z.output<typeof profileSchema> & { slug: string; timezone: string },
): Promise<SettingsFormState> {
  const [saved] = await db
    .update(schools)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(schools.id, schoolId))
    .returning();
  if (!saved)
    return errorState("That school no longer exists. Refresh the page.");
  return successState("School details saved. Your agent uses them now.", {
    name: saved.name,
    slug: saved.slug,
    timezone: saved.timezone,
    notificationEmail: saved.notificationEmail,
    publicContactEmail: nullToEmpty(saved.publicContactEmail),
    phone: nullToEmpty(saved.phone),
    website: nullToEmpty(saved.website),
    address: nullToEmpty(saved.address),
    city: nullToEmpty(saved.city),
    country: saved.country,
    parkingNotes: nullToEmpty(saved.parkingNotes),
    accessNotes: nullToEmpty(saved.accessNotes),
    trialGuidance: nullToEmpty(saved.trialGuidance),
  });
}

/** Compare timestamptz at millisecond precision so ISO round-trips match. */
function matchesUpdatedAt(
  column: typeof trialOfferings.updatedAt | typeof faqs.updatedAt,
  expected: Date,
): SQL {
  return sql`date_trunc('milliseconds', ${column}) = date_trunc('milliseconds', ${expected.toISOString()}::timestamptz)`;
}

export const MISSING_OFFERING =
  "That trial class no longer exists. Refresh the page.";
export const MISSING_FAQ = "That question no longer exists. Refresh the page.";
export const STALE_EDIT =
  "This was updated elsewhere. Your edits are still here — reload the page to see the latest, then save again.";

export type OfferingEditorInput = {
  name: string;
  description: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  attire: string | null;
  expectations: string | null;
  waiverNotes?: string | null;
};

function offeringFormValues(row: {
  id: string;
  name: string;
  description: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  attire: string | null;
  expectations: string | null;
  updatedAt: Date;
}): Record<string, string> {
  return {
    id: row.id,
    name: row.name,
    description: nullToEmpty(row.description),
    minimumAge: nullToEmpty(row.minimumAge),
    maximumAge: nullToEmpty(row.maximumAge),
    attire: nullToEmpty(row.attire),
    expectations: nullToEmpty(row.expectations),
    updatedAt: serializeTimestamp(row.updatedAt),
  };
}

function faqFormValues(row: {
  id: string;
  question: string;
  answer: string;
  updatedAt: Date;
}): Record<string, string> {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    updatedAt: serializeTimestamp(row.updatedAt),
  };
}

async function offeringOwnedBySchool(
  db: Database,
  schoolId: string,
  id: string,
) {
  const [row] = await db
    .select({ id: trialOfferings.id })
    .from(trialOfferings)
    .where(
      and(eq(trialOfferings.id, id), eq(trialOfferings.schoolId, schoolId)),
    )
    .limit(1);
  return row ?? null;
}

async function faqOwnedBySchool(db: Database, schoolId: string, id: string) {
  const [row] = await db
    .select({ id: faqs.id })
    .from(faqs)
    .where(and(eq(faqs.id, id), eq(faqs.schoolId, schoolId)))
    .limit(1);
  return row ?? null;
}

export async function insertOffering(
  db: Database,
  schoolId: string,
  input: OfferingEditorInput,
): Promise<SettingsFormState> {
  const [created] = await db
    .insert(trialOfferings)
    .values({
      schoolId,
      name: input.name,
      description: input.description,
      minimumAge: input.minimumAge,
      maximumAge: input.maximumAge,
      attire: input.attire,
      expectations: input.expectations,
      waiverNotes: input.waiverNotes ?? null,
      active: true,
    })
    .returning();
  if (!created) return errorState("We could not add that trial class.");
  return successState(`“${created.name}” added and open for bookings.`, {
    ...offeringFormValues(created),
  });
}

export async function updateOffering(
  db: Database,
  schoolId: string,
  id: string,
  expectedUpdatedAt: Date,
  input: OfferingEditorInput,
): Promise<SettingsFormState> {
  const [updated] = await db
    .update(trialOfferings)
    .set({
      name: input.name,
      description: input.description,
      minimumAge: input.minimumAge,
      maximumAge: input.maximumAge,
      attire: input.attire,
      expectations: input.expectations,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(trialOfferings.id, id),
        eq(trialOfferings.schoolId, schoolId),
        matchesUpdatedAt(trialOfferings.updatedAt, expectedUpdatedAt),
      ),
    )
    .returning();

  if (updated) {
    return successState(
      `“${updated.name}” saved. New bookings use these settings.`,
      {
        ...offeringFormValues(updated),
      },
    );
  }

  if (!(await offeringOwnedBySchool(db, schoolId, id))) {
    return errorState(MISSING_OFFERING);
  }
  return errorState(STALE_EDIT);
}

export async function setOfferingActive(
  db: Database,
  schoolId: string,
  id: string,
  desiredActive: boolean,
): Promise<SettingsFormState> {
  const [updated] = await db
    .update(trialOfferings)
    .set({ active: desiredActive, updatedAt: new Date() })
    .where(
      and(
        eq(trialOfferings.id, id),
        eq(trialOfferings.schoolId, schoolId),
        eq(trialOfferings.active, !desiredActive),
      ),
    )
    .returning({
      id: trialOfferings.id,
      name: trialOfferings.name,
      active: trialOfferings.active,
    });

  if (updated) {
    return successState(
      updated.active
        ? `“${updated.name}” is open for bookings again.`
        : `“${updated.name}” is no longer offered to families.`,
    );
  }

  const [existing] = await db
    .select({
      id: trialOfferings.id,
      name: trialOfferings.name,
      active: trialOfferings.active,
    })
    .from(trialOfferings)
    .where(
      and(eq(trialOfferings.id, id), eq(trialOfferings.schoolId, schoolId)),
    )
    .limit(1);
  if (!existing) return errorState(MISSING_OFFERING);
  return successState(
    existing.active
      ? `“${existing.name}” is already offered to families.`
      : `“${existing.name}” is already not offered.`,
    { unchanged: "true" },
  );
}

export async function insertFaq(
  db: Database,
  schoolId: string,
  input: { question: string; answer: string },
): Promise<SettingsFormState> {
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(faqs)
    .where(eq(faqs.schoolId, schoolId));
  const count = existing?.count ?? 0;
  if (count >= LIMITS.faqCount) {
    return errorState(
      `You already have ${LIMITS.faqCount} questions. Delete one before adding another.`,
    );
  }
  const [created] = await db
    .insert(faqs)
    .values({
      schoolId,
      question: input.question,
      answer: input.answer,
      sortOrder: count,
    })
    .returning();
  if (!created) return errorState("We could not add that question.");
  return successState("Question added. Your agent can use this answer now.", {
    ...faqFormValues(created),
  });
}

export async function updateFaq(
  db: Database,
  schoolId: string,
  id: string,
  expectedUpdatedAt: Date,
  input: { question: string; answer: string },
): Promise<SettingsFormState> {
  const [updated] = await db
    .update(faqs)
    .set({
      question: input.question,
      answer: input.answer,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(faqs.id, id),
        eq(faqs.schoolId, schoolId),
        matchesUpdatedAt(faqs.updatedAt, expectedUpdatedAt),
      ),
    )
    .returning();

  if (updated) {
    return successState("Question saved. Your agent uses this answer now.", {
      ...faqFormValues(updated),
    });
  }

  if (!(await faqOwnedBySchool(db, schoolId, id))) {
    return errorState(MISSING_FAQ);
  }
  return errorState(STALE_EDIT);
}

export async function deleteFaqRecord(
  db: Database,
  schoolId: string,
  id: string,
): Promise<SettingsFormState> {
  const deleted = await db
    .delete(faqs)
    .where(and(eq(faqs.id, id), eq(faqs.schoolId, schoolId)))
    .returning({ id: faqs.id });
  if (deleted.length === 0) return errorState(MISSING_FAQ);
  return successState("Question deleted. Your agent will not use it again.");
}
