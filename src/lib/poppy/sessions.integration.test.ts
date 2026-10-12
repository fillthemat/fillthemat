import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { POST as revoke } from "@/app/schools/[schoolId]/revoke/route";
import { POST as token } from "@/app/schools/[schoolId]/token/route";
import { runMaintenance } from "@/lib/email/maintenance";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { createTestPoppyAgent } from "@/test/poppy-agent";
import { checkPoppyRequest } from "./protected-request";
import { safeFetchNetwork } from "./safe-fetch";

loadLocalEnv(process.env.INTEGRATION_ENV_FILE);
const localUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(localUrl.hostname))
  throw new Error("Poppy Session tests require a local database");
const admin = authSql();
const databaseName = `poppy_sessions_${randomUUID().replaceAll("-", "")}`;
localUrl.pathname = `/${databaseName}`;
const sql = postgres(localUrl.toString(), { max: 1 });
let databaseCreated = false;
const schoolId = randomUUID();
const schoolB = randomUUID();

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
  for (const id of [schoolId, schoolB]) {
    const owner = randomUUID();
    await sql`insert into auth.users (id) values (${owner})`;
    await sql`insert into app.users (id, email) values (${owner}, ${`${owner}@local.test`})`;
    await sql`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email) values (${id}, ${owner}, ${`session-${owner.slice(0, 8)}`}, 'Session School', 'America/New_York', 'owner@local.test')`;
    await sql`insert into app.school_domains (school_id, domain, state, verified_at) values (${id}, ${`${id}.example`}, 'verified', now())`;
  }
}, 60000);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

