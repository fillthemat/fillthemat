import { spawnSync } from "node:child_process";
import { readEnvFile } from "./local-env";
import { portFromSiteUrl } from "./local-ports";
import { fail } from "./local-process";

const siteUrl = readEnvFile(".env.local").NEXT_PUBLIC_SITE_URL;
const port = portFromSiteUrl(siteUrl);
if (port === undefined) {
  fail("Invalid or missing NEXT_PUBLIC_SITE_URL in .env.local. Run bun run setup.");
}

const extra = process.argv.slice(2);
const result = spawnSync("bun", ["run", "--bun", "next", "dev", "--port", String(port), ...extra], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(port) },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
