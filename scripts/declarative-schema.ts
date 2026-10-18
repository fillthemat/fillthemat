import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string().regex(/^\d{4}_[\w-]+$/) })),
});

export function drizzleHistory(root: string) {
  const journal = journalSchema.parse(
    JSON.parse(readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8")),
  );
  return journal.entries.map(({ tag }, index) => ({
    // Synthetic versions exist only in the disposable preview project. They do
    // not claim these migrations were ever recorded by Supabase in production.
    version: `20260101${String(index).padStart(6, "0")}`,
    tag,
    sql: readFileSync(join(root, "drizzle", `${tag}.sql`), "utf8"),
  }));
}

export function stageDeclarativePreview(root: string, directory: string) {
  const supabase = join(directory, "supabase");
  const migrations = join(supabase, "migrations");
  mkdirSync(migrations, { recursive: true });
  cpSync(join(root, "supabase/schemas"), join(supabase, "schemas"), { recursive: true });
  writeFileSync(
    join(supabase, "config.toml"),
    `project_id = "declarative-preview-${crypto.randomUUID()}"
[db]
major_version = 17
[experimental]
stack = true
[experimental.pgdelta]
enabled = true
declarative_schema_path = "./schemas"
`,
  );
  for (const { version, tag, sql } of drizzleHistory(root)) {
    writeFileSync(join(migrations, `${version}_${tag}.sql`), sql);
  }
  return migrations;
}

export function normalizeSchemaDump(dump: string) {
  // PostgreSQL 17 emits a random psql safety token per dump. Keep everything else:
  // column order, constraint/index names, function bodies, ACLs, RLS and policies.
  return dump.replace(/^\\(?:un)?restrict .*\n/gm, "");
}
