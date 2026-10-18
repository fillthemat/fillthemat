import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drizzleHistory, normalizeSchemaDump, stageDeclarativePreview } from "./declarative-schema";

describe("declarative preview", () => {
  it("keeps each table and its dependent objects in a parent-first table file", () => {
    const files = readdirSync("supabase/schemas")
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const tables = new Set<string>();
    for (const file of files) {
      const sql = readFileSync(join("supabase/schemas", file), "utf8");
      const declarations = [...sql.matchAll(/CREATE TABLE app\.(\w+)/g)];
      if (file === "00-app.sql" || file === "99-access.sql") {
        expect(declarations).toHaveLength(0);
        continue;
      }
      expect(declarations).toHaveLength(1);
      const table = declarations[0][1];
      expect(file).toMatch(new RegExp(`^\\d{2}-${table.replaceAll("_", "-")}\\.sql$`));
      tables.add(table);
      for (const reference of sql.matchAll(/REFERENCES app\.(\w+)/g)) {
        expect(tables.has(reference[1]), `${file} references a later table`).toBe(true);
      }
      for (const owner of sql.matchAll(/\b(?:ALTER TABLE|ON) app\.(\w+)/g)) {
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
      expect(readdirSync(migrations)).toHaveLength(history.length);
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
