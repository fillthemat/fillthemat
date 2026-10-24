import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";

/** Trusted server-side reads only. Callers must enforce public/owner access. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase server credentials are missing");

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
