import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { GET as metadata } from "@/app/.well-known/oauth-authorization-server/schools/[schoolId]/route";
import { GET as discovery } from "@/app/poppy/discovery/[schoolId]/[domain]/route";
import { getDb } from "@/db";
import { cronRuns, emailDeliveries } from "@/db/schema";
import type { EmailMessage } from "@/lib/email/dependencies";
import { runMaintenance } from "@/lib/email/maintenance";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { checkSchoolDomain } from "./domain-check";
import {
  connectSchoolDomain,
  listSchoolDomains,
  removeSchoolDomain,
} from "./domains";
import { safeFetchNetwork } from "./safe-fetch";

loadLocalEnv(process.env.INTEGRATION_ENV_FILE);
const localUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(localUrl.hostname))
  throw new Error("Domain maintenance tests require a local database");
const admin = authSql();
const databaseName = `domain_maintenance_${randomUUID().replaceAll("-", "")}`;
let databaseCreated = false;
localUrl.pathname = `/${databaseName}`;
const sql = postgres(localUrl.toString(), { max: 1 });
let db: ReturnType<typeof getDb>;
const owners = [randomUUID(), randomUUID()];
const runIds: string[] = [];
const emails: EmailMessage[] = [];
let schoolId = "";
let schoolB = "";
let target = "";
let domain = "";

beforeAll(async () => {
  await admin.unsafe(`create database "${databaseName}"`);
  databaseCreated = true;
  await sql`create schema auth`;
  await sql`create table auth.users (id uuid primary key)`;
  for (const migration of readMigrationFiles({ migrationsFolder: "drizzle" }))
    await sql.begin(async (tx) => {
      for (const statement of migration.sql) await tx.unsafe(statement);
    });
  vi.stubEnv("DATABASE_URL", localUrl.toString());
  db = getDb();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.fillthemat.example");
  vi.stubEnv("POPPY_AUTH_ORIGIN", "https://auth.fillthemat.example");
  schoolId = randomUUID();
  schoolB = randomUUID();
  for (const [index, id] of [schoolId, schoolB].entries()) {
    const owner = requireRow(owners[index], "owner");
    await sql`insert into auth.users (id) values (${owner})`;
    await sql`insert into app.users (id, email) values (${owner}, ${`${owner}@local.test`})`;
    await sql`insert into app.schools (id, owner_user_id, slug, name, timezone, approved_at, notification_email) values (${id}, ${owner}, ${`domain-maintenance-${owner.slice(0, 8)}`}, 'Domain Maintenance School', 'America/New_York', now(), 'owner@local.test')`;
  }
}, 60000);
afterAll(async () => {
  for (const id of runIds) await db.delete(cronRuns).where(eq(cronRuns.id, id));
  await sql.end({ timeout: 5 });
  if (databaseCreated)
    await admin.unsafe(
      `drop database if exists "${databaseName}" with (force)`,
    );
  await admin.end({ timeout: 5 });
  vi.unstubAllEnvs();
}, 60000);
afterEach(async () => {
  for (const id of [schoolId, schoolB])
    for (const connection of await listSchoolDomains(id))
      await removeSchoolDomain(id, connection.domain);
  await db.delete(emailDeliveries);
  emails.length = 0;
  vi.restoreAllMocks();
});

async function verifiedDomain() {
  domain = `maintenance-${randomUUID()}.example`;
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  await connectSchoolDomain(schoolId, domain);
  target = requireRow(
    (await listSchoolDomains(schoolId))[0],
    "domain",
  ).discoveryUrl;
  passingFetch();
  expect(await checkSchoolDomain(schoolId, domain)).toEqual({
    ok: true,
    mode: "redirect",
  });
}
function passingFetch() {
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(async (url) => ({
    status: url.hostname === domain ? 302 : 200,
    headers: new Headers(url.hostname === domain ? { location: target } : {}),
    body: Buffer.from("{}"),
  }));
}
function failingFetch() {
  vi.spyOn(safeFetchNetwork, "request").mockResolvedValue({
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    body: Buffer.from("Missing discovery"),
  });
}
async function maintenance() {
  const run = await runMaintenance({
    transport: {
      send: async (message) => {
        emails.push(message);
        return { ok: true, kind: "accepted", providerId: randomUUID() };
      },
    },
  });
  runIds.push(run.id);
  expect(run.result).toBe("success");
}
async function advertisedDomains(id = schoolId) {
  const response = await metadata(
    new Request(
      `https://auth.fillthemat.example/.well-known/oauth-authorization-server/schools/${id}`,
    ),
    { params: Promise.resolve({ schoolId: id }) },
  );
  return response.status === 404 ? [] : (await response.json()).poppy_domains;
}

