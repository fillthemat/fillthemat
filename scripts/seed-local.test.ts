import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCAL_WHATSAPP_PHONE_NUMBER_ID } from "../src/lib/whatsapp/config";
import { localSeedDatabaseUrl } from "./seed-local";

describe("local SQL seed runner", () => {
  it("uses only the local database reported by Supabase, not environment URLs", () => {
    const url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    expect(localSeedDatabaseUrl({ DB_URL: url })).toBe(url);
    for (const value of [
      "postgresql://postgres:password@db.example.com/postgres",
      "postgresql://postgres:password@localhost/production",
      "postgresql://other:password@localhost/postgres",
      "postgresql://postgres:password@localhost/postgres?host=db.example.com",
    ]) {
      expect(() => localSeedDatabaseUrl({ DB_URL: value })).toThrow("Refusing to seed");
    }
    expect(() => localSeedDatabaseUrl({})).toThrow("DB_URL");
  });

  it("keeps native startup independent of app migrations", () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    expect(config).toContain('sql_paths = ["./seeds/00-auth.sql"]');
    const auth = readFileSync("supabase/seeds/00-auth.sql", "utf8");
    expect(auth).not.toMatch(/\b(?:app|public)\./);
  });

  it("keeps fixtures as DML and the WhatsApp stub consistent", () => {
    const app = readFileSync("supabase/seeds/10-app.sql", "utf8");
    expect(app).toContain(`'${LOCAL_WHATSAPP_PHONE_NUMBER_ID}'`);
    for (const file of ["00-auth.sql", "10-app.sql"]) {
      const sql = readFileSync(`supabase/seeds/${file}`, "utf8").replace(/--[^\n]*/g, "");
      expect(sql).not.toMatch(/\b(?:CREATE|ALTER|DROP|TRUNCATE|DELETE)\b|\bDO\s+\$/i);
      expect(sql).not.toMatch(/\bpublic\./);
    }
  });
});
