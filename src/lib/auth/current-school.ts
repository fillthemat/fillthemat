import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { type School, schools } from "@/db/schema";
import { requireUser, type VerifiedUser } from "./current-user";

export async function getOwnedSchool(userId: string): Promise<School | null> {
  const db = getDb();
  const [school] = await db.select().from(schools).where(eq(schools.ownerUserId, userId)).limit(1);
  return school ?? null;
}

export async function requireOwnedSchool(): Promise<{
  user: VerifiedUser;
  school: School;
}> {
  const user = await requireUser();
  const school = await getOwnedSchool(user.id);
  if (!school) redirect("/onboarding");
  return { user, school };
}

export function isSchoolPublic(school: School): boolean {
  return school.approvedAt != null && school.publishedAt != null;
}
