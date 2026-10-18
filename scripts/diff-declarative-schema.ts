import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stageDeclarativePreview } from "./declarative-schema";

// Preview only: never write supabase/migrations or connect to an app database.
const root = process.cwd();
const directory = mkdtempSync(join(tmpdir(), "fillthemat-schema-preview-"));
try {
  const migrations = stageDeclarativePreview(root, directory);
  const before = new Set(readdirSync(migrations));
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
      "public",
      "--no-apply",
      "--strict-coverage",
      "--file",
      "declarative_preview",
    ],
    { cwd: directory, stdio: ["ignore", "inherit", "inherit"] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Declarative preview failed (${result.status}).`);
  const generated = readdirSync(migrations).filter((file) => !before.has(file));
  for (const file of generated) console.info(readFileSync(join(migrations, file), "utf8"));
  console.info(
    "Preview only: no application database or repository migration history was changed.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
