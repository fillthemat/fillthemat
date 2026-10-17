import { portFromSiteUrl } from "./local-ports";
import { fail } from "./local-process";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const port = portFromSiteUrl(siteUrl);
if (port === undefined) {
  fail("Invalid or missing NEXT_PUBLIC_SITE_URL in .env.local. Run bun run setup.");
}

Bun.spawnSync(["bun", "run", "--bun", "next", "dev", "--port", String(port)], {
  stdout: "inherit",
  stderr: "inherit",
});
