import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  drizzleHistory,
  normalizeSchemaDump,
  publicComparisonBaseline,
  stageDeclarativePreview,
} from "./declarative-schema";

describe("declarative preview", () => {
  it("keeps each table and its dependent objects in a parent-first table file", () => {
    const files = readdirSync("supabase/schemas")
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const tables = new Set<string>();
    for (const file of files) {
      const sql = readFileSync(join("supabase/schemas", file), "utf8");
      expect(sql).not.toMatch(/\bapp\s*\.|"app"|SCHEMA app\b/);
      expect(sql).not.toMatch(/ALTER DEFAULT PRIVILEGES|REVOKE ALL ON SCHEMA|ON ALL TABLES/);
      const declarations = [...sql.matchAll(/CREATE TABLE public\.(\w+)/g)];
      if (file === "00-public.sql") {
        expect(declarations).toHaveLength(0);
        continue;
      }
      if (file === "11-schools.sql") {
        expect(sql).toContain(
          "REVOKE ALL ON FUNCTION public.prevent_published_school_identity_change() FROM PUBLIC, anon, authenticated, service_role;",
        );
      }
      expect(declarations).toHaveLength(1);
      const table = declarations[0][1];
      expect(file).toMatch(new RegExp(`^\\d{2}-${table.replaceAll("_", "-")}\\.sql$`));
      tables.add(table);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated, service_role;`,
      );
      for (const reference of sql.matchAll(/REFERENCES public\.(\w+)/g)) {
        expect(tables.has(reference[1]), `${file} references a later table`).toBe(true);
      }
      for (const owner of sql.matchAll(/\b(?:ALTER TABLE|ON(?: TABLE)?) public\.(\w+)/g)) {
        expect(owner[1]).toBe(table);
      }
    }
    expect(tables.size).toBe(19);
  });

  it("stages every original migration unchanged, without needing a live database", () => {
    const directory = mkdtempSync(join(tmpdir(), "declarative-preview-test-"));
    try {
      const root = process.cwd();
      const history = drizzleHistory(root);
      const migrations = stageDeclarativePreview(root, directory);
      expect(readdirSync(migrations)).toHaveLength(history.length + 1);
      const baseline = readFileSync(
        join(migrations, "20260102000000_public_comparison_baseline.sql"),
        "utf8",
      );
      expect(baseline).toBe(publicComparisonBaseline(root));
      expect(baseline).not.toMatch(/\bapp\b/);
      expect(baseline).toContain("REFERENCES auth.users(id)");
      expect(baseline.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(19);
      expect(baseline).not.toMatch(/REVOKE ALL ON SCHEMA|ALTER DEFAULT PRIVILEGES/);
      for (const { version, tag, sql } of history) {
        expect(readFileSync(join(migrations, `${version}_${tag}.sql`), "utf8")).toBe(sql);
      }
      const config = readFileSync(join(directory, "supabase/config.toml"), "utf8");
      expect(config).toContain("[experimental.pgdelta]\nenabled = true");
      expect(config).toContain('declarative_schema_path = "./schemas"');
      expect(config).not.toContain("schema_paths");
      for (const file of readdirSync("supabase/schemas").filter((file) => file.endsWith(".sql"))) {
        expect(readFileSync(join(directory, "supabase/schemas", file), "utf8")).toBe(
          readFileSync(join(root, "supabase/schemas", file), "utf8"),
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("ignores only randomized pg_dump safety tokens, not schema differences", () => {
    const schema = "CREATE TABLE app.example (id uuid);\n";
    expect(normalizeSchemaDump(`\\restrict token\n${schema}\\unrestrict token\n`)).toBe(schema);
    expect(normalizeSchemaDump(schema)).not.toBe(
      normalizeSchemaDump(`${schema}REVOKE ALL ON SCHEMA app FROM PUBLIC;\n`),
    );
  });
});
