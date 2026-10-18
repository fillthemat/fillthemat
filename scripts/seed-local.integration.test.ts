import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { bookingIcsUid } from "../src/lib/email/ics";
import { drizzleHistory } from "./declarative-schema";
import { getSupabaseEnv } from "./local-env";
import { seedLocal } from "./seed-local";

vi.mock("./local-env", () => ({ getSupabaseEnv: vi.fn() }));

// Independent PostgreSQL + real Auth migrations/API, never the running local stack.
const name = `fillthemat-seed-test-${crypto.randomUUID()}`;
const authName = `${name}-auth`;
const authSql = readFileSync("supabase/seeds/00-auth.sql", "utf8");
let authUrl: string;
let networkCreated = false;
const containers: string[] = [];

function docker(args: string[], input?: string) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return (args[0] === "logs" ? result.stdout + result.stderr : result.stdout).trim();
}

function query(sql: string) {
  return docker(
    [
      "exec",
      "-i",
      name,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    sql,
  );
}

function booking() {
  return JSON.parse(
    query(`SELECT row_to_json(b) FROM app.bookings b ORDER BY created_at DESC LIMIT 1`),
  );
}

beforeAll(async () => {
  docker(["network", "create", name]);
  networkCreated = true;
  docker([
    "run",
    "--detach",
    "--rm",
    "--network",
    name,
    "--network-alias",
    "db",
    "--name",
    name,
    "-p",
    "127.0.0.1::5432",
    "--entrypoint",
    "bash",
    "public.ecr.aws/supabase/postgres:17.11.0.004",
    "-c",
    'install -d -o postgres -g postgres /tmp/seed-data && su postgres -c "initdb -D /tmp/seed-data --auth=trust" >/tmp/init.log && echo "host all all 0.0.0.0/0 trust" >> /tmp/seed-data/pg_hba.conf && exec su postgres -c "postgres -D /tmp/seed-data -c listen_addresses=*"',
  ]);
  containers.push(name);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres"], {
      stdio: "ignore",
    });
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await setTimeout(500);
  }
  if (!ready) throw new Error("Disposable PostgreSQL was not ready");
  vi.mocked(getSupabaseEnv).mockResolvedValue({
    DB_URL: `postgresql://postgres@${docker(["port", name, "5432/tcp"])}/postgres`,
  });
  query(
    "CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;",
  );
  docker([
    "run",
    "--detach",
    "--network",
    name,
    "--name",
    authName,
    "-p",
    "127.0.0.1::9999",
    "-e",
    "GOTRUE_DB_DRIVER=postgres",
    "-e",
    "GOTRUE_DB_DATABASE_URL=postgresql://postgres@db:5432/postgres?search_path=auth",
    "-e",
    "GOTRUE_DB_NAMESPACE=auth",
    "-e",
    "GOTRUE_SITE_URL=http://127.0.0.1:3000",
    "-e",
    "API_EXTERNAL_URL=http://127.0.0.1:9999",
    "-e",
    "GOTRUE_API_HOST=0.0.0.0",
    "-e",
    "GOTRUE_API_PORT=9999",
    "-e",
    "GOTRUE_JWT_SECRET=disposable-local-test-secret-at-least-32-characters",
    "-e",
    "GOTRUE_JWT_AUD=authenticated",
    "-e",
    "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
    "-e",
    "GOTRUE_MAILER_AUTOCONFIRM=true",
    "public.ecr.aws/supabase/gotrue:v2.197.0",
  ]);
  containers.push(authName);
  const authState = docker([
    "inspect",
    "--format",
    "{{json .State}} {{json .NetworkSettings.Ports}}",
    authName,
  ]);
  try {
    authUrl = `http://${docker(["port", authName, "9999/tcp"])}`;
  } catch (error) {
    throw new Error(`${String(error)}\n${authState}\n${docker(["logs", authName])}`);
  }
  ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${authUrl}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* still starting */
    }
    await setTimeout(500);
  }
  if (!ready) throw new Error(`Disposable Auth was not ready: ${docker(["logs", authName])}`);
  // Native first-start phase must succeed with NO app tables yet.
  query(authSql);
  expect(query("SELECT to_regclass('app.schools') IS NULL")).toBe("t");
  await expect(seedLocal()).rejects.toThrow("apply Drizzle migrations before seeding");
  query(
    drizzleHistory(process.cwd())
      .map(({ sql }) => sql)
      .join("\n"),
  );
}, 120_000);

afterAll(() => {
  for (const container of containers.toReversed()) docker(["rm", "--force", container]);
  if (networkCreated) docker(["network", "rm", name]);
});

beforeEach(() => {
  query("TRUNCATE auth.users CASCADE;");
});

