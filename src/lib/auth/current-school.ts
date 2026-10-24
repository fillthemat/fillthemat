import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type Tables } from "@/db/types";
import { getCurrentUser, requireUser, type VerifiedUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export type CurrentSchool = Tables<"schools"> &
  Omit<Tables<"school_settings">, "school_id" | "created_at" | "updated_at"> &
  Omit<Tables<"school_profiles">, "school_id" | "created_at" | "updated_at">;

export const getCurrentSchool = cache(async (): Promise<CurrentSchool | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("school_settings")
    .select("*, schools!inner(*, school_profiles(*))")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { schools, ...settings } = data;
  const { school_profiles, ...school } = schools;
  if (!school_profiles) throw new Error("School profile is missing");
  return { ...school_profiles, ...settings, ...school };
});

export async function requireSchool(): Promise<{
  user: VerifiedUser;
  school: CurrentSchool;
}> {
  const user = await requireUser();
  const school = await getCurrentSchool();
  if (!school) redirect("/onboarding");
  return { user, school };
}
