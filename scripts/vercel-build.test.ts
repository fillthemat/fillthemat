import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { config } from "../vercel";

function runBuild(environment: string, gateStatus = 0) {
  expect(typeof config.buildCommand).toBe("string");
  // Stub only the process boundary: exercise the configured shell command
  // without querying a hosted database or running a Next.js build.
  return spawnSync(
    "sh",
    [
      "-c",
      'bun() { printf "%s\\n" "$*"; if [ "$2" = "db:check" ]; then return "$GATE_STATUS"; fi; }; eval "$BUILD_COMMAND"',
    ],
    {
      env: {
        ...process.env,
        VERCEL_ENV: environment,
        GATE_STATUS: String(gateStatus),
        BUILD_COMMAND: String(config.buildCommand),
      },
      encoding: "utf8",
    },
  );
}

it("checks migrations before production builds and stops on gate failure", () => {
  const success = runBuild("production");
  expect(success.status).toBe(0);
  expect(success.stdout.trim().split("\n")).toEqual([
    "run db:check",
    "run build",
  ]);
  const failure = runBuild("production", 1);
  expect(failure.status).toBe(1);
  expect(failure.stdout.trim()).toBe("run db:check");
});

it.each(["preview", "development", ""])(
  "does not gate %s builds on production migrations",
  (environment) => {
    const result = runBuild(environment, 1);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("run build");
  },
);
