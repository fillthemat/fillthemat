import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import {
  mergeLocalEnv,
  parseSupabaseStatusEnv,
  readEnvFile,
  writeEnvFile,
} from "./local-env";
import { claimAppPortForCwd, localSiteUrl } from "./local-ports";
import { fail, tryCapture } from "./local-process";

const ENV_LOCAL = ".env.local";
const SUPABASE_ENV = "supabase/.env";

function assertBun() {
  const version = process.versions.bun;
  if (!version) fail("Run bun run setup (this script must execute under Bun).");
  if (!version.startsWith("1.4.")) {
    console.warn(
      `Warning: packageManager is bun@1.4.x; this shell is ${version}.`,
    );
  }
}

function assertDocker() {
  const result = tryCapture("docker", ["info"]);
  if (!result.ok) {
    fail(
      "Docker Engine is not reachable (`docker info` failed). Start OrbStack, Docker Desktop, or Colima, then retry.",
    );
  }
}

function ensureGooglePlaceholder() {
  if (existsSync(SUPABASE_ENV)) return;
  writeFileSync(
    SUPABASE_ENV,
    [
      "# Placeholder so `supabase start` can boot without a Google Cloud client.",
      "# Replace with a real Web client to use Continue with Google locally.",
      "# Callback: http://127.0.0.1:54321/auth/v1/callback",
      "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=local-placeholder",
      "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=local-placeholder",
      "",
    ].join("\n"),
  );
  console.log(`Wrote ${SUPABASE_ENV} with Google placeholders.`);
}

async function main() {
  assertBun();
  assertDocker();
  ensureGooglePlaceholder();

  console.log("Starting local Supabase (no-op if already running)…");
  execFileSync("bunx", ["supabase", "start"], { stdio: "inherit" });

  const statusText = execFileSync("bunx", ["supabase", "status", "-o", "env"], {
    encoding: "utf8",
  });
  const status = parseSupabaseStatusEnv(statusText);
  const existing = readEnvFile(ENV_LOCAL);
  const appPort = await claimAppPortForCwd(existing.NEXT_PUBLIC_SITE_URL).catch(
    (error) => fail(error instanceof Error ? error.message : String(error)),
  );
  const siteUrl = localSiteUrl(appPort);
  const generatedSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const merged = mergeLocalEnv(existing, status, generatedSecret, siteUrl);
  writeEnvFile(ENV_LOCAL, merged);
  console.log(
    `Wrote ${ENV_LOCAL} (existing vendor keys preserved; app ${siteUrl}).`,
  );

  console.log("Applying Drizzle migrations…");
  execFileSync("bunx", ["drizzle-kit", "migrate"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DIRECT_URL: merged.DIRECT_URL,
      DATABASE_URL: merged.DATABASE_URL,
    },
  });

  const { seedLocal } = await import("./seed-local");
  await seedLocal();

  console.log("");
  console.log("Local stack is ready.");
  if (status.studioUrl) console.log(`  Studio    ${status.studioUrl}`);
  if (status.inbucketUrl) console.log(`  Inbucket  ${status.inbucketUrl}`);
  console.log(`  App       bun run dev  → ${siteUrl}`);
  console.log("");
  console.log("  Sign in   owner@local.test / local-dev-password");
  console.log("");
  if (!merged.VERCEL_OIDC_TOKEN && !merged.AI_GATEWAY_API_KEY) {
    console.log(
      "Optional: bunx vercel env pull  (real assistant model; scripted local model otherwise).",
    );
  }
  if (!existing.RESEND_API_KEY && !merged.RESEND_API_KEY) {
    console.log(
      "Optional: RESEND_API_KEY + RESEND_FROM  (real mail; local noop otherwise).",
    );
  }
  // seedLocal() leaves the postgres-js pool open; without this, bun never exits.
  process.exit(0);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
