import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/db/types";

/** Trusted application work only. Never attach browser cookies or user sessions:
 * this credential bypasses RLS, so callers must authorize every operation. */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}
