"use server";

import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/current-school";
import { publicSchoolPath } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export async function markPreviewedAction() {
  const { school } = await requireSchool();
  const supabase = await createClient();
  const { error } = await supabase
    .from("schools")
    .update({
      previewed_at: school.previewed_at ?? new Date().toISOString(),
    })
    .eq("id", school.id);

  if (error) throw error;
  redirect(`${publicSchoolPath(school.slug)}?preview=1`);
}

export async function publishSchoolAction() {
  const { school } = await requireSchool();
  const supabase = await createClient();
  const [offerings, windows] = await Promise.all([
    supabase
      .from("trial_offerings")
      .select("id")
      .eq("school_id", school.id)
      .eq("active", true)
      .limit(1),
    supabase
      .from("trial_windows")
      .select("id")
      .eq("school_id", school.id)
      .eq("active", true)
      .limit(1),
  ]);
  if (offerings.error) throw offerings.error;
  if (windows.error) throw windows.error;

  const ready =
    school.approved_at &&
    school.previewed_at &&
    school.name &&
    school.slug &&
    school.timezone &&
    school.notification_email &&
    (school.city || school.address) &&
    offerings.data.length > 0 &&
    windows.data.length > 0;

  if (!ready) {
    redirect("/dashboard?error=not_ready");
  }

  const { error } = await supabase
    .from("schools")
    .update({
      published_at: school.published_at ?? new Date().toISOString(),
    })
    .eq("id", school.id)
    .is("published_at", null);
  if (error) throw error;

  redirect("/dashboard");
}
