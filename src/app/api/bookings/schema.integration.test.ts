import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { encodeSlotId } from "@/lib/schedule/slot-id";
import { loadLocalEnv, requireRow } from "@/test/integration-env";

loadLocalEnv();
const localUrl = new URL(
  requireRow(process.env.DATABASE_URL, "local database URL"),
);
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

function checkDeploymentMigrations() {
  return spawnSync("bun", ["--no-env-file", "scripts/check-migrations.ts"], {
    env: { ...process.env, DATABASE_URL: localUrl.toString() },
    encoding: "utf8",
    timeout: 15_000,
  });
}

it("blocks deploying the incident schema, then completes the same booking after migration", async () => {
  const { config } = await import("../../../../vercel");
  expect(config.buildCommand).toBe("bun run db:check && bun run build");
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
