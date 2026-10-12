import { expect, it, vi } from "vitest";
import { ignoredBuildExitCode, isDocsPath } from "./ignore-build";

const preview = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_PREVIOUS_SHA: "a".repeat(40),
};

it.each([
  ["AGENTS.md", true],
  ["src/lib/README.md", true],
  ["docs/nested/diagram.svg", true],
  [".agents/skills/tool/script.ts", true],
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

it("skips only when every changed path is allowlisted", () => {
  expect(
    ignoredBuildExitCode(
      preview,
      () => "README.md\0docs/file with\nnewline.txt\0",
    ),
  ).toBe(0);
  expect(
    ignoredBuildExitCode(preview, () => "README.md\0scripts/tool.ts\0"),
  ).toBe(1);
  // --no-renames retains both paths when code is moved into docs.
  expect(
    ignoredBuildExitCode(preview, () => "src/tool.ts\0docs/tool.ts\0"),
  ).toBe(1);
});

it.each(["production", "development", undefined])(
  "builds in %s",
  (environment) => {
    const readDiff = vi.fn(() => "README.md\0");
    expect(
      ignoredBuildExitCode({ ...preview, VERCEL_ENV: environment }, readDiff),
    ).toBe(1);
    expect(readDiff).not.toHaveBeenCalled();
  },
);

it("builds for missing or invalid bases, git errors, and empty or malformed diffs", () => {
  for (const base of [undefined, "", "HEAD^", "--help"])
    expect(
      ignoredBuildExitCode({ ...preview, VERCEL_GIT_PREVIOUS_SHA: base }),
    ).toBe(1);
  expect(
    ignoredBuildExitCode(preview, () => {
      throw new Error("missing shallow-clone base");
    }),
  ).toBe(1);
  for (const diff of ["", "README.md", "README.md\0\0"])
    expect(ignoredBuildExitCode(preview, () => diff)).toBe(1);
  expect(
    ignoredBuildExitCode({
      ...preview,
      VERCEL_GIT_PREVIOUS_SHA: "0".repeat(40),
    }),
  ).toBe(1);
});
