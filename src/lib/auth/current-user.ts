import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type VerifiedUser = {
  id: string;
  email: string;
  name: string | null;
};

export const getCurrentUser = cache(async (): Promise<VerifiedUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data || !data.claims.email) return null;
  const user: VerifiedUser = {
    id: data.claims.sub,
    email: data.claims.email,
    name: data.claims.user_metadata?.name,
  };
  return user;
});

export async function requireUser(): Promise<VerifiedUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}
