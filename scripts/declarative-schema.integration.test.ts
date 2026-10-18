import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { stageDeclarativePreview } from "./declarative-schema";

it("native sync generates only the requested increment against staged Drizzle history", () => {
  const root = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "declarative-increment-test-"));
  try {
    const migrations = stageDeclarativePreview(root, directory);
    const before = new Set(readdirSync(migrations));
    const usersFile = join(directory, "supabase/schemas/10-users.sql");
    writeFileSync(
      usersFile,
      readFileSync(usersFile, "utf8").replace("\n);", ",\n    declarative_preview_note text\n);"),
    );
    const result = spawnSync(
      resolve(root, "node_modules/.bin/supabase"),
      [
        "db",
        "schema",
        "declarative",
        "sync",
        "--workdir",
        directory,
        "--schema",
        "app",
        "--no-apply",
        "--strict-coverage",
        "--file",
        "preview_column",
      ],
      { cwd: directory, encoding: "utf8", timeout: 150_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const generated = readdirSync(migrations).filter((file) => !before.has(file));
    expect(generated).toHaveLength(1);
    const sql = readFileSync(join(migrations, generated[0]), "utf8");
    expect(sql).toMatch(/ADD COLUMN\s+"?declarative_preview_note"?\s+text/i);
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|DROP SCHEMA/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 180_000);
