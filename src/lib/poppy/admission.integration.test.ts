import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { POST as token } from "@/app/schools/[schoolId]/token/route";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { createTestPoppyAgent } from "@/test/poppy-agent";
import { checkPoppyRequest } from "./protected-request";
import { safeFetchNetwork } from "./safe-fetch";

loadLocalEnv();
const localUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(localUrl.hostname))
  throw new Error("Poppy admission tests require a local database");
const admin = authSql();
const databaseName = `poppy_admission_${randomUUID().replaceAll("-", "")}`;
localUrl.pathname = `/${databaseName}`;
const sql = postgres(localUrl.toString(), { max: 1 });
let databaseCreated = false;
const schools = [randomUUID(), randomUUID()];
const schoolId = schools[0];
if (!schoolId) throw new Error("missing School fixture");

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
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.fillthemat.example");
  vi.stubEnv("POPPY_AUTH_ORIGIN", "https://auth.fillthemat.example");
  for (const id of schools) {
    const owner = randomUUID();
    await sql`insert into auth.users (id) values (${owner})`;
    await sql`insert into app.users (id, email) values (${owner}, ${`${owner}@local.test`})`;
    await sql`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email) values (${id}, ${owner}, ${`admission-${owner}`}, 'Admission School', 'America/New_York', 'owner@local.test')`;
    await sql`insert into app.school_domains (school_id, domain, state, verified_at) values (${id}, ${`${id}.example`}, 'verified', now())`;
  }
}, 60000);
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Only this disposable database is affected; never reset the shared stack.
  await sql`delete from app.poppy_sessions`;
  await sql`delete from app.poppy_clients`;
  await sql`delete from app.poppy_blocked_clients`;
  await sql`delete from app.poppy_client_admissions`;
});
afterAll(async () => {
  await sql.end({ timeout: 5 });
  if (databaseCreated)
    await admin.unsafe(
      `drop database if exists "${databaseName}" with (force)`,
    );
  await admin.end({ timeout: 5 });
  vi.unstubAllEnvs();
}, 60000);

async function agent() {
  const personalAgent = await createTestPoppyAgent();
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(
    personalAgent.fetchReply,
  );
  return personalAgent;
}
const issue = (request: Request, id = schoolId) =>
  token(request, { params: Promise.resolve({ schoolId: id }) });

it("blocking a Personal Agent cuts off new Sessions, renewal and existing tokens at every School", async () => {
  const personalAgent = await agent();
  const sessions = [];
  for (const id of schools) {
    const response = await issue(await personalAgent.tokenRequest(id), id);
    expect(response.status).toBe(200);
    sessions.push(await response.json());
  }
  await sql`insert into app.poppy_blocked_clients (client_id) values (${personalAgent.clientId})`;
  const network = vi.spyOn(safeFetchNetwork, "request");
  network.mockClear();
  for (const [index, id] of schools.entries()) {
    const session = sessions[index];
    for (const sessionId of [undefined, session.session_id]) {
      const response = await issue(
        await personalAgent.tokenRequest(id, { sessionId }),
        id,
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid_client" });
    }
    const result = await checkPoppyRequest(
      await personalAgent.protectedRequest(
        `https://app.fillthemat.example/poppy/schools/${id}/conversations`,
        session.access_token,
      ),
      id,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toEqual({ error: "invalid_client" });
    }
  }
  expect(network).not.toHaveBeenCalled();
});

it("admits 25 new clients per UTC day across Schools, refuses the 26th before fetching, and keeps known clients usable", async () => {
  const now = new Date();
  now.setUTCHours(23, 59, 0, 0);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const known = await agent();
  const first = await issue(await known.tokenRequest(schoolId));
  expect(first.status).toBe(200);
  const session = await first.json();
  for (let i = 1; i < 25; i++) {
    const personalAgent = await agent();
    const id = schools[i % 2] ?? schoolId;
    expect((await issue(await personalAgent.tokenRequest(id), id)).status).toBe(
      200,
    );
  }
  const refused = await agent();
  const network = vi.spyOn(safeFetchNetwork, "request");
  network.mockClear();
  const response = await issue(await refused.tokenRequest(schoolId));
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: "invalid_client" });
  expect(response.headers.get("retry-after")).toBe("60");
  expect(network).not.toHaveBeenCalled();
  for (const sessionId of [undefined, session.session_id])
    expect(
      (await issue(await known.tokenRequest(schoolId, { sessionId }))).status,
    ).toBe(200);
  vi.setSystemTime(now.getTime() + 60000);
  expect((await issue(await refused.tokenRequest(schoolId))).status).toBe(200);
});

