import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadLocalEnv } from "../src/test/integration-env";

loadLocalEnv();
const url = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw new Error("Deployment rehearsal requires a local database");
const admin = postgres(url.toString(), { max: 1 });
const databaseName = `deploy_rehearsal_${randomUUID().replaceAll("-", "")}`;
url.pathname = `/${databaseName}`;
const fixture = postgres(url.toString(), { max: 1 });
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
const directory = mkdtempSync(join(tmpdir(), "deploy-rehearsal-"));
const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));

beforeAll(async () => {
  await admin.unsafe(`create database "${databaseName}"`);
  await fixture`create schema auth`;
  await fixture`create table auth.users (id uuid primary key)`;
  await fixture`create schema drizzle`;
  await fixture`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  // Reproduce the incident watermark: 0000–0009 already applied.
  for (const migration of migrations.slice(0, 10)) {
    await fixture.begin(async (tx) => {
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
    });
  }
  cpSync("scripts", join(directory, "scripts"), { recursive: true });
  cpSync("drizzle", join(directory, "drizzle"), { recursive: true });
  symlinkSync(resolve("node_modules"), join(directory, "node_modules"), "dir");
  // Only Next's build is replaced; migrate/check and orchestration are real.
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      scripts: {
        "build:vercel": scripts["build:vercel"],
        "db:migrate:deploy": scripts["db:migrate:deploy"],
        "db:check": scripts["db:check"],
        build: "echo application-build-reached",
      },
    }),
  );
});

afterAll(async () => {
  await fixture.end({ timeout: 5 });
  await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
  await admin.end({ timeout: 5 });
  rmSync(directory, { recursive: true, force: true });
});

function build(environment = "production", directUrl = url.toString()) {
  return spawnSync("bun", ["run", "build:vercel"], {
    cwd: directory,
    env: {
      ...process.env,
      VERCEL_ENV: environment,
      DIRECT_URL: directUrl,
      DATABASE_URL: url.toString(),
    },
    encoding: "utf8",
    timeout: 20_000,
  });
}

it("applies pending additive migrations before checking and building, then retries without reapplying", async () => {
  const before =
    await fixture`select * from drizzle.__drizzle_migrations order by id`;
  expect(before).toHaveLength(10);
  const result = build();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Database migrations are up to date");
  expect(result.stdout).toContain("application-build-reached");
  const applied =
    await fixture`select * from drizzle.__drizzle_migrations order by id`;
  expect(applied).toHaveLength(migrations.length);
  expect(applied.slice(0, 10)).toEqual(before);
  expect(
    await fixture`select column_name from information_schema.columns where table_schema = 'app' and table_name = 'email_deliveries' and column_name = 'failure_reason'`,
  ).toHaveLength(1);
  const retry = build();
  expect(retry.status, retry.stderr).toBe(0);
  expect(
    await fixture`select * from drizzle.__drizzle_migrations order by id`,
  ).toEqual(applied);
});

it("stops before the check and build when migration SQL fails", async () => {
  // A malformed additive migration exists only in this temporary fixture.
  const journalPath = join(directory, "drizzle/meta/_journal.json");
  const original = readFileSync(journalPath, "utf8");
  const journal = JSON.parse(original);
  journal.entries.push({
    idx: migrations.length,
    version: "7",
    when: migrations[migrations.length - 1].folderMillis + 1,
    tag: "rehearsal_failure",
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(
    join(directory, "drizzle/rehearsal_failure.sql"),
    "select * from rehearsal_missing_table;",
  );
  try {
    const result = build();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Deployment migration failed");
    expect(result.stdout).not.toContain("read-only check");
    expect(result.stdout).not.toContain("application-build-reached");
    expect(
      await fixture`select count(*)::int as count from drizzle.__drizzle_migrations`,
    ).toEqual([{ count: migrations.length }]);
  } finally {
    writeFileSync(journalPath, original);
  }
});

it("retains the read-only check as a backstop after migration", async () => {
  const migration = migrations[0];
  await fixture`update drizzle.__drizzle_migrations set hash = 'changed' where created_at = ${migration.folderMillis}`;
  try {
    const result = build();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Deployment migrations completed");
    expect(result.stderr).toContain("hash differs");
    expect(result.stdout).not.toContain("application-build-reached");
  } finally {
    await fixture`update drizzle.__drizzle_migrations set hash = ${migration.hash} where created_at = ${migration.folderMillis}`;
  }
});

it("builds Preview without migration credentials or database writes", async () => {
  const before =
    await fixture`select * from drizzle.__drizzle_migrations order by id`;
  const result = build("preview", "");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("application-build-reached");
  expect(
    await fixture`select * from drizzle.__drizzle_migrations order by id`,
  ).toEqual(before);
});
