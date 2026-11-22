"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export async function setPassword(_previous: string, fields: FormData) {
  await requireUser();
  const password = fields.get("password");
  if (typeof password !== "string" || password.length < 8) return "Use at least 8 characters.";
  if (password !== fields.get("confirm")) return "Passwords do not match.";
  const { auth } = await createClient();
  const { error } = await auth.updateUser({ password });
  return error?.message ?? "Password saved. You can sign in with your email and password.";
}

export async function signOut() {
  const { auth } = await createClient();
  const { error } = await auth.signOut({ scope: "local" });
  if (error) throw error;
  redirect("/sign-in");
}
