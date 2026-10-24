import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";

/** Trusted application work only. Never attach browser cookies or user sessions:
 * this credential bypasses RLS, so callers must authorize every operation. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Server Supabase configuration is missing");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
