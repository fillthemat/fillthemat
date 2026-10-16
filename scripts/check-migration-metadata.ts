import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { z } from "zod";

const journalSchema = z.object({
  entries: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      tag: z.string().regex(/^\d{4,}_[\w-]+$/),
    }),
  ),
});

function readTree(directory: string): string {
  return JSON.stringify(
    readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => {
        const path = join(directory, entry.name);
        return [
          entry.name,
          entry.isDirectory() ? readTree(path) : readFileSync(path, "base64"),
        ];
      }),
  );
}

function checkSchemaDrift(directory: string) {
  const temporary = mkdtempSync(join(tmpdir(), "drizzle-consistency-"));
  try {
    const copy = join(temporary, "drizzle");
    cpSync(directory, copy, { recursive: true });
    const before = readTree(copy);
    const config = join(temporary, "drizzle.config.ts");
    // Retain schema/dialect/casing; Kit 0.x needs a relative output path because
    // it prepends "./" when reading snapshots (absolute paths fail).
    writeFileSync(
      config,
      `import config from ${JSON.stringify(resolve("drizzle.config.ts"))};\nexport default { ...config, out: ${JSON.stringify(relative(process.cwd(), copy))} };\n`,
    );
    const result = spawnSync(
      "bun",
      ["--no-env-file", "run", "db:generate", `--config=${config}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
    if (readTree(copy) !== before)
      throw new Error(
        "Schema drift detected: run bun run db:generate and commit SQL, snapshot and journal together. No project files were changed.",
      );
    // Kit 0.x can catch generation errors and still exit 0. Require its explicit
    // no-op result too; closed stdin/timeouts fail safely on rename prompts.
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (/\bTTY\b|interactive\s+prompts?/i.test(output))
      throw new Error(
        "Schema drift detected (rename needs an interactive answer): run bun run db:generate.",
      );
    if (
      result.status !== 0 ||
      !result.stdout.includes("No schema changes, nothing to migrate")
    )
      throw new Error(
        `Schema drift check could not complete: ${result.error?.message ?? output.split("\n").filter(Boolean).slice(-5).join("\n")}`,
      );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function main() {
  const directory = "drizzle";
  const journal = journalSchema.parse(
    JSON.parse(readFileSync(join(directory, "meta/_journal.json"), "utf8")),
  );
  const sqlFiles = new Set<string>();
  const snapshots = new Set<string>();
  for (const [index, entry] of journal.entries.entries()) {
    const prefix = String(entry.idx).padStart(4, "0");
    if (entry.idx !== index || !entry.tag.startsWith(`${prefix}_`))
      throw new Error(`Invalid journal entry: ${entry.tag} at index ${index}`);
    const sql = `${entry.tag}.sql`;
    const snapshot = `${prefix}_snapshot.json`;
    sqlFiles.add(sql);
    snapshots.add(snapshot);
    if (!existsSync(join(directory, sql)))
      throw new Error(`Missing SQL: ${sql}`);
    if (!existsSync(join(directory, "meta", snapshot)))
      throw new Error(`Missing snapshot: meta/${snapshot}`);
  }
  for (const file of readdirSync(directory)) {
    if (file.endsWith(".sql") && !sqlFiles.has(file))
      throw new Error(`Orphan SQL: ${file}`);
  }
  for (const file of readdirSync(join(directory, "meta"))) {
    if (
      file.endsWith(".json") &&
      file !== "_journal.json" &&
      !snapshots.has(file)
    )
      throw new Error(`Orphan snapshot: ${file}`);
  }
  checkSchemaDrift(directory);
  console.info("Migration metadata is consistent; no schema drift.");
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify({
      event: "migration_metadata_check_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
}
