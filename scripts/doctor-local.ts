import {
  missingRequiredKeys,
  parseSupabaseStatusEnv,
  readEnvFile,
} from "./local-env";
import { portFromSiteUrl } from "./local-ports";
import { fail, tryCapture } from "./local-process";

const ENV_LOCAL = ".env.local";

function check(ok: boolean, pass: string, failMessage: string) {
  if (ok) {
    console.log(`ok  ${pass}`);
    return true;
  }
  console.error(`err ${failMessage}`);
  return false;
}

function main() {
  let healthy = true;

  const bunVersion = process.versions.bun;
  healthy =
    check(
      Boolean(bunVersion),
      `bun ${bunVersion}`,
      "Not running under Bun. Use bun run doctor.",
    ) && healthy;
  if (bunVersion && !bunVersion.startsWith("1.4.")) {
    console.warn(`warn Expected bun 1.4.x, found ${bunVersion}`);
  }

  const docker = tryCapture("docker", ["info"]);
  healthy =
    check(
      docker.ok,
      "Docker Engine (`docker info`) — OrbStack/Desktop/Colima",
      "Docker Engine not reachable. Start OrbStack, Docker Desktop, or Colima.",
    ) && healthy;

  const status = tryCapture("bunx", ["supabase", "status", "-o", "env"]);
  healthy =
    check(
      status.ok,
      "supabase status",
      "Local Supabase is not running. bun run setup (or bun run supabase:start).",
    ) && healthy;

  if (status.ok) {
    try {
      const parsed = parseSupabaseStatusEnv(status.stdout);
      console.log(`ok  API ${parsed.apiUrl}`);
    } catch (error) {
      healthy = false;
      console.error(
        `err ${error instanceof Error ? error.message : "status parse failed"}`,
      );
    }
  }

  const env = readEnvFile(ENV_LOCAL);
  const missing = missingRequiredKeys(env);
  healthy =
    check(
      missing.length === 0,
      `${ENV_LOCAL} has required keys`,
      `${ENV_LOCAL} missing: ${missing.join(", ")}. Run bun run setup.`,
    ) && healthy;

  const appPort = portFromSiteUrl(env.NEXT_PUBLIC_SITE_URL);
  if (env.NEXT_PUBLIC_SITE_URL && appPort === undefined) {
    healthy = false;
    console.error(
      `err NEXT_PUBLIC_SITE_URL=${env.NEXT_PUBLIC_SITE_URL} is not an eligible local origin (http://127.0.0.1:3000, :3010, … :3090). Run bun run setup.`,
    );
  } else if (appPort !== undefined) {
    console.log(`ok  app ${env.NEXT_PUBLIC_SITE_URL}`);
  }

  if (env.VERCEL_OIDC_TOKEN || env.AI_GATEWAY_API_KEY)
    console.log("ok  AI Gateway token present (real assistant model)");
  else
    console.log(
      "…   VERCEL_OIDC_TOKEN / AI_GATEWAY_API_KEY missing (assistant uses its scripted local model)",
    );

  if (env.RESEND_API_KEY) console.log("ok  RESEND_API_KEY present");
  else
    console.log(
      "…   RESEND_API_KEY missing (email deliveries log + mark sent)",
    );

  if (env.WHATSAPP_SYSTEM_USER_TOKEN)
    console.log("ok  WHATSAPP_SYSTEM_USER_TOKEN present (real WhatsApp send)");
  else
    console.log(
      "…   WHATSAPP_SYSTEM_USER_TOKEN missing (WhatsApp uses local stub)",
    );

  if (env.WHATSAPP_APP_SECRET) console.log("ok  WHATSAPP_APP_SECRET present");
  else
    console.log(
      "…   WHATSAPP_APP_SECRET missing (webhook verify uses dev-stub secret locally)",
    );

  if (env.WHATSAPP_VERIFY_TOKEN)
    console.log("ok  WHATSAPP_VERIFY_TOKEN present");
  else
    console.log(
      "…   WHATSAPP_VERIFY_TOKEN missing (GET verify uses dev-stub token locally)",
    );

  if (!healthy) fail("doctor found problems.");
  console.log("doctor passed.");
}

main();
