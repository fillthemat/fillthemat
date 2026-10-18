import { portFromSiteUrl } from "./local-ports";
import { fail } from "./local-process";

async function listenPid(port: number): Promise<number | undefined> {
  const proc = Bun.spawn(["lsof", "-nP", `-iTCP:${port}`, "-t"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const pid = await new Response(proc.stdout).text();
  return Number(pid);
}

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
if (!siteUrl?.trim()) {
  console.log("Nothing to stop: no local app port configured.");
  process.exit(0);
}

const port = portFromSiteUrl(siteUrl);
if (port === undefined) {
  fail("Invalid NEXT_PUBLIC_SITE_URL in .env.local. Run bun run setup.");
}

const pid = await listenPid(port);
if (pid) {
  process.kill(pid, "SIGTERM");
  console.log(`Stopped pid ${pid} on port ${port}`);
} else {
  console.log(`Nothing to stop: no pid listening to ${port}.`);
  process.exit(0);
}
