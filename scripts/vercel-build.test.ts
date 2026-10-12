import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { scripts } from "../package.json";
import { config } from "../vercel";

function runBuild(environment: string, failure = "") {
  expect(config.buildCommand).toBe("bun run build:vercel");
  const directory = mkdtempSync(join(tmpdir(), "build-vercel-"));
  try {
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        scripts: {
          "build:vercel": scripts["build:vercel"],
          "db:migrate:deploy": `echo migrate; exit ${failure === "migrate" ? 1 : 0}`,
          "db:check": `echo check; exit ${failure === "check" ? 1 : 0}`,
          build: "echo build",
        },
      }),
    );
    return spawnSync("bun", ["run", "build:vercel"], {
      cwd: directory,
      env: {
        ...process.env,
        VERCEL_ENV: environment,
        DIRECT_URL: "",
        DATABASE_URL: "",
      },
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

it("migrates production before the read-only check and application build", () => {
  const success = runBuild("production");
  expect(success.status).toBe(0);
  expect(success.stdout.trim().split("\n")).toEqual([
    "migrate",
    "check",
    "build",
  ]);
});

it.each([
  ["migrate", ["migrate"]],
  ["check", ["migrate", "check"]],
])("stops the build when %s fails", (failure, output) => {
  const result = runBuild("production", failure);
  expect(result.status).toBe(1);
  expect(result.stdout.trim().split("\n")).toEqual(output);
});

it.each(["development", ""])(
  "does not gate %s builds on production migrations",
  (environment) => {
    const result = runBuild(environment, "migrate");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("build");
  },
);
