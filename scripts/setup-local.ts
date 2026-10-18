import { execFileSync } from "node:child_process";
import { hasGatewayToken } from "../src/lib/ai/gateway-token";
import { getSupabaseEnv, upsertEnv } from "./local-env";
import { claimAppPort } from "./local-ports";
import { fail } from "./local-process";

const LOCAL_ENV_FILE = ".env.local";
const LOCAL_SUPABASE_ENV_FILE = "supabase/.env";

async function main() {
  ensureExperimentalStackEnabled();
  ensureGooglePlaceholder();

  Bun.spawnSync(["bun", "install"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  Bun.spawnSync(["supabase", "start"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const updatedVars = await setupLocalEnvVars();

  // Commit the updated vars to the current process.
  Object.assign(process.env, updatedVars);

  console.log("Applying Drizzle migrations…");
  execFileSync("bunx", ["drizzle-kit", "migrate"], {
    stdio: "inherit",
    env: { ...process.env },
  });

  console.log("");
  console.log("Local stack is ready.");
  console.log(`  App       bun run dev  → ${updatedVars["NEXT_PUBLIC_SITE_URL"]}`);
  console.log("");
  console.log("  Sign in   owner@local.test / local-dev-password");
  console.log("");
  if (!hasGatewayToken(updatedVars)) {
    console.log(
      "Optional: bunx vercel env pull  (real assistant model; scripted local model otherwise).",
    );
  }
  process.exit(0);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});

async function ensureGooglePlaceholder() {
  upsertEnv(LOCAL_SUPABASE_ENV_FILE, {
    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: "local-placeholder",
    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET: "local-placeholder",
  });
  console.log(`Wrote ${LOCAL_SUPABASE_ENV_FILE} with Google placeholders.`);
}

async function ensureExperimentalStackEnabled() {
  upsertEnv(LOCAL_ENV_FILE, { SUPABASE_EXPERIMENTAL_STACK: "1" });
  console.log(`Wrote ${LOCAL_ENV_FILE} with SUPABASE_EXPERIMENTAL_STACK=1.`);
}

async function setupLocalEnvVars(): Promise<Record<string, string>> {
  const generateSecret = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
  const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

  const updates: Record<string, string> = {
    CRON_SECRET: process.env.CRON_SECRET || generateSecret(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
    TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
    ALLOW_SELF_APPROVAL: "true",
    NEXT_PUBLIC_DEV_AUTH: "true",
  };
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    const LOCAL_BASE_URL = "http://127.0.0.1";
    const port = await claimAppPort();
    const siteUrl = `${LOCAL_BASE_URL}:${port}`;
    updates["NEXT_PUBLIC_SITE_URL"] = siteUrl;
  }

  // Set Supabase vars
  const SUPABASE_MAPPINGS = [
    ["DB_URL", "DATABASE_URL"],
    ["DB_URL", "DIRECT_URL"],
    ["API_URL", "NEXT_PUBLIC_SUPABASE_URL"],
    ["PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
  ] as const;
  const supabaseEnv = await getSupabaseEnv();

  for (const [sourceKey, targetKey] of SUPABASE_MAPPINGS) {
    const value = supabaseEnv[sourceKey];
    if (value === undefined) {
      console.warn(`Key "${sourceKey}" not found in input, skipping`);
      continue;
    }
    updates[targetKey] = value;
  }

  await upsertEnv(LOCAL_ENV_FILE, updates);
  console.log(`Wrote ${LOCAL_ENV_FILE} with live values.`);
  return updates;
}
