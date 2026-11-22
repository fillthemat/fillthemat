import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/db/types";

// Provision once on the staging backend shared by Vercel Preview deployments.
// Deliberately do not fall back to application or linked-project credentials.
const url = new URL(process.env.PREVIEW_SUPABASE_URL ?? "");
if (
  process.env.VERCEL_ENV === "production" ||
  url.hostname === "aopcockhbfvonhvxufob.supabase.co"
) {
  throw new Error("Refusing to seed the production project.");
}
if (
  !(url.protocol === "https:" && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) &&
  !(url.protocol === "http:" && url.hostname === "127.0.0.1")
) {
  throw new Error("Use the dedicated preview project's Supabase API URL.");
}
const key = process.env.PREVIEW_SUPABASE_SECRET_KEY;
const password = process.env.PREVIEW_OWNER_PASSWORD;
if (!key || !password || password.length < 12)
  throw new Error(
    "Set PREVIEW_SUPABASE_SECRET_KEY and a PREVIEW_OWNER_PASSWORD of at least 12 characters.",
  );
const email = "reviewer@open-mat.example";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient<Database>(url.origin, key, options);
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { preview_fixture: "open-mat" },
});
let user = data.user;
if (error) {
  if (error.code !== "email_exists" && error.code !== "user_already_exists") throw error;
  // Recover from a partial seed only when the credentials and fixture marker match.
  const check = createClient(url.origin, key, options);
  const existing = await check.auth.signInWithPassword({ email, password });
  if (existing.error || existing.data.user?.app_metadata.preview_fixture !== "open-mat") {
    throw new Error("Preview owner exists with different credentials or is not a fixture.");
  }
  user = existing.data.user;
  await check.auth.signOut({ scope: "local" });
}
if (!user) throw new Error("No owner returned by Auth");
const school = await admin.rpc("create_onboarding_school", {
  p_owner_user_id: user.id,
  p_owner_email: email,
  p_notification_email: email,
  p_name: "Open Mat (Preview)",
  p_slug: "open-mat-preview",
  p_timezone: "America/New_York",
  p_city: "",
  p_self_approve: true,
});
if (school.error) throw school.error;
if (school.data !== "created" && school.data !== "already_exists")
  throw new Error(`Preview school: ${school.data}`);
console.log(`Open Mat preview owner ready: ${email}`);
