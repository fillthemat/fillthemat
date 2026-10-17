import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { hasGatewayToken } from "../src/lib/ai/gateway-token";
import { envUpsertVars } from "./env-upsert-vars";
import { fail } from "./local-process";

const SUPABASE_ENV = "supabase/.env";

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
  ensureGooglePlaceholder();

  Bun.spawnSync(["bun", "install"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  Bun.spawnSync(["supabase", "start"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const updatedVars = await envUpsertVars();

  console.log("Applying Drizzle migrations…");
  execFileSync("bunx", ["drizzle-kit", "migrate"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...updatedVars,
    },
  });

  const { seedLocal } = await import("./seed-local");
  await seedLocal();

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
  // seedLocal() leaves the postgres-js pool open; without this, bun never exits.
  process.exit(0);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
