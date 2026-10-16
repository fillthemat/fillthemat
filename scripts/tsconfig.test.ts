import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("does not automatically load ambient types from ancestor installations", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ambient-types-test-"));
  try {
    const ancestorTypes = join(
      fixture,
      "node_modules/@types/unrelated-runtime",
    );
    mkdirSync(ancestorTypes, { recursive: true });
    writeFileSync(
      join(ancestorTypes, "index.d.ts"),
      "declare namespace fetch { function preconnect(url: string): void; }",
    );
    const project = join(fixture, "project");
    mkdirSync(project);
    const config = ts.readConfigFile(resolve("tsconfig.json"), ts.sys.readFile);
    expect(config.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      project,
      undefined,
      join(project, "tsconfig.json"),
    );

    expect(
      ts.getAutomaticTypeDirectiveNames(parsed.options, ts.sys),
    ).not.toContain("unrelated-runtime");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
