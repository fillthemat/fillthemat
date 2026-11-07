import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { scripts } from "../package.json";
import { config } from "../vercel";

it("only builds on Vercel, without migration credentials", () => {
  expect(config.buildCommand).toBe("bun run build:vercel");
  expect(scripts["build:vercel"]).toBe("bun run build");
});

it("documents only Bun script entries for deployment and recovery", () => {
  const doc = readFileSync("docs/v1-deploy-current.md", "utf8");
  expect(doc).not.toMatch(/\bbunx\b|\bbun (?!run )/);
  for (const match of doc.matchAll(/\bbun run ([\w:-]+)/g)) {
    expect(Object.hasOwn(scripts, match[1]!), match[0]).toBe(true);
  }
});
