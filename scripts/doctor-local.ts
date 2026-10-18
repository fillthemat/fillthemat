import { GATEWAY_TOKEN_ENV_VARS, hasGatewayToken } from "../src/lib/ai/gateway-token";
import { getSupabaseEnv, missingRequiredKeys } from "./local-env";
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

async function main() {
  let healthy = true;

  const bunVersion = process.versions.bun;
  healthy =
    check(Boolean(bunVersion), `bun ${bunVersion}`, "Not running under Bun. Use bun run doctor.") &&
    healthy;
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

  const supabaseEnv = await getSupabaseEnv();
  if (!supabaseEnv["DB_URL"]) {
    healthy = false;
    console.error("err supabase not running");
  } else {
    console.log("ok  supabase is running");
  }

  const missing = missingRequiredKeys();
  healthy =
    check(
      missing.length === 0,
      `${ENV_LOCAL} has required keys`,
      `${ENV_LOCAL} missing: ${missing.join(", ")}. Run bun run setup.`,
    ) && healthy;

  const appPort = portFromSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (process.env.NEXT_PUBLIC_SITE_URL && appPort === undefined) {
    healthy = false;
    console.error(
      `err NEXT_PUBLIC_SITE_URL=${process.env.NEXT_PUBLIC_SITE_URL} is not an eligible local origin (http://127.0.0.1:3000, :3010, … :3090). Run bun run setup.`,
    );
  } else if (appPort !== undefined) {
    console.log(`ok  app ${process.env.NEXT_PUBLIC_SITE_URL}`);
  }

  if (hasGatewayToken(process.env))
    console.log("ok  AI Gateway token present (real assistant model)");
  else
    console.log(
      `…   ${GATEWAY_TOKEN_ENV_VARS.join(" / ")} missing (assistant uses its scripted local model)`,
    );

  if (process.env.RESEND_API_KEY) console.log("ok  RESEND_API_KEY present");
  else console.log("…   RESEND_API_KEY missing (email deliveries log + mark sent)");

  if (process.env.WHATSAPP_SYSTEM_USER_TOKEN)
    console.log("ok  WHATSAPP_SYSTEM_USER_TOKEN present (real WhatsApp send)");
  else console.log("…   WHATSAPP_SYSTEM_USER_TOKEN missing (WhatsApp uses local stub)");

  if (process.env.WHATSAPP_APP_SECRET) console.log("ok  WHATSAPP_APP_SECRET present");
  else console.log("…   WHATSAPP_APP_SECRET missing (webhook verify uses dev-stub secret locally)");

  if (process.env.WHATSAPP_VERIFY_TOKEN) console.log("ok  WHATSAPP_VERIFY_TOKEN present");
  else console.log("…   WHATSAPP_VERIFY_TOKEN missing (GET verify uses dev-stub token locally)");

  if (!healthy) fail("doctor found problems.");
  console.log("doctor passed.");
}

main();
