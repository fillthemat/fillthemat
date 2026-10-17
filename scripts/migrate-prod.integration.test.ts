import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { expect, it } from "vitest";
import { loadLocalEnv } from "../src/test/integration-env";
import { migrateProduction } from "./migrate-prod";

it("applies a pending migration once and rejects failed SQL", async () => {
  loadLocalEnv();
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Rehearsal requires a local database");
  const admin = postgres(url.toString(), { max: 1 });
  const name = `rehearsal_${randomUUID().replaceAll("-", "")}`;
  const folder = mkdtempSync(join(tmpdir(), "migration-rehearsal-"));
  url.pathname = `/${name}`;
  const fixture = postgres(url.toString(), { max: 1 });
  try {
    await admin.unsafe(`create database "${name}"`);
    await fixture`create schema rehearsal`;
    await fixture`create table rehearsal.counter (value int not null)`;
    await fixture`insert into rehearsal.counter values (0)`;
    mkdirSync(join(folder, "meta"));
    const entries = [{ idx: 0, version: "7", when: 1, tag: "pending", breakpoints: true }];
    const journal = () =>
      writeFileSync(
        join(folder, "meta/_journal.json"),
        JSON.stringify({ version: "7", dialect: "postgresql", entries }),
      );
    writeFileSync(join(folder, "pending.sql"), "update rehearsal.counter set value = value + 1;");
    journal();
    await migrateProduction(url.toString(), folder);
    await migrateProduction(url.toString(), folder);
    expect(await fixture`select value from rehearsal.counter`).toEqual([{ value: 1 }]);
    entries.push({
      idx: 1,
      version: "7",
      when: 2,
      tag: "failure",
      breakpoints: true,
    });
    writeFileSync(join(folder, "failure.sql"), "select * from rehearsal.missing;");
    journal();
    await expect(migrateProduction(url.toString(), folder)).rejects.toMatchObject({
      cause: { code: "42P01" },
    });
    expect(await fixture`select count(*)::int as count from drizzle.__drizzle_migrations`).toEqual([
      { count: 1 },
    ]);
  } finally {
    await fixture.end();
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
    rmSync(folder, { recursive: true, force: true });
  }
});