it("rechecks a verified School domain and records a failed result without hiding it", async () => {
  await verifiedDomain();
  const pending = `pending-${randomUUID()}.example`;
  await connectSchoolDomain(schoolId, pending);
  failingFetch();
  await maintenance();
  expect(
    (await listSchoolDomains(schoolId)).find((row) => row.domain === domain),
  ).toMatchObject({
    state: "failing",
    consecutiveFailures: 1,
    lastCheckResult: "no_redirect",
    lastCheckedAt: expect.any(Date),
  });
  expect(
    (await listSchoolDomains(schoolId)).find((row) => row.domain === pending),
  ).toMatchObject({
    state: "pending",
    consecutiveFailures: 0,
    lastCheckedAt: null,
  });
  expect(await advertisedDomains()).toEqual([domain]);
  expect(
    (
      await discovery(new Request(target), {
        params: Promise.resolve({ schoolId, domain }),
      })
    ).status,
  ).toBe(200);
  expect(emails).toEqual([]);
});

it("keeps two failures live, drops the third, durably emails the owner, and frees the domain for another School", async () => {
  await verifiedDomain();
  failingFetch();
  for (const count of [1, 2]) {
    await maintenance();
    expect((await listSchoolDomains(schoolId))[0]).toMatchObject({
      state: "failing",
      consecutiveFailures: count,
    });
    expect(await advertisedDomains()).toEqual([domain]);
    expect(emails).toEqual([]);
  }
  await maintenance();
  expect(await listSchoolDomains(schoolId)).toEqual([]);
  expect(await advertisedDomains()).toEqual([]);
  expect(
    (
      await discovery(new Request(target), {
        params: Promise.resolve({ schoolId, domain }),
      })
    ).status,
  ).toBe(404);
  expect(emails).toHaveLength(1);
  expect(emails[0]).toMatchObject({
    to: "owner@local.test",
    text: expect.stringContaining(domain),
  });
  expect(emails[0]?.text).toContain("3 consecutive checks");
  expect(emails[0]?.text).toContain(
    "https://app.fillthemat.example/dashboard/settings?section=poppy",
  );
  expect(
    await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.schoolId, schoolId)),
  ).toMatchObject([
    {
      kind: "owner_poppy_domain_dropped",
      domainSnapshot: domain,
      state: "sent",
    },
  ]);
  await maintenance();
  expect(emails).toHaveLength(1);
  await connectSchoolDomain(schoolB, domain);
  target = requireRow(
    (await listSchoolDomains(schoolB))[0],
    "new binding",
  ).discoveryUrl;
  passingFetch();
  expect(await checkSchoolDomain(schoolB, domain)).toEqual({
    ok: true,
    mode: "redirect",
  });
  expect(await advertisedDomains(schoolB)).toEqual([domain]);
});

it("a passing daily check resets consecutive failures before another failure", async () => {
  await verifiedDomain();
  failingFetch();
  await maintenance();
  await maintenance();
  passingFetch();
  await maintenance();
  expect((await listSchoolDomains(schoolId))[0]).toMatchObject({
    state: "verified",
    consecutiveFailures: 0,
    lastCheckResult: "passed",
  });
  failingFetch();
  await maintenance();
  expect((await listSchoolDomains(schoolId))[0]).toMatchObject({
    state: "failing",
    consecutiveFailures: 1,
  });
  expect(await advertisedDomains()).toEqual([domain]);
  expect(emails).toEqual([]);
});

it("retains the domain notification for retry after removal when email delivery fails", async () => {
  await verifiedDomain();
  failingFetch();
  await maintenance();
  await maintenance();
  const run = await runMaintenance({
    transport: {
      send: async () => ({
        ok: false,
        kind: "internal",
        reason: "network_error",
        message: "Email provider unavailable",
      }),
    },
  });
  runIds.push(run.id);
  expect(run.result).toBe("success");
  expect(await listSchoolDomains(schoolId)).toEqual([]);
  const queued = requireRow(
    (
      await db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.schoolId, schoolId))
    )[0],
    "queued email",
  );
  expect(queued).toMatchObject({
    kind: "owner_poppy_domain_dropped",
    domainSnapshot: domain,
    state: "failed",
  });
  await db
    .update(emailDeliveries)
    .set({ nextAttemptAt: new Date(0) })
    .where(eq(emailDeliveries.id, queued.id));
  await maintenance();
  expect(emails).toHaveLength(1);
  expect(emails[0]?.text).toContain(domain);
  expect(emails[0]?.idempotencyKey).toBe(queued.providerIdempotencyKey);
});

it("overlapping maintenance checks do not count the same in-flight failure twice", async () => {
  await verifiedDomain();
  failingFetch();
  await maintenance();
  let release: () => void = () => {};
  let started: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetching = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(async () => {
    started();
    await gate;
    return {
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      body: Buffer.from("Missing discovery"),
    };
  });
  const first = maintenance();
  try {
    await fetching;
    await maintenance();
  } finally {
    release();
    await first;
  }
  expect((await listSchoolDomains(schoolId))[0]).toMatchObject({
    state: "failing",
    consecutiveFailures: 2,
  });
  expect(await advertisedDomains()).toEqual([domain]);
  expect(emails).toEqual([]);
});