async function agent(options: Parameters<typeof createTestPoppyAgent>[0] = {}) {
  const personalAgent = await createTestPoppyAgent(options);
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

it("a Personal Agent starts and renews a signed-out Session at a verified School", async () => {
  const personalAgent = await agent();
  const response = await issue(await personalAgent.tokenRequest(schoolId));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const session = await response.json();
  expect(session).toMatchObject({
    access_token: expect.any(String),
    token_type: "DPoP",
    expires_in: 600,
    scope: "",
    session_id: expect.any(String),
    signed_in: false,
  });
  const renewed = await issue(
    await personalAgent.tokenRequest(schoolId, {
      sessionId: session.session_id,
    }),
  );
  expect(renewed.status).toBe(200);
  expect(await renewed.json()).toMatchObject({
    session_id: session.session_id,
    signed_in: false,
  });
});

it("a Session authorizes only DPoP-protected requests at its own School", async () => {
  const personalAgent = await agent();
  const response = await issue(await personalAgent.tokenRequest(schoolId));
  const session = await response.json();
  const url = `https://app.fillthemat.example/poppy/schools/${schoolId}/conversations?wait=1`;
  const valid = await checkPoppyRequest(
    await personalAgent.protectedRequest(url, session.access_token),
    schoolId,
  );
  expect(valid.ok).toBe(true);
  if (!valid.ok) throw new Error("expected authorized Session");
  expect(valid.principal).toMatchObject({
    schoolId,
    sessionId: session.session_id,
    clientId: personalAgent.clientId,
    userId: personalAgent.userIdForSchool(schoolId),
    displayName: "Test Personal Agent",
    extensions: { operations: { version: "1" } },
  });
  const wrongSchool = await checkPoppyRequest(
    await personalAgent.protectedRequest(
      url.replace(schoolId, schoolB),
      session.access_token,
    ),
    schoolB,
  );
  expect(wrongSchool.ok).toBe(false);
  if (wrongSchool.ok) throw new Error("foreign token accepted");
  expect(wrongSchool.response.status).toBe(401);
  expect(await wrongSchool.response.json()).toEqual({ error: "invalid_token" });
  const bearer = new Request(url, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const rejected = await checkPoppyRequest(bearer, schoolId);
  expect(rejected.ok).toBe(false);
  if (!rejected.ok)
    expect(rejected.response.headers.get("www-authenticate")).toContain("DPoP");
});

it("renewal cannot change a Session's School, client, User or proof key, or resume an ended Session", async () => {
  const personalAgent = await agent();
  const session = await (
    await issue(await personalAgent.tokenRequest(schoolId))
  ).json();
  for (const [id, claims] of [
    [schoolB, {}],
    [schoolId, { sub: "different-user" }],
  ] as const) {
    const rejected = await issue(
      await personalAgent.tokenRequest(id, {
        sessionId: session.session_id,
        sessionClaims: claims,
      }),
      id,
    );
    expect(await rejected.json()).toEqual({ error: "invalid_session" });
  }
  const other = await createTestPoppyAgent();
  const endpoint = `https://auth.fillthemat.example/schools/${schoolId}/token`;
  const changedKey = await issue(
    await personalAgent.tokenRequest(schoolId, {
      sessionId: session.session_id,
      proof: await other.dpopProof(endpoint),
    }),
  );
  expect(await changedKey.json()).toEqual({ error: "invalid_session" });
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(other.fetchReply);
  const changedClient = await issue(
    await other.tokenRequest(schoolId, { sessionId: session.session_id }),
  );
  expect(await changedClient.json()).toEqual({ error: "invalid_session" });
  await sql`update app.poppy_sessions set ended_at = now() where id = ${session.session_id}`;
  const ended = await issue(
    await personalAgent.tokenRequest(schoolId, {
      sessionId: session.session_id,
    }),
  );
  expect(await ended.json()).toEqual({ error: "invalid_session" });
});

it("maintenance purges expired replay windows but preserves currently accepted proofs", async () => {
  const personalAgent = await agent();
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const proofJti = randomUUID();
  expect(
    (
      await issue(
        await personalAgent.tokenRequest(schoolId, {
          proofClaims: { jti: proofJti },
        }),
      )
    ).status,
  ).toBe(200);
  vi.setSystemTime(now + 180000);
  const notPurged = await issue(
    await personalAgent.tokenRequest(schoolId, {
      proofClaims: { jti: proofJti },
    }),
  );
  expect(await notPurged.json()).toEqual({ error: "invalid_dpop_proof" });
  const freshJti = randomUUID();
  expect(
    (
      await issue(
        await personalAgent.tokenRequest(schoolId, {
          proofClaims: { jti: freshJti },
        }),
      )
    ).status,
  ).toBe(200);
  const run = await runMaintenance({
    transport: {
      send: async () => ({
        ok: true,
        kind: "accepted",
        providerId: randomUUID(),
      }),
    },
  });
  expect(run.result).toBe("success");
  const stillFresh = await issue(
    await personalAgent.tokenRequest(schoolId, {
      proofClaims: { jti: freshJti },
    }),
  );
  expect(await stillFresh.json()).toEqual({ error: "invalid_dpop_proof" });
  expect(
    (
      await issue(
        await personalAgent.tokenRequest(schoolId, {
          proofClaims: { jti: proofJti },
        }),
      )
    ).status,
  ).toBe(200);
});

it("revocation authenticates the client and succeeds for unknown Account Tokens", async () => {
  const personalAgent = await agent();
  const url = `https://auth.fillthemat.example/schools/${schoolId}/revoke`;
  const authenticated = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: "unknown-account-token",
      client_id: personalAgent.clientId,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await personalAgent.clientAssertion(
        url.replace("/revoke", "/token"),
      ),
    }),
  });
  const response = await revoke(authenticated, {
    params: Promise.resolve({ schoolId }),
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const unauthenticated = await revoke(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "token=unknown",
    }),
    { params: Promise.resolve({ schoolId }) },
  );
  expect(unauthenticated.status).toBe(401);
  expect(await unauthenticated.json()).toEqual({ error: "invalid_client" });
});

