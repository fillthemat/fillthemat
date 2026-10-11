import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { scripts } from "../package.json";
import { config } from "../vercel";

function runBuild(environment: string, gateStatus = 0) {
  expect(config.buildCommand).toBe("bun run build:vercel");
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
        BUILD_COMMAND: scripts["build:vercel"],
      },
      encoding: "utf8",
    },
  );
}

it("provides environment-only and explicit production migration-check scripts", () => {
  expect(scripts["db:check"]).toBe(
    "bun --no-env-file scripts/check-migrations.ts",
  );
  expect(scripts["db:check:prod"]).toBe(
    "bun --no-env-file --env-file=.env.production.local scripts/check-migrations.ts",
  );
});

it("documents only Bun script entries for deployment and recovery", () => {
  const doc = readFileSync("docs/v1-deploy-current.md", "utf8");
  expect(doc).not.toMatch(/\bbunx\b|\bbun (?!run )/);
  for (const match of doc.matchAll(/\bbun run ([\w:-]+)/g)) {
    expect(Object.hasOwn(scripts, match[1]), match[0]).toBe(true);
  }
});

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
