import { spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { config } from "../vercel";
import { isDocsPath, ignoredBuildExitCode as run } from "./ignore-build";

const preview = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_PREVIOUS_SHA: "a".repeat(40),
};

afterEach(() => vi.restoreAllMocks());

it("disables merge-queue deployments", () => {
  expect(config.git?.deploymentEnabled).toHaveProperty(
    "gh-readonly-queue/**",
    false,
  );
});

it("skips gh-pages without any repository files or Bun available", () => {
  const directory = mkdtempSync(join(tmpdir(), "fillthemat-ignore-build-"));
  try {
    const result = spawnSync("/bin/sh", ["-c", config.ignoreCommand ?? ""], {
      cwd: directory,
      env: {
        NODE_ENV: "test",
        VERCEL_GIT_COMMIT_REF: "gh-pages",
        PATH: directory,
      },
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  } finally {
    rmdirSync(directory);
  }
});

it("defers to the build script for other branches", () => {
  const result = spawnSync("/bin/sh", ["-c", config.ignoreCommand ?? ""], {
    env: {
      ...process.env,
      VERCEL_GIT_COMMIT_REF: "docs/supabase-mcp-live-check",
      VERCEL_ENV: "production",
    },
    encoding: "utf8",
    timeout: 5_000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("Build");
});

it.each([
  ["AGENTS.md", true],
  ["src/lib/README.md", false],
  ["docs/nested/README.md", true],
  [".agents/skills/tool/README.md", true],
  ["docs/nested/diagram.svg", true],
  [".agents/skills/tool/script.ts", false],
  ["opencode.json", true],
  ["opencode.jsonc", true],
  [".github/ISSUE_TEMPLATE/bug.yml", true],
  ["src/app/page.tsx", false],
  ["scripts/ignore-build.ts", false],
  ["package.json", false],
  ["bun.lock", false],
  ["vercel.ts", false],
  [".github/workflows/checks.yml", false],
  ["docs-other/config.json", false],
  ["opencode.json.bak", false],
  ["", false],
])("classifies %s", (path, expected) => {
  expect(isDocsPath(path)).toBe(expected);
});

it.each(["ts", "tsx", "js", "mjs"])(
  "builds for .%s code in docs/agents",
  (extension) => {
    for (const directory of ["docs", ".agents"])
      expect(isDocsPath(`${directory}/nested/code.${extension}`)).toBe(false);
  },
);

it("skips only when every changed path is allowlisted", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  expect(run(preview, () => "README.md\0docs/file with\nnewline.txt\0")).toBe(
    0,
  );
  expect(run(preview, () => "README.md\0scripts/tool.ts\0")).toBe(1);
  expect(log).toHaveBeenLastCalledWith(
    'Build: non-docs path: "scripts/tool.ts"',
  );
  // --no-renames retains both paths when code is moved into docs.
  expect(run(preview, () => "src/tool.ts\0docs/tool.ts\0")).toBe(1);
});

it.each(["production", "development", undefined])(
  "builds in %s",
  (environment) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const readDiff = vi.fn(() => "README.md\0");
    expect(run({ ...preview, VERCEL_ENV: environment }, readDiff)).toBe(1);
    expect(readDiff).not.toHaveBeenCalled();
    expect(log).toHaveBeenLastCalledWith("Build: non-Preview");
  },
);

it("builds for missing bases or git errors without printing env values", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  for (const base of [undefined, ""])
    expect(run({ ...preview, VERCEL_GIT_PREVIOUS_SHA: base })).toBe(1);
  expect(log).toHaveBeenLastCalledWith("Build: no base");
  expect(
    run(preview, () => {
      throw new Error(`missing base ${preview.VERCEL_GIT_PREVIOUS_SHA}`);
    }),
  ).toBe(1);
  expect(log).toHaveBeenLastCalledWith("Build: git error");
  expect(
    run({
      ...preview,
      VERCEL_GIT_PREVIOUS_SHA: "0".repeat(40),
    }),
  ).toBe(1);
  expect(log).toHaveBeenLastCalledWith("Build: git error");
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    preview.VERCEL_GIT_PREVIOUS_SHA,
  );
});