it("rejects wrong assertion audience, issuer, lifetime, signature and client subject", async () => {
  const personalAgent = await agent();
  const endpoint = `https://auth.fillthemat.example/schools/${schoolId}/token`;
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { aud: endpoint.replace(schoolId, schoolB) },
    { aud: [endpoint] },
    { iss: "https://impostor.example/client.json" },
    { iat: now - 300, exp: now - 240 },
    { iat: now, exp: now + 3600 },
    { iat: now + 20, exp: now + 60 },
  ]) {
    const response = await issue(
      await personalAgent.tokenRequest(schoolId, { sessionClaims: claims }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_grant" });
  }
  const impostor = await createTestPoppyAgent();
  const badSignature = await issue(
    await personalAgent.tokenRequest(schoolId, {
      assertion: await impostor.sessionAssertion(schoolId, {
        iss: personalAgent.clientId,
      }),
    }),
  );
  expect(await badSignature.json()).toEqual({ error: "invalid_grant" });
  for (const clientClaims of [
    { sub: personalAgent.userIdForSchool(schoolId) },
    { iss: "https://impostor.example/client.json" },
    { aud: endpoint.replace(schoolId, schoolB) },
  ]) {
    const response = await issue(
      await personalAgent.tokenRequest(schoolId, { clientClaims }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_client" });
  }
});

it("atomically rejects reused Session assertions, client assertions and concurrent DPoP proofs", async () => {
  const personalAgent = await agent();
  const assertion = await personalAgent.sessionAssertion(schoolId);
  expect(
    (await issue(await personalAgent.tokenRequest(schoolId, { assertion })))
      .status,
  ).toBe(200);
  const repeated = await issue(
    await personalAgent.tokenRequest(schoolId, { assertion }),
  );
  expect(await repeated.json()).toEqual({ error: "invalid_grant" });
  const endpoint = `https://auth.fillthemat.example/schools/${schoolId}/token`;
  const clientAssertion = await personalAgent.clientAssertion(endpoint);
  expect(
    (
      await issue(
        await personalAgent.tokenRequest(schoolId, { clientAssertion }),
      )
    ).status,
  ).toBe(200);
  const repeatedClient = await issue(
    await personalAgent.tokenRequest(schoolId, { clientAssertion }),
  );
  expect(await repeatedClient.json()).toEqual({ error: "invalid_client" });
  const proof = await personalAgent.dpopProof(endpoint);
  const requests = await Promise.all([
    personalAgent.tokenRequest(schoolId, { proof }),
    personalAgent.tokenRequest(schoolId, { proof }),
  ]);
  const responses = await Promise.all(
    requests.map((request) => issue(request)),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 400,
  ]);
  expect(
    await responses.find((response) => response.status === 400)?.json(),
  ).toEqual({ error: "invalid_dpop_proof" });
});

it("rejects stale, future, wrong-method and wrong-URL token proofs", async () => {
  const personalAgent = await agent();
  const now = Math.floor(Date.now() / 1000);
  for (const proofClaims of [
    { iat: now - 61 },
    { iat: now + 30 },
    { htm: "GET" },
    { htu: `https://auth.fillthemat.example/schools/${schoolB}/token` },
  ]) {
    const response = await issue(
      await personalAgent.tokenRequest(schoolId, { proofClaims }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_dpop_proof" });
  }
});

it("protected proofs bind the token hash, key, method and URL and are consumed once", async () => {
  const personalAgent = await agent();
  const session = await (
    await issue(await personalAgent.tokenRequest(schoolId))
  ).json();
  const url = `https://app.fillthemat.example/poppy/schools/${schoolId}/operations/op_example`;
  const now = Math.floor(Date.now() / 1000);
  for (const proofClaims of [
    { ath: "incorrect" },
    { iat: now - 61 },
    { htm: "POST" },
    { htu: url.replace("op_example", "op_other") },
  ]) {
    const response = await checkPoppyRequest(
      await personalAgent.protectedRequest(url, session.access_token, {
        proofClaims,
      }),
      schoolId,
    );
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.response.status).toBe(401);
      expect(await response.response.json()).toEqual({
        error: "invalid_dpop_proof",
      });
      expect(response.response.headers.get("www-authenticate")).toContain(
        'DPoP error="invalid_dpop_proof"',
      );
    }
  }
  const other = await createTestPoppyAgent();
  const wrongKey = await checkPoppyRequest(
    await other.protectedRequest(url, session.access_token),
    schoolId,
  );
  expect(wrongKey.ok).toBe(false);
  const proof = await personalAgent.dpopProof(url, "GET", session.access_token);
  const results = await Promise.all(
    [1, 2].map(async () =>
      checkPoppyRequest(
        await personalAgent.protectedRequest(url, session.access_token, {
          proof,
        }),
        schoolId,
      ),
    ),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  const replay = results.find((result) => !result.ok);
  if (replay && !replay.ok)
    expect(await replay.response.json()).toEqual({
      error: "invalid_dpop_proof",
    });
});

it("replay storage failure fails closed at both the token and protected-request surfaces", async () => {
  const personalAgent = await agent();
  const session = await (
    await issue(await personalAgent.tokenRequest(schoolId))
  ).json();
  await sql`create function public.fail_replay() returns trigger language plpgsql as $$ begin raise exception 'replay store unavailable'; end $$`;
  await sql`create trigger fail_replay before insert on app.poppy_replays for each row execute function public.fail_replay()`;
  const logs = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const request = await issue(await personalAgent.tokenRequest(schoolId));
    expect(request.status).toBe(503);
    expect(await request.json()).toEqual({ error: "server_error" });
    const url = `https://app.fillthemat.example/poppy/schools/${schoolId}/conversations`;
    const protectedResult = await checkPoppyRequest(
      await personalAgent.protectedRequest(url, session.access_token),
      schoolId,
    );
    expect(protectedResult.ok).toBe(false);
    if (!protectedResult.ok) expect(protectedResult.response.status).toBe(503);
    expect(logs.mock.calls.flat().join(" ")).not.toContain(
      session.access_token,
    );
  } finally {
    await sql`drop trigger fail_replay on app.poppy_replays`;
    await sql`drop function public.fail_replay()`;
  }
});

it("unverified Schools and unknown hosts cannot mint Sessions", async () => {
  const personalAgent = await agent();
  const unknown = await issue(
    await personalAgent.tokenRequest(randomUUID()),
    randomUUID(),
  );
  expect(unknown.status).toBe(401);
  const request = await personalAgent.tokenRequest(schoolId);
  request.headers.set("host", "untrusted.example");
  request.headers.set("x-forwarded-host", "auth.fillthemat.example");
  expect((await issue(request)).status).toBe(401);
  await sql`update app.school_domains set state = 'pending' where school_id = ${schoolId}`;
  try {
    expect(
      (await issue(await personalAgent.tokenRequest(schoolId))).status,
    ).toBe(401);
  } finally {
    await sql`update app.school_domains set state = 'verified' where school_id = ${schoolId}`;
  }
});

it.each([
  "wrong-client-id",
  "foreign-jwks",
  "foreign-redirect",
  "private-key",
  "metadata-redirect",
  "keys-redirect",
  "unreachable",
  "private-address",
  "oversize",
])(
  "unverifiable client metadata (%s) is rejected without following redirects",
  async (failure) => {
    const personalAgent = await agent();
    if (failure === "wrong-client-id")
      personalAgent.metadata.client_id = "https://another.example/client.json";
    if (failure === "foreign-jwks")
      personalAgent.metadata.jwks_uri = "https://another.example/jwks.json";
    if (failure === "private-key")
      Object.assign(personalAgent.jwks.keys[0] ?? {}, { d: "private-value" });
    if (failure === "foreign-redirect")
      Object.assign(personalAgent.metadata, {
        redirect_uris: ["https://another.example/callback"],
      });
    if (failure === "private-address")
      vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
        { address: "127.0.0.1", family: 4 },
      ]);
    const network = vi
      .spyOn(safeFetchNetwork, "request")
      .mockImplementation(async (url) => {
        if (
          (failure === "metadata-redirect" &&
            url.href === personalAgent.clientId) ||
          (failure === "keys-redirect" &&
            url.href === personalAgent.metadata.jwks_uri)
        )
          return {
            status: 302,
            headers: new Headers({
              location: "https://another.example/redirected.json",
            }),
            body: Buffer.alloc(0),
          };
        if (failure === "unreachable") throw new Error("network unavailable");
        if (failure === "oversize")
          return {
            status: 200,
            headers: new Headers(),
            body: Buffer.alloc(65537),
          };
        return personalAgent.fetchReply(url);
      });
    const response = await issue(await personalAgent.tokenRequest(schoolId));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_client" });
    expect(network.mock.calls.map(([url]) => url.hostname)).not.toContain(
      "another.example",
    );
  },
);

