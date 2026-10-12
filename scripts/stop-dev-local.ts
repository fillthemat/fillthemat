import { spawnSync } from "node:child_process";
import { readEnvFile } from "./local-env";
import { portFromSiteUrl } from "./local-ports";
import { fail } from "./local-process";

function listenPids(port: number): number[] {
  const result = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    { encoding: "utf8" },
  );
  if (result.error) {
    fail(`Could not list listeners on port ${port}: ${result.error.message}`);
  }
  const pids = new Set<number>();
  for (const line of (result.stdout ?? "").split("\n")) {
    const pid = Number(line.trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      pids.add(pid);
    }
  }
  return [...pids];
}

const siteUrl = readEnvFile(".env.local").NEXT_PUBLIC_SITE_URL;
if (!siteUrl?.trim()) {
  console.log("Nothing to stop: no local app port configured.");
  process.exit(0);
}

const port = portFromSiteUrl(siteUrl);
if (port === undefined) {
  fail("Invalid NEXT_PUBLIC_SITE_URL in .env.local. Run bun run setup.");
}

const pids = listenPids(port);
if (pids.length === 0) {
  console.log(`Nothing listening on port ${port}`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopped pid ${pid} on port ${port}`);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === "ESRCH") continue;
    fail(
      `Could not stop pid ${pid}: ${error instanceof Error ? error.message : error}`,
    );
  }
}
