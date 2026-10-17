import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "stop-dev-local.ts");
const directories: string[] = [];

function tempWorktree(): string {
  const directory = mkdtempSync(join(tmpdir(), "fillthemat-stop-dev-"));
  directories.push(directory);
  return directory;
}

function runStop(envFile?: string) {
  const cwd = tempWorktree();
  if (envFile !== undefined) writeFileSync(join(cwd, ".env.local"), envFile);
  const bin = join(cwd, "bin");
  mkdirSync(bin);
  const listenLog = join(cwd, "listeners.log");
  // Stub the OS boundary so tests can never discover or stop real listeners.
  writeFileSync(join(bin, "lsof"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$STOP_DEV_LISTEN_LOG"\n', {
    mode: 0o755,
  });
  const result = spawnSync("bun", [script], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STOP_DEV_LISTEN_LOG: listenLog,
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
    },
  });
  return { ...result, listenLog };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("dev:stop", () => {
  it("succeeds with nothing to stop when setup has never written .env.local", () => {
    const result = runStop();

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/nothing to stop/i);
    expect(result.stderr).toBe("");
    expect(existsSync(result.listenLog)).toBe(false);
  });

  it.each(["", "CRON_SECRET=test\n", "NEXT_PUBLIC_SITE_URL=\n"])(
    "succeeds without inspecting listeners when .env.local has no port: %j",
    (envFile) => {
      const result = runStop(envFile);

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/nothing to stop/i);
      expect(result.stderr).toBe("");
      expect(existsSync(result.listenLog)).toBe(false);
    },
  );

  it.each(["   ", "\t \t"])(
    "treats a whitespace-only local site URL as nothing to stop: %j",
    (siteUrl) => {
      const result = runStop(`NEXT_PUBLIC_SITE_URL="${siteUrl}"\n`);

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/nothing to stop/i);
      expect(result.stderr).toBe("");
      expect(existsSync(result.listenLog)).toBe(false);
    },
  );

  it.each(["https://fillthemat.com", "http://127.0.0.1:3005"])(
    "still rejects an invalid configured origin: %s",
    (siteUrl) => {
      const result = runStop(`NEXT_PUBLIC_SITE_URL=${siteUrl}\n`);

      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "Invalid NEXT_PUBLIC_SITE_URL in .env.local. Run bun run setup.\n",
      );
      expect(existsSync(result.listenLog)).toBe(false);
    },
  );

  it("still checks only the configured port and succeeds when nothing listens", () => {
    const result = runStop("NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3020\n");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Nothing listening on port 3020\n");
    expect(result.stderr).toBe("");
    expect(readFileSync(result.listenLog, "utf8")).toBe("-nP\n-iTCP:3020\n-sTCP:LISTEN\n-t\n");
  });
});
