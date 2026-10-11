import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { encodeSlotId } from "@/lib/schedule/slot-id";
import { loadLocalEnv } from "@/test/integration-env";

loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing local DATABASE_URL");
const localUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(localUrl.hostname)) {
  throw new Error("Booking schema reproduction requires a local database");
}
const admin = postgres(localUrl.toString(), { max: 1 });
const databaseName = `booking_schema_${randomUUID().replaceAll("-", "")}`;
localUrl.pathname = `/${databaseName}`;
const fixture = postgres(localUrl.toString(), { max: 1 });
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
const ownerId = randomUUID();
const schoolId = randomUUID();
const offeringId = randomUUID();
const windowId = randomUUID();
let post: (request: Request) => Promise<Response>;

async function applyMigrations(from: number, to: number) {
  for (const migration of migrations.slice(from, to)) {
    await fixture.begin(async (tx) => {
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
    });
  }
}

beforeAll(async () => {
  // A separate database, not a schema change to the shared Supabase database.
  await admin.unsafe(`create database "${databaseName}"`);
  await fixture`create schema auth`;
  await fixture`create table auth.users (id uuid primary key)`;
  await fixture`create schema drizzle`;
  await fixture`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
  // The hosted database at the time of the 2026-10-11 incident ended at 0009.
  await applyMigrations(0, 10);
  await fixture`insert into auth.users (id) values (${ownerId})`;
  await fixture`insert into app.users (id, email) values (${ownerId}, 'owner@local.test')`;
  await fixture`insert into app.schools (id, owner_user_id, slug, name, timezone, approved_at, published_at, notification_email) values (${schoolId}, ${ownerId}, 'schema-repro', 'Schema Repro', 'America/New_York', now(), now(), 'owner@local.test')`;
  await fixture`insert into app.trial_offerings (id, school_id, name, minimum_age, maximum_age) values (${offeringId}, ${schoolId}, 'Kids Beginner Trial', 4, 10)`;
  await fixture`insert into app.trial_windows (id, school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity) values (${windowId}, ${schoolId}, ${offeringId}, 1, 1080, 45, 8)`;
  vi.stubEnv("DATABASE_URL", localUrl.toString());
  vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T18:00:29.979Z"));
  // Only the external Siteverify boundary is stubbed; all booking SQL is real.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      expect(url).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
      return Response.json({ success: true });
    }),
  );
  vi.resetModules();
  post = (await import("./route")).POST;
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fixture.end({ timeout: 5 });
  // Only the random database created by this test is removed. FORCE closes the
  // route's cached postgres-js connection, never another worktree's database.
  await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
  await admin.end({ timeout: 5 });
});

function bookingRequest() {
  return new Request("http://localhost/api/bookings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schoolSlug: "schema-repro",
      offeringId,
      slotId: encodeSlotId(windowId, new Date("2026-10-12T22:00:00.000Z")),
      idempotencyKey: randomUUID(),
      contact: {
        name: "Contact",
        email: "contact@local.test",
        phone: "16505550123",
      },
      participant: { name: "Participant", age: 5 },
      turnstileToken: "verified-token",
    }),
  });
}

function checkDeploymentMigrations(env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync("bun", ["run", "db:check"], {
    env: { ...process.env, DATABASE_URL: localUrl.toString(), ...env },
    encoding: "utf8",
    timeout: 15_000,
  });
}

it("blocks deploying the incident schema, then completes the same booking after migration", async () => {
  const before = checkDeploymentMigrations();
  expect(before.status).toBe(1);
  expect(before.stderr).toContain("0011_youthful_grey_gargoyle");
  await expect(post(bookingRequest())).rejects.toMatchObject({
    cause: {
      code: "42703",
      message: expect.stringContaining('column "failure_reason"'),
    },
  });
  expect(
    await fixture`select count(*)::int as count from app.bookings`,
  ).toEqual([{ count: 0 }]);
  expect(
    await fixture`select count(*)::int as count from app.trial_occurrences`,
  ).toEqual([{ count: 0 }]);
  await applyMigrations(10, migrations.length);
  const after = checkDeploymentMigrations();
  expect(after.status, after.stderr).toBe(0);
  const response = await post(bookingRequest());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "booked",
    idempotent: false,
  });
  expect(
    await fixture`select count(*)::int as count from app.bookings`,
  ).toEqual([{ count: 1 }]);
  expect(
    await fixture`select count(*)::int as count from app.email_deliveries`,
  ).toEqual([{ count: 2 }]);
});

it("checks the operator DIRECT_URL when DATABASE_URL is absent", () => {
  const result = checkDeploymentMigrations({
    DATABASE_URL: "",
    DIRECT_URL: localUrl.toString(),
  });
  expect(result.status, result.stderr).toBe(0);
});

it("prefers the runtime DATABASE_URL when DIRECT_URL points elsewhere", () => {
  const result = checkDeploymentMigrations({
    DIRECT_URL:
      "postgres://private_user:private_password@127.0.0.1:1/private_db",
  });
  expect(result.status, result.stderr).toBe(0);
});

it("requires manual repair for an applied migration with a different hash", async () => {
  const migration = migrations[0];
  await fixture`update drizzle.__drizzle_migrations set hash = 'changed' where created_at = ${migration.folderMillis}`;
  try {
    const result = checkDeploymentMigrations();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "applied migration 0000_left_white_tiger hash differs",
    );
    expect(result.stderr).toContain(
      "needs manual repair; db:migrate:prod will not fix this",
    );
  } finally {
    await fixture`update drizzle.__drizzle_migrations set hash = ${migration.hash} where created_at = ${migration.folderMillis}`;
  }
});

it("requires manual repair for a missing migration older than the latest applied timestamp", async () => {
  const migration = migrations[0];
  await fixture`delete from drizzle.__drizzle_migrations where created_at = ${migration.folderMillis}`;
  try {
    const result = checkDeploymentMigrations();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "migration 0000_left_white_tiger out-of-order",
    );
    expect(result.stderr).toContain(
      "needs manual repair; db:migrate:prod will not fix this",
    );
  } finally {
    await fixture`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
  }
});

it("fails promptly when reading the journal is blocked, without logging credentials", async () => {
  await fixture.begin(async (tx) => {
    await tx`lock table drizzle.__drizzle_migrations in access exclusive mode`;
    const result = checkDeploymentMigrations();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("code=57014");
    expect(result.stderr).toContain("name=PostgresError");
    expect(result.stderr).not.toContain(localUrl.toString());
  });
  const result = checkDeploymentMigrations();
  expect(result.status, result.stderr).toBe(0);
});
