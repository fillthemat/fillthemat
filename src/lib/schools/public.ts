import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  faqs,
  type School,
  schools,
  trialOccurrences,
  trialOfferings,
  trialWindows,
} from "@/db/schema";
import { getVerifiedClaims } from "@/lib/auth/current-user";

export async function getSchoolBySlug(slug: string): Promise<School | null> {
  const db = getDb();
  const [school] = await db.select().from(schools).where(eq(schools.slug, slug)).limit(1);
  return school ?? null;
}

export async function getSchoolForLandingAccess(
  slug: string,
  options?: { preview?: boolean },
): Promise<School | null> {
  const publicSchool = await getPublicSchoolBySlug(slug);
  if (publicSchool) return publicSchool;
  if (!options?.preview) return null;
  const school = await getSchoolBySlug(slug);
  if (!school) return null;
  const user = await getVerifiedClaims();
  if (!user || school.ownerUserId !== user.id) return null;
  return school;
}

export async function getPublicSchoolBySlug(slug: string): Promise<School | null> {
  const db = getDb();
  const [school] = await db
    .select()
    .from(schools)
    .where(
      and(eq(schools.slug, slug), isNotNull(schools.approvedAt), isNotNull(schools.publishedAt)),
    )
    .limit(1);
  return school ?? null;
}

export async function loadSchoolCatalog(schoolId: string) {
  const db = getDb();
  const [offeringRows, windowRows, occurrenceRows, faqRows] = await Promise.all([
    db.select().from(trialOfferings).where(eq(trialOfferings.schoolId, schoolId)),
    db.select().from(trialWindows).where(eq(trialWindows.schoolId, schoolId)),
    db.select().from(trialOccurrences).where(eq(trialOccurrences.schoolId, schoolId)),
    db.select().from(faqs).where(eq(faqs.schoolId, schoolId)),
  ]);
  return {
    offerings: offeringRows,
    windows: windowRows,
    occurrences: occurrenceRows,
    faqs: faqRows.sort((a, b) => a.sortOrder - b.sortOrder),
  };
}