it("seeds a confirmed password login and complete app dashboard fixtures idempotently", async () => {
  await seedLocal();
  const first = booking();
  expect(first.ics_uid).toBe(bookingIcsUid(first.id));
  expect(first.participant_name_snapshot).toBe("Sam Rivera");
  expect(first.offering_name_snapshot).toBe("Kids beginner trial");
  expect(first.timezone_snapshot).toBe("America/New_York");
  expect(first.contact_email_snapshot).toBe("family@local.test");
  expect(first.contact_name_snapshot).toBe("Alex Rivera");
  expect(first.contact_phone_snapshot).toBe("555-0199");
  expect(first.participant_age_snapshot).toBe(8);
  expect(Date.parse(first.start_at)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  expect(Date.parse(first.end_at) - Date.parse(first.start_at)).toBe(3_600_000);
  expect(query("SELECT booked_count FROM app.trial_occurrences")).toBe("1");
  expect(query("SELECT capacity FROM app.trial_occurrences")).toBe("8");
  expect(query("SELECT approved_at IS NOT NULL AND published_at IS NULL FROM app.schools")).toBe(
    "t",
  );
  await seedLocal();
  expect(booking().id).toBe(first.id);
  for (const table of [
    "users",
    "schools",
    "trial_offerings",
    "trial_windows",
    "contacts",
    "participants",
    "trial_occurrences",
    "bookings",
  ]) {
    expect(query(`SELECT count(*) FROM app.${table}`)).toBe("1");
  }
  const response = await fetch(`${authUrl}/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@local.test", password: "local-dev-password" }),
  });
  const session = await response.json();
  expect(response.status, JSON.stringify(session)).toBe(200);
  expect(session.access_token).toBeTruthy();
  expect(session.user.email_confirmed_at).toBeTruthy();
  expect(query(`SELECT id FROM app.users`)).toBe(session.user.id);
});

it("keeps existing UUID/password and published school edits, renewing expired/cancelled bookings", async () => {
  query(authSql);
  query(
    "UPDATE auth.users SET encrypted_password = extensions.crypt('custom-password', extensions.gen_salt('bf'));",
  );
  const ownerId = query("SELECT id FROM auth.users");
  await seedLocal();
  query("UPDATE app.schools SET published_at = now(), slug = 'custom-demo', timezone = 'UTC';");
  const first = booking();
  query(
    "UPDATE app.bookings SET start_at = now() - interval '2 hours', end_at = now() - interval '1 hour';",
  );
  query("UPDATE app.trial_windows SET duration_minutes = 90, capacity = 12;");
  await seedLocal();
  expect(query("SELECT id FROM auth.users")).toBe(ownerId);
  expect(
    query(
      "SELECT encrypted_password = extensions.crypt('custom-password', encrypted_password) FROM auth.users",
    ),
  ).toBe("t");
  expect(query("SELECT slug || ':' || timezone FROM app.schools")).toBe("custom-demo:UTC");
  expect(booking().id).not.toBe(first.id);
  expect(booking().timezone_snapshot).toBe("UTC");
  expect(Date.parse(booking().end_at) - Date.parse(booking().start_at)).toBe(5_400_000);
  query(
    "UPDATE app.bookings SET status = 'cancelled'; UPDATE app.trial_occurrences SET booked_count = 0;",
  );
  await seedLocal();
  expect(query("SELECT count(*) FROM app.bookings")).toBe("3");
  expect(query("SELECT count(*) FROM app.trial_occurrences")).toBe("3");
  expect(query("SELECT sum(booked_count) FROM app.trial_occurrences")).toBe("1");
  expect(query("SELECT count(*) FROM app.contacts")).toBe("1");
  expect(query("SELECT count(*) FROM app.participants")).toBe("1");
});

it("reuses a non-seed upcoming booking and serializes concurrent reseeds", async () => {
  await Promise.all([seedLocal(), seedLocal()]);
  expect(query("SELECT count(*) FROM app.bookings")).toBe("1");
  query("UPDATE app.bookings SET idempotency_key = 'real-local-booking';");
  const first = booking();
  await seedLocal();
  expect(booking().id).toBe(first.id);
  expect(query("SELECT booked_count FROM app.trial_occurrences")).toBe("1");
});

it("rolls back instead of seeding another owner's conflicting demo slug", async () => {
  await seedLocal();
  query(
    "UPDATE auth.users SET email = 'other@local.test'; UPDATE app.users SET email = 'other@local.test';",
  );
  await expect(seedLocal()).rejects.toThrow(/schools_slug_unique/);
  expect(query("SELECT count(*) FROM auth.users")).toBe("1");
  expect(query("SELECT count(*) FROM app.users")).toBe("1");
  expect(query("SELECT count(*) FROM app.bookings")).toBe("1");
});
