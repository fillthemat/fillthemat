import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

function removeKeys(contents: string, keys: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "fillthemat-local-env-"));
  directories.push(directory);
  const path = join(directory, ".env.local");
  writeFileSync(path, contents);
  const result = spawnSync(
    "bun",
    [
      "--no-env-file",
      "-e",
      `import { removeEnv } from "./scripts/local-env";
       console.log(JSON.stringify(await removeEnv(process.argv[1], JSON.parse(process.argv[2]))));`,
      path,
      JSON.stringify(keys),
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return { removed: JSON.parse(result.stdout), contents: readFileSync(path, "utf8") };
}

it("removes only named keys, preserving comments, other keys and the trailing newline", () => {
  expect(
    removeKeys(
      "# Local config\nDATABASE_URL=old\n\nSUPABASE_DB_URL=keep\nDIRECT_URL=old\n# End\n",
      ["DATABASE_URL", "DIRECT_URL"],
    ),
  ).toEqual({
    removed: ["DATABASE_URL", "DIRECT_URL"],
    contents: "# Local config\n\nSUPABASE_DB_URL=keep\n# End\n",
  });
});

it("does nothing when the keys are absent", () => {
  const contents = "# DATABASE_URL=comment\nSUPABASE_DB_URL=keep\n\n";
  expect(removeKeys(contents, ["DATABASE_URL", "DIRECT_URL"])).toEqual({ removed: [], contents });
});

it("does not remove keys that only share a prefix", () => {
  expect(removeKeys("DIRECT_URL_OTHER=keep\nDIRECT_URL=old\n", ["DIRECT_URL"])).toEqual({
    removed: ["DIRECT_URL"],
    contents: "DIRECT_URL_OTHER=keep\n",
  });
});

it("removes duplicate assignments and reports each key once", () => {
  expect(removeKeys("DIRECT_URL=first\nDIRECT_URL=second\n", ["DIRECT_URL"])).toEqual({
    removed: ["DIRECT_URL"],
    contents: "\n",
  });
});
