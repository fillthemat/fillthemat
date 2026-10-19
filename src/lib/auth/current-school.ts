import "server-only";
import { redirect } from "next/navigation";
import { Tables } from "@/db/types";
import { getCurrentUser, requireUser, type VerifiedUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export async function getCurrentSchool(): Promise<Tables<"schools"> | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase.from("schools").select("*").eq("owner_user_id", user.id).limit(1);
  if (!data) return null;

  return data[0];
}

export async function requireSchool(): Promise<{
  user: VerifiedUser;
  school: Tables<"schools">;
}> {
  const user = await requireUser();
  const school = await getCurrentSchool();
  if (!school) redirect("/onboarding");
  return { user, school };
}