it("supports published RS256 client keys as well as ES256", async () => {
  const personalAgent = await agent({ alg: "RS256" });
  expect((await issue(await personalAgent.tokenRequest(schoolId))).status).toBe(
    200,
  );
});

it("caches verified client keys and rate-limits unknown-kid refresh across requests", async () => {
  const personalAgent = await agent();
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const network = vi.spyOn(safeFetchNetwork, "request");
  expect((await issue(await personalAgent.tokenRequest(schoolId))).status).toBe(
    200,
  );
  expect(network).toHaveBeenCalledTimes(2);
  network.mockRejectedValue(new Error("offline after caching"));
  expect((await issue(await personalAgent.tokenRequest(schoolId))).status).toBe(
    200,
  );
  expect(network).toHaveBeenCalledTimes(2);
  await personalAgent.rotateClientKeys();
  const tooSoon = await issue(await personalAgent.tokenRequest(schoolId));
  expect(await tooSoon.json()).toEqual({ error: "invalid_client" });
  expect(network).toHaveBeenCalledTimes(2);
  network.mockImplementation(personalAgent.fetchReply);
  vi.setSystemTime(now + 61000);
  const refreshed = await issue(await personalAgent.tokenRequest(schoolId));
  expect(refreshed.status).toBe(200);
  expect(network).toHaveBeenCalledTimes(4);
  await personalAgent.rotateClientKeys();
  expect((await issue(await personalAgent.tokenRequest(schoolId))).status).toBe(
    401,
  );
  expect(network).toHaveBeenCalledTimes(4);
});