it("allows only 60 Session creations per client in a rolling hour across Schools, atomically, without charging renewals", async () => {
  const personalAgent = await agent();
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const first = await issue(await personalAgent.tokenRequest(schoolId));
  expect(first.status).toBe(200);
  const session = await first.json();
  for (let i = 1; i < 59; i++) {
    const id = schools[i % 2] ?? schoolId;
    expect((await issue(await personalAgent.tokenRequest(id), id)).status).toBe(
      200,
    );
  }
  const concurrent = await Promise.all(
    [1, 2].map(async () => issue(await personalAgent.tokenRequest(schoolId))),
  );
  expect(concurrent.map((response) => response.status).sort()).toEqual([
    200, 429,
  ]);
  const limited = await issue(await personalAgent.tokenRequest(schoolId));
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "rate_limited" });
  expect(limited.headers.get("retry-after")).toBe("3600");
  expect(
    (
      await issue(
        await personalAgent.tokenRequest(schoolId, {
          sessionId: session.session_id,
        }),
      )
    ).status,
  ).toBe(200);
  const independent = await agent();
  expect((await issue(await independent.tokenRequest(schoolId))).status).toBe(
    200,
  );
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(
    personalAgent.fetchReply,
  );
  vi.setSystemTime(now + 3600000);
  expect((await issue(await personalAgent.tokenRequest(schoolId))).status).toBe(
    200,
  );
});

it("a platform block can reject a never-seen client without fetching metadata", async () => {
  const personalAgent = await agent();
  await sql`insert into app.poppy_blocked_clients (client_id) values (${personalAgent.clientId})`;
  const network = vi.spyOn(safeFetchNetwork, "request");
  for (const id of schools) {
    const response = await issue(await personalAgent.tokenRequest(id), id);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_client" });
  }
  expect(network).not.toHaveBeenCalled();
});

it("concurrent client admissions reserve the last daily slot before fetching and do not charge one identity twice", async () => {
  for (let i = 0; i < 24; i++) {
    const personalAgent = await agent();
    expect(
      (await issue(await personalAgent.tokenRequest(schoolId))).status,
    ).toBe(200);
  }
  const last = await createTestPoppyAgent();
  const overflow = await createTestPoppyAgent();
  let started: () => void = () => {};
  const fetching = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const network = vi
    .spyOn(safeFetchNetwork, "request")
    .mockImplementation(async (url) => {
      if (url.href === last.clientId) {
        started();
        await gate;
      }
      return last.fetchReply(url);
    });
  const pending = issue(await last.tokenRequest(schoolId));
  await fetching;
  try {
    const duplicate = await issue(await last.tokenRequest(schoolId));
    expect(duplicate.status).toBe(429);
    expect(Number(duplicate.headers.get("retry-after"))).toBeGreaterThan(0);
    const rejected = await issue(await overflow.tokenRequest(schoolId));
    expect(rejected.status).toBe(429);
    expect(Number(rejected.headers.get("retry-after"))).toBeLessThanOrEqual(25);
    expect(
      network.mock.calls.some(([url]) => url.href === overflow.clientId),
    ).toBe(false);
  } finally {
    release();
  }
  expect((await pending).status).toBe(200);
  expect((await issue(await last.tokenRequest(schoolId))).status).toBe(200);
  expect((await issue(await overflow.tokenRequest(schoolId))).status).toBe(429);
});

it("failed client metadata releases its reservation so valid clients can still be admitted", async () => {
  for (let i = 0; i < 25; i++) {
    const personalAgent = await agent();
    personalAgent.metadata.client_id = "https://impostor.example/client.json";
    const response = await issue(await personalAgent.tokenRequest(schoolId));
    expect(response.status).toBe(401);
  }
  const valid = await agent();
  expect((await issue(await valid.tokenRequest(schoolId))).status).toBe(200);
});

it("an expired admission worker cannot overwrite a newer admission or release its slot", async () => {
  const personalAgent = await agent();
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  let started: () => void = () => {};
  const fetching = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstFetch = true;
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(async (url) => {
    if (firstFetch) {
      firstFetch = false;
      started();
      await gate;
    }
    return personalAgent.fetchReply(url);
  });
  const old = issue(await personalAgent.tokenRequest(schoolId));
  await fetching;
  try {
    vi.setSystemTime(now + 26000);
    expect(
      (await issue(await personalAgent.tokenRequest(schoolId))).status,
    ).toBe(200);
  } finally {
    release();
  }
  expect((await old).status).toBe(401);
  expect((await issue(await personalAgent.tokenRequest(schoolId))).status).toBe(
    200,
  );
});

it("admission storage failure fails closed before metadata fetching", async () => {
  const personalAgent = await agent();
  const network = vi.spyOn(safeFetchNetwork, "request");
  await sql`create function public.fail_admission() returns trigger language plpgsql as $$ begin raise exception 'admission store unavailable'; end $$`;
  await sql`create trigger fail_admission before insert on app.poppy_client_admissions for each row execute function public.fail_admission()`;
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await issue(await personalAgent.tokenRequest(schoolId));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "server_error" });
    expect(network).not.toHaveBeenCalled();
    expect(logs.mock.calls.flat().join(" ")).not.toContain(
      personalAgent.clientId,
    );
  } finally {
    await sql`drop trigger fail_admission on app.poppy_client_admissions`;
    await sql`drop function public.fail_admission()`;
  }
  expect((await issue(await personalAgent.tokenRequest(schoolId))).status).toBe(
    200,
  );
});
