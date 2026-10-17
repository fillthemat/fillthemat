"use server";

import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { schools, trialOfferings, trialWindows } from "@/db/schema";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { publicSchoolPath } from "@/lib/site-url";

export async function markPreviewedAction() {
  const { school } = await requireOwnedSchool();
  const db = getDb();
  await db
    .update(schools)
    .set({
      previewedAt: school.previewedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schools.id, school.id));
  redirect(`${publicSchoolPath(school.slug)}?preview=1`);
}

export async function publishSchoolAction() {
  const { school } = await requireOwnedSchool();
  const db = getDb();
  const [offerings, windows] = await Promise.all([
    db
      .select()
      .from(trialOfferings)
      .where(and(eq(trialOfferings.schoolId, school.id), eq(trialOfferings.active, true))),
    db
      .select()
      .from(trialWindows)
      .where(and(eq(trialWindows.schoolId, school.id), eq(trialWindows.active, true))),
  ]);

  const ready =
    school.approvedAt &&
    school.previewedAt &&
    school.name &&
    school.slug &&
    school.timezone &&
    school.notificationEmail &&
    (school.city || school.address) &&
    offerings.length > 0 &&
    windows.length > 0;

  if (!ready) {
    redirect("/dashboard?error=not_ready");
  }

  await db
    .update(schools)
    .set({
      publishedAt: school.publishedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(schools.id, school.id), isNull(schools.publishedAt)));

  const host = (await headers()).get("x-forwarded-host");
  void host;
  redirect("/dashboard");
}