it("an explicit empty renewal id is invalid rather than starting another Session", async () => {
  const personalAgent = await agent();
  const original = await personalAgent.tokenRequest(schoolId);
  const form = new URLSearchParams(await original.text());
  form.set("session_id", "");
  const response = await issue(
    new Request(original.url, {
      method: "POST",
      headers: original.headers,
      body: form,
    }),
  );
  expect(await response.json()).toEqual({ error: "invalid_session" });
});

it("accepts an asymmetric RS256 DPoP key without accepting Bearer fallback", async () => {
  const personalAgent = await agent({ dpopAlg: "RS256" });
  const issued = await issue(await personalAgent.tokenRequest(schoolId));
  expect(issued.status).toBe(200);
  const session = await issued.json();
  const url = `https://app.fillthemat.example/poppy/schools/${schoolId}/conversations`;
  expect(
    (
      await checkPoppyRequest(
        await personalAgent.protectedRequest(url, session.access_token),
        schoolId,
      )
    ).ok,
  ).toBe(true);
});

it("client metadata URLs longer than User IDs remain valid client identities", async () => {
  const personalAgent = await agent({
    clientId: `https://agent-${randomUUID()}.example/${"x".repeat(300)}/client.json`,
  });
  expect((await issue(await personalAgent.tokenRequest(schoolId))).status).toBe(
    200,
  );
});

it("the test Personal Agent keeps stable opaque User IDs separately for each School issuer", async () => {
  const personalAgent = await agent();
  const principals = [];
  for (const id of [schoolId, schoolB, schoolId]) {
    const session = await (
      await issue(await personalAgent.tokenRequest(id), id)
    ).json();
    const result = await checkPoppyRequest(
      await personalAgent.protectedRequest(
        `https://app.fillthemat.example/poppy/schools/${id}/conversations`,
        session.access_token,
      ),
      id,
    );
    if (!result.ok) throw new Error("expected authorized Session");
    principals.push(result.principal);
  }
  expect(principals[0]?.userId).toBe(principals[2]?.userId);
  expect(principals[0]?.userId).not.toBe(principals[1]?.userId);
});

it("short cache expiry refreshes known keys without waiting for unknown-kid cooldown", async () => {
  const personalAgent = await agent();
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const network = vi
    .spyOn(safeFetchNetwork, "request")
    .mockImplementation(async (url) => {
      const reply = await personalAgent.fetchReply(url);
      reply.headers.set("cache-control", "max-age=1");
      return reply;
    });
  const session = await (
    await issue(await personalAgent.tokenRequest(schoolId))
  ).json();
  vi.setSystemTime(now + 2000);
  const renewed = await issue(
    await personalAgent.tokenRequest(schoolId, {
      sessionId: session.session_id,
    }),
  );
  expect(renewed.status).toBe(200);
  expect(network).toHaveBeenCalledTimes(4);
});

it("an unknown Session-assertion kid uses the same bounded registry refresh as client authentication", async () => {
  const personalAgent = await agent();
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  expect((await issue(await personalAgent.tokenRequest(schoolId))).status).toBe(
    200,
  );
  const oldKey = personalAgent.jwks.keys[0];
  if (!oldKey) throw new Error("missing test client key");
  vi.setSystemTime(now + 61000);
  const endpoint = `https://auth.fillthemat.example/schools/${schoolId}/token`;
  const oldClientAssertion = await personalAgent.clientAssertion(endpoint);
  await personalAgent.rotateClientKeys();
  personalAgent.jwks.keys.push(oldKey);
  const response = await issue(
    await personalAgent.tokenRequest(schoolId, {
      clientAssertion: oldClientAssertion,
    }),
  );
  expect(response.status).toBe(200);
});

it("expired or ended Session credentials cannot authorize protected requests", async () => {
  const personalAgent = await agent();
  const now = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const session = await (
    await issue(await personalAgent.tokenRequest(schoolId))
  ).json();
  const url = `https://app.fillthemat.example/poppy/schools/${schoolId}/conversations`;
  vi.setSystemTime(now + 601000);
  const expired = await checkPoppyRequest(
    await personalAgent.protectedRequest(url, session.access_token),
    schoolId,
  );
  expect(expired.ok).toBe(false);
  if (!expired.ok)
    expect(await expired.response.json()).toEqual({ error: "invalid_token" });
  vi.setSystemTime(now);
  await sql`update app.poppy_sessions set ended_at = now() where id = ${session.session_id}`;
  const ended = await checkPoppyRequest(
    await personalAgent.protectedRequest(url, session.access_token),
    schoolId,
  );
  expect(ended.ok).toBe(false);
  if (!ended.ok)
    expect(await ended.response.json()).toEqual({ error: "invalid_token" });
});
