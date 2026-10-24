"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { schools } from "@/db/schema";
import { getCurrentSchool } from "@/lib/auth/current-school";
import { requireUser } from "@/lib/auth/current-user";
import { allowSelfApproval } from "@/lib/dev-flags";
import { isValidTimezone } from "@/lib/timezones";
import { onboardingSchema } from "@/lib/validation";

export async function createSchoolAction(formData: FormData) {
  const user = await requireUser();
  const school = await getCurrentSchool();
  if (school) redirect("/dashboard");

  const parsed = onboardingSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    timezone: formData.get("timezone"),
    city: formData.get("city") ?? "",
    notificationEmail: formData.get("notificationEmail"),
  });
  if (!parsed.success || !isValidTimezone(parsed.data.timezone)) {
    redirect("/onboarding?error=invalid");
  }

  const db = getDb();
  const taken = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.slug, parsed.data.slug))
    .limit(1);
  if (taken[0]) redirect("/onboarding?error=slug");

  await db.insert(schools).values({
    ownerUserId: user.id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    timezone: parsed.data.timezone,
    city: parsed.data.city,
    notificationEmail: parsed.data.notificationEmail,
    country: "US",
    approvedAt: allowSelfApproval() ? new Date() : null,
  });

  redirect("/dashboard/settings");
}
