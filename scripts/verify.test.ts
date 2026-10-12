import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const { scripts } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);

function runVerify(failingCheck = "") {
  const directory = mkdtempSync(path.join(tmpdir(), "fillthemat-verify-"));
  try {
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({
        scripts: {
          verify: scripts.verify,
          "verify:checks": scripts["verify:checks"],
          ...Object.fromEntries(
            ["lint", "check", "typecheck", "test"].map((check) => [
              check,
              `node check.cjs ${check} ${check === failingCheck ? 1 : 0}`,
            ]),
          ),
        },
      }),
    );
    writeFileSync(
      path.join(directory, "check.cjs"),
      'console.log("check:" + process.argv[2]); process.exit(Number(process.argv[3]));',
    );
    return spawnSync("bun", ["run", "verify"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10_000,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it("verification succeeds after lint, Biome, typecheck, and unit tests only", () => {
  const result = runVerify();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim().split("\n")).toEqual([
    "check:lint",
    "check:check",
    "check:typecheck",
    "check:test",
  ]);
});

it.each([
  ["lint", ["check:lint"]],
  ["check", ["check:lint", "check:check"]],
  ["typecheck", ["check:lint", "check:check", "check:typecheck"]],
  ["test", ["check:lint", "check:check", "check:typecheck", "check:test"]],
])("verification fails and stops when %s fails", (check, output) => {
  const result = runVerify(check);
  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout.trim().split("\n")).toEqual(output);
});

it("CI reuses verification scripts and keeps the required checks separate", () => {
  const checks = readFileSync(
    path.join(root, ".github/workflows/checks.yml"),
    "utf8",
  );
  const tests = readFileSync(
    path.join(root, ".github/workflows/test.yml"),
    "utf8",
  );
  const unitJob = tests.split("  integration:")[0];
  expect(checks).toContain("name: Lint, format, and typecheck");
  expect(checks.match(/run: (.+)/g)).toEqual(["run: bun run verify:checks"]);
  expect(unitJob).toContain("name: Unit tests");
  expect(unitJob.match(/run: (.+)/g)).toEqual(["run: bun run test"]);
  expect(scripts.test).toBe("vitest run");
});
