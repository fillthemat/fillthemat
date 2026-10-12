import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { scripts } from "../package.json";
import { config } from "../vercel";

function runBuild(environment: string, gateStatus = 0, migrateStatus = 0) {
  expect(config.buildCommand).toBe("bun run build:vercel");
  // Stub only the process boundary: exercise the configured shell command
  // without querying a hosted database or running a Next.js build.
  return spawnSync(
    "sh",
    [
      "-c",
      'bun() { printf "%s\\n" "$*"; case "$2" in db:migrate:deploy) return "$MIGRATE_STATUS";; db:check) return "$GATE_STATUS";; esac; }; eval "$BUILD_COMMAND"',
    ],
    {
      env: {
        ...process.env,
        VERCEL_ENV: environment,
        GATE_STATUS: String(gateStatus),
        MIGRATE_STATUS: String(migrateStatus),
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

it("migrates, checks, then builds production and stops on either failure", () => {
  const success = runBuild("production");
  expect(success.status).toBe(0);
  expect(success.stdout.trim().split("\n")).toEqual([
    "run db:migrate:deploy",
    "run db:check",
    "run build",
  ]);
  const failure = runBuild("production", 1);
  expect(failure.status).toBe(1);
  expect(failure.stdout.trim().split("\n")).toEqual([
    "run db:migrate:deploy",
    "run db:check",
  ]);
  const migrateFailure = runBuild("production", 0, 1);
  expect(migrateFailure.status).toBe(1);
  expect(migrateFailure.stdout.trim()).toBe("run db:migrate:deploy");
});

it.each(["preview", "development", ""])(
  "does not gate %s builds on production migrations",
  (environment) => {
    const result = runBuild(environment, 1, 1);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("run build");
  },
);
