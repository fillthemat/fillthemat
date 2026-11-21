"use server";

import { redirect } from "next/navigation";
import { getCurrentSchool } from "@/lib/auth/current-school";
import { requireUser } from "@/lib/auth/current-user";
import { allowSelfApproval } from "@/lib/dev-flags";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Ownership and approval are platform-managed. Never accept either from the form.
  const { data, error } = await createAdminClient().rpc("create_onboarding_school", {
    p_owner_user_id: user.id,
    p_owner_email: user.email,
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_timezone: parsed.data.timezone,
    p_city: parsed.data.city ?? "",
    p_notification_email: parsed.data.notificationEmail,
    p_self_approve: allowSelfApproval(),
  });
  if (error?.code === "22023") redirect("/onboarding?error=invalid");
  if (error) throw error;
  if (data === "slug_taken") redirect("/onboarding?error=slug");
  if (data !== "created" && data !== "already_exists") {
    throw new Error(`Unexpected onboarding result: ${data}`);
  }

  redirect("/dashboard/settings");
}
