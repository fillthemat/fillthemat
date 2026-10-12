import { randomUUID } from "node:crypto";
import SwaggerParser from "@apidevtools/swagger-parser";
import { MockLanguageModelV4 } from "ai/test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { loadBookings } from "@/app/dashboard/bookings/queries";
import { GET as discovery } from "@/app/poppy/discovery/[schoolId]/[domain]/route";
import { GET as status } from "@/app/poppy/schools/[schoolId]/bookings/[bookingId]/route";
import { POST as create } from "@/app/poppy/schools/[schoolId]/bookings/route";
import { POST as start } from "@/app/poppy/schools/[schoolId]/conversations/route";
import { GET as description } from "@/app/poppy/schools/[schoolId]/openapi.json/route";
import { POST as confirm } from "@/app/poppy/schools/[schoolId]/operations/[operationId]/confirm/route";
import { GET as readOperation } from "@/app/poppy/schools/[schoolId]/operations/[operationId]/route";
import { GET as list } from "@/app/poppy/schools/[schoolId]/trial-occurrences/route";
import { POST as token } from "@/app/schools/[schoolId]/token/route";
import * as languageModel from "@/lib/ai/language-model";
import { listOpenSlots } from "@/lib/schedule/occurrences";
import { encodeSlotId } from "@/lib/schedule/slot-id";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { createTestPoppyAgent } from "@/test/poppy-agent";
import { safeFetchNetwork } from "./safe-fetch";

const deferred = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", () => ({
  after: (work: () => Promise<unknown>) => deferred.push(work()),
}));

loadLocalEnv(process.env.INTEGRATION_ENV_FILE);
const localUrl = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(localUrl.hostname))
  throw new Error("Poppy booking API tests require a local database");
const admin = authSql();
const databaseName = `poppy_booking_api_${randomUUID().replaceAll("-", "")}`;
localUrl.pathname = `/${databaseName}`;
const sql = postgres(localUrl.toString(), { max: 1 });
let databaseCreated = false;
const schoolId = randomUUID();
const otherSchoolId = randomUUID();
const domain = "booking-api.example";
const origin = "https://app.fillthemat.example";
const params = () => ({ params: Promise.resolve({ schoolId }) });
const root = `${origin}/poppy/schools/${schoolId}`;
const offeringId = randomUUID();
const otherOfferingId = randomUUID();
const otherWindowId = randomUUID();
const window = {
  id: randomUUID(),
  trialOfferingId: offeringId,
  dayOfWeek: 3,
  startMinute: 1080,
  durationMinutes: 60,
  capacity: 10,
  active: true,
  label: null,
};
const slots = listOpenSlots({
  offeringId,
  timezone: "America/New_York",
  windows: [window],
  occurrences: [],
  now: new Date(),
});
const slot = slots[0];
if (!slot || !slots[1]) throw new Error("missing trial fixtures");

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
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin);
  vi.stubEnv("POPPY_AUTH_ORIGIN", "https://auth.fillthemat.example");
  vi.stubEnv(
    "POPPY_CANCEL_LINK_SECRET",
    "booking-api-test-secret-at-least-32-characters",
  );
  const owner = randomUUID();
  await sql`insert into auth.users (id) values (${owner})`;
  await sql`insert into app.users (id, email) values (${owner}, 'owner@local.test')`;
  await sql`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email, approved_at, published_at) values (${schoolId}, ${owner}, 'booking-api-test', 'API School', 'America/New_York', 'owner@local.test', now(), now())`;
  await sql`insert into app.school_domains (school_id, domain, state, verified_at) values (${schoolId}, ${domain}, 'verified', now())`;
  await sql`insert into app.trial_offerings (id, school_id, name, description, minimum_age, maximum_age, attire) values (${offeringId}, ${schoolId}, 'Junior Trial', 'A first martial-arts class', 5, 15, 'Training clothes')`;
  await sql`insert into app.trial_windows (id, school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity) values (${window.id}, ${schoolId}, ${offeringId}, 3, 1080, 60, 10)`;
  const otherOwner = randomUUID();
  await sql`insert into auth.users (id) values (${otherOwner})`;
  await sql`insert into app.users (id, email) values (${otherOwner}, 'other-owner@local.test')`;
  await sql`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email, approved_at, published_at) values (${otherSchoolId}, ${otherOwner}, 'other-api-school', 'Other School', 'America/New_York', 'other-owner@local.test', now(), now())`;
  await sql`insert into app.school_domains (school_id, domain, state, verified_at) values (${otherSchoolId}, 'other-api.example', 'verified', now())`;
  await sql`insert into app.trial_offerings (id, school_id, name) values (${otherOfferingId}, ${otherSchoolId}, 'Other Trial')`;
  await sql`insert into app.trial_windows (id, school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity) values (${otherWindowId}, ${otherSchoolId}, ${otherOfferingId}, 3, 1080, 60, 10)`;
}, 60000);
afterEach(async () => {
  await Promise.all(deferred.splice(0));
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

it("discovery points to a public, valid OpenAPI 3.1 description with DPoP and booking Operations", async () => {
  const response = await discovery(
    new Request(`${origin}/poppy/discovery/${schoolId}/${domain}`),
    { params: Promise.resolve({ schoolId, domain }) },
  );
  const document = await response.json();
  expect(document.apis).toEqual([
    {
      type: "openapi",
      url: `${root}/openapi.json`,
      description: expect.any(String),
    },
  ]);
  const result = await description(new Request(document.apis[0].url), params());
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("public, max-age=300");
  const api = await result.json();
  await expect(
    SwaggerParser.validate(structuredClone(api)),
  ).resolves.toBeDefined();
  expect(api.openapi).toBe("3.1.0");
  expect(api.servers).toEqual([{ url: root }]);
  expect(api.security).toEqual([{ SessionToken: [], DPoPProof: [] }]);
  expect(
    api.paths["/bookings"].post.responses["202"].content["application/json"]
      .schema,
  ).toEqual({
    type: "object",
    required: ["operation"],
    properties: { operation: { $ref: "#/components/schemas/Operation" } },
  });
  expect(api.paths["/bookings"].post.description).toContain("Operations");
});

async function caller(operationsSupported = true) {
  const agent = await createTestPoppyAgent();
  if (!operationsSupported) agent.metadata.extensions.operations.version = "2";
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(agent.fetchReply);
  const response = await token(await agent.tokenRequest(schoolId), params());
  expect(response.status).toBe(200);
  const session = await response.json();
  return {
    agent,
    session,
    request: (path: string, body?: unknown) =>
      agent.protectedRequest(`${root}/${path}`, session.access_token, {
        method: body === undefined ? "GET" : "POST",
        body,
      }),
  };
}

it("lists only upcoming trials with remaining capacity and active Offering eligibility", async () => {
  const user = await caller();
  const full = slots[1];
  await sql`insert into app.trial_occurrences (school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity, booked_count) values (${schoolId}, ${window.id}, ${offeringId}, ${full.startAt}, ${full.endAt}, 10, 10)`;
  try {
    const response = await list(
      await user.request("trial-occurrences"),
      params(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(
      body.occurrences.every(
        (row: { offering: { id: string } }) => row.offering.id === offeringId,
      ),
    ).toBe(true);
    expect(body.occurrences).toContainEqual({
      occurrence_id: slot.slotId,
      start: slot.startAt.toISOString(),
      end: slot.endAt.toISOString(),
      time_zone: "America/New_York",
      remaining_capacity: 10,
      offering: {
        id: offeringId,
        name: "Junior Trial",
        description: "A first martial-arts class",
        minimum_age: 5,
        maximum_age: 15,
      },
    });
    expect(
      body.occurrences.some(
        (row: { occurrence_id: string }) => row.occurrence_id === full.slotId,
      ),
    ).toBe(false);
    await sql`update app.trial_offerings set active = false where id = ${offeringId}`;
    const inactive = await list(
      await user.request("trial-occurrences"),
      params(),
    );
    expect(await inactive.json()).toEqual({ occurrences: [] });
  } finally {
    await sql`update app.trial_offerings set active = true where id = ${offeringId}`;
    await sql`delete from app.trial_occurrences where school_id = ${schoolId}`;
  }
});

let phoneSequence = 0;
function bookingRequest() {
  return {
    occurrence_id: slot.slotId,
    participant: { name: "Sam", age: 10 },
    contact: {
      name: "Pat",
      email: `${randomUUID()}@local.test`,
      phone: `+1555186${String(++phoneSequence).padStart(4, "0")}`,
    },
  };
}

it("create returns 202 without booking; identical concurrent requests reuse an Operation and repeated confirm books exactly once", async () => {
  const user = await caller();
  const input = bookingRequest();
  const responses = await Promise.all(
    [1, 2].map(async () =>
      create(await user.request("bookings", input), params()),
    ),
  );
  expect(responses.map((response) => response.status)).toEqual([202, 202]);
  const [{ operation }, retry] = await Promise.all(
    responses.map((response) => response.json()),
  );
  expect(retry).toEqual({ operation });
  expect(operation).toMatchObject({
    state: "proposed",
    user_approval_required: true,
    terms: {
      school: { id: schoolId, name: "API School" },
      offering: { id: offeringId, name: "Junior Trial" },
      occurrence: {
        slot_id: slot.slotId,
        start: slot.startAt.toISOString(),
        end: slot.endAt.toISOString(),
        time_zone: "America/New_York",
      },
      participant: input.participant,
      contact: input.contact,
      guidance: "Training clothes",
    },
  });
  expect(
    (await loadBookings({ schoolId, filter: "all" })).filter(
      (row) => row.contactEmailSnapshot === input.contact.email,
    ),
  ).toHaveLength(0);
  for (let i = 0; i < 2; i++) {
    const result = await confirm(
      await user.request(`operations/${operation.operation_id}/confirm`, {
        revision: operation.revision,
        approved_by: "user",
      }),
      {
        params: Promise.resolve({
          schoolId,
          operationId: operation.operation_id,
        }),
      },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      state: "succeeded",
      result: { data: { booking_id: expect.any(String) } },
    });
  }
  const bookings = (await loadBookings({ schoolId, filter: "all" })).filter(
    (row) => row.contactEmailSnapshot === input.contact.email,
  );
  expect(bookings).toHaveLength(1);
  expect(bookings[0]).toMatchObject({ channel: "poppy" });
});

it("the API reuses the same action proposed in a Conversation in the same Session", async () => {
  const user = await caller();
  const input = bookingRequest();
  const usage = {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
  vi.spyOn(languageModel, "defaultLanguageModel").mockReturnValue(
    new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: randomUUID(),
              toolName: "prepare_booking",
              input: JSON.stringify({
                offeringId,
                slotId: input.occurrence_id,
                participantName: input.participant.name,
                participantAge: input.participant.age,
                contact: input.contact,
              }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [{ type: "text", text: "Please approve the proposal." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
      ],
    }),
  );
  const response = await start(
    await user.request("conversations?wait=2", {
      message: {
        id: randomUUID(),
        sender: "agent",
        text: "Please prepare a booking",
      },
    }),
    params(),
  );
  expect(response.status).toBe(201);
  const conversation = await response.json();
  const proposed = conversation.events.find(
    (event: { message?: { operation?: unknown } }) => event.message?.operation,
  )?.message.operation;
  expect(proposed).toMatchObject({ state: "proposed" });
  const api = await create(await user.request("bookings", input), params());
  expect(api.status).toBe(202);
  expect(await api.json()).toEqual({ operation: proposed });
});

it("booking status follows the creating client and User across Sessions, never another client, User or School", async () => {
  const user = await caller();
  const proposal = await create(
    await user.request("bookings", bookingRequest()),
    params(),
  );
  const { operation } = await proposal.json();
  const confirmed = await confirm(
    await user.request(`operations/${operation.operation_id}/confirm`, {
      revision: 1,
      approved_by: "user",
    }),
    {
      params: Promise.resolve({
        schoolId,
        operationId: operation.operation_id,
      }),
    },
  );
  const bookingId = (await confirmed.json()).result.data.booking_id;
  const bookingParams = { params: Promise.resolve({ schoolId, bookingId }) };
  const check = await status(
    await user.request(`bookings/${bookingId}`),
    bookingParams,
  );
  expect(check.status).toBe(200);
  expect(await check.json()).toEqual({
    booking_id: bookingId,
    status: "booked",
    occurrence: {
      start: slot.startAt.toISOString(),
      end: slot.endAt.toISOString(),
      time_zone: "America/New_York",
    },
  });

  const nextSession = await token(
    await user.agent.tokenRequest(schoolId),
    params(),
  );
  const next = await nextSession.json();
  expect(next.session_id).not.toBe(user.session.session_id);
  const nextRead = await status(
    await user.agent.protectedRequest(
      `${root}/bookings/${bookingId}`,
      next.access_token,
    ),
    bookingParams,
  );
  expect(nextRead.status).toBe(200);
  const originalOperation = await readOperation(
    await user.agent.protectedRequest(
      `${root}/operations/${operation.operation_id}`,
      next.access_token,
    ),
    {
      params: Promise.resolve({
        schoolId,
        operationId: operation.operation_id,
      }),
    },
  );
  expect(originalOperation.status).toBe(404);

  const differentUser = await token(
    await user.agent.tokenRequest(schoolId, {
      sessionClaims: { sub: randomUUID() },
    }),
    params(),
  );
  const foreign = await status(
    await user.agent.protectedRequest(
      `${root}/bookings/${bookingId}`,
      (await differentUser.json()).access_token,
    ),
    bookingParams,
  );
  expect(foreign.status).toBe(404);
  expect(await foreign.json()).toEqual({ error: "booking_not_found" });

  const another = await caller();
  const sameUserOtherClient = await token(
    await another.agent.tokenRequest(schoolId, {
      sessionClaims: { sub: user.agent.userIdForSchool(schoolId) },
    }),
    params(),
  );
  const foreignClient = await status(
    await another.agent.protectedRequest(
      `${root}/bookings/${bookingId}`,
      (await sameUserOtherClient.json()).access_token,
    ),
    bookingParams,
  );
  expect(foreignClient.status).toBe(404);
  const schoolToken = await token(
    await user.agent.tokenRequest(otherSchoolId, {
      sessionClaims: { sub: user.agent.userIdForSchool(schoolId) },
    }),
    { params: Promise.resolve({ schoolId: otherSchoolId }) },
  );
  const foreignSchool = await status(
    await user.agent.protectedRequest(
      `${origin}/poppy/schools/${otherSchoolId}/bookings/${bookingId}`,
      (await schoolToken.json()).access_token,
    ),
    { params: Promise.resolve({ schoolId: otherSchoolId, bookingId }) },
  );
  expect(foreignSchool.status).toBe(404);
  const invalid = await status(await user.request("bookings/not-a-uuid"), {
    params: Promise.resolve({ schoolId, bookingId: "not-a-uuid" }),
  });
  expect(invalid.status).toBe(404);
});

it("booking status reports cancelled, showed and no-show with the originally booked occurrence time", async () => {
  const user = await caller();
  const proposal = await create(
    await user.request("bookings", bookingRequest()),
    params(),
  );
  const { operation } = await proposal.json();
  const confirmed = await confirm(
    await user.request(`operations/${operation.operation_id}/confirm`, {
      revision: 1,
      approved_by: "user",
    }),
    {
      params: Promise.resolve({
        schoolId,
        operationId: operation.operation_id,
      }),
    },
  );
  const bookingId = (await confirmed.json()).result.data.booking_id;
  for (const value of ["showed", "no_show", "cancelled"]) {
    await sql`update app.bookings set status = ${value} where school_id = ${schoolId} and id = ${bookingId}`;
    const response = await status(await user.request(`bookings/${bookingId}`), {
      params: Promise.resolve({ schoolId, bookingId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      booking_id: bookingId,
      status: value,
      occurrence: {
        start: slot.startAt.toISOString(),
        end: slot.endAt.toISOString(),
        time_zone: "America/New_York",
      },
    });
  }
});

it("requires Operations v1 only when creating a proposal", async () => {
  const user = await caller(false);
  expect(
    (await list(await user.request("trial-occurrences"), params())).status,
  ).toBe(200);
  const response = await create(
    await user.request("bookings", bookingRequest()),
    params(),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "extension_required",
    extension: "operations",
  });
});

it("rejects malformed or ineligible details and unavailable or foreign occurrences before issuing a proposal", async () => {
  const user = await caller();
  const input = bookingRequest();
  const cases = [
    {
      body: { ...input, contact: { name: "Pat", phone: input.contact.phone } },
      code: "invalid_request",
    },
    {
      body: { ...input, contact: { ...input.contact, email: "not-email" } },
      code: "invalid_request",
    },
    {
      body: { ...input, participant: { name: "", age: 10 } },
      code: "invalid_request",
    },
    {
      body: { ...input, participant: { name: "Sam", age: 10.5 } },
      code: "invalid_request",
    },
    {
      body: { ...input, participant: { name: "Sam", age: 4 } },
      code: "ineligible_age",
    },
    {
      body: { ...input, participant: { name: "Sam", age: 16 } },
      code: "ineligible_age",
    },
    {
      body: { ...input, occurrence_id: "invalid" },
      code: "slot_unavailable",
      status: 409,
    },
    {
      body: {
        ...input,
        occurrence_id: encodeSlotId(otherWindowId, slot.startAt),
      },
      code: "slot_unavailable",
      status: 409,
    },
    { body: { ...input, school_id: otherSchoolId }, code: "invalid_request" },
  ];
  for (const test of cases) {
    const result = await create(
      await user.request("bookings", test.body),
      params(),
    );
    expect(result.status).toBe(test.status ?? 400);
    expect(await result.json()).toEqual({ error: test.code });
  }
  const oversized = await create(
    await user.request("bookings", { ...input, padding: "x".repeat(40000) }),
    params(),
  );
  expect(oversized.status).toBe(413);
  expect(
    (await loadBookings({ schoolId, filter: "all" })).filter(
      (row) => row.contactEmailSnapshot === input.contact.email,
    ),
  ).toHaveLength(0);
});

it("API proposals share the per-User proposal budget across Sessions and identical retries are free", async () => {
  const user = await caller();
  const input = bookingRequest();
  let first: unknown;
  for (let i = 0; i < 20; i++) {
    const response = await create(
      await user.request("bookings", {
        ...input,
        participant: { name: `Participant ${i}`, age: 10 },
      }),
      params(),
    );
    expect(response.status).toBe(202);
    if (i === 0) first = (await response.json()).operation;
  }
  const reuse = await create(
    await user.request("bookings", {
      ...input,
      participant: { name: "Participant 0", age: 10 },
    }),
    params(),
  );
  expect(reuse.status).toBe(202);
  expect(await reuse.json()).toEqual({ operation: first });
  const limited = await create(await user.request("bookings", input), params());
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(86000);
  expect(await limited.json()).toEqual({ error: "rate_limited" });
  const renewed = await token(
    await user.agent.tokenRequest(schoolId),
    params(),
  );
  const newSession = await renewed.json();
  const stillLimited = await create(
    await user.agent.protectedRequest(
      `${root}/bookings`,
      newSession.access_token,
      { method: "POST", body: input },
    ),
    params(),
  );
  expect(stillLimited.status).toBe(429);
});

it("every booking API call rejects missing or Bearer credentials, mismatched proofs, replays and cross-School tokens", async () => {
  const user = await caller();
  const surfaces = [
    {
      path: "trial-occurrences",
      method: "GET",
      handler: (request: Request) => list(request, params()),
    },
    {
      path: "bookings",
      method: "POST",
      body: bookingRequest(),
      handler: (request: Request) => create(request, params()),
    },
    {
      path: `bookings/${randomUUID()}`,
      method: "GET",
      handler: (request: Request) =>
        status(request, {
          params: Promise.resolve({ schoolId, bookingId: randomUUID() }),
        }),
    },
  ];
  for (const surface of surfaces) {
    const unauthenticated = await surface.handler(
      new Request(`${root}/${surface.path}`, { method: surface.method }),
    );
    expect(unauthenticated.status).toBe(401);
    const bearer = await user.agent.protectedRequest(
      `${root}/${surface.path}`,
      user.session.access_token,
      { method: surface.method, body: surface.body },
    );
    bearer.headers.set("Authorization", `Bearer ${user.session.access_token}`);
    expect((await surface.handler(bearer)).status).toBe(401);
    const wrongProof = await user.agent.protectedRequest(
      `${root}/${surface.path}`,
      user.session.access_token,
      {
        method: surface.method,
        body: surface.body,
        proofClaims: { htu: `${origin}/wrong` },
      },
    );
    expect((await surface.handler(wrongProof)).status).toBe(401);
  }
  const request = await user.request("trial-occurrences");
  const replay = request.clone();
  expect((await list(request, params())).status).toBe(200);
  expect((await list(replay, params())).status).toBe(401);
  const wrongSchool = await list(
    await user.agent.protectedRequest(
      `${origin}/poppy/schools/${otherSchoolId}/trial-occurrences`,
      user.session.access_token,
    ),
    { params: Promise.resolve({ schoolId: otherSchoolId }) },
  );
  expect(wrongSchool.status).toBe(401);
});

it("the description is unavailable on unknown hosts or for non-live Schools, including after domain removal", async () => {
  const wrongHost = await description(
    new Request(
      `https://unknown.example/poppy/schools/${schoolId}/openapi.json`,
    ),
    params(),
  );
  expect(wrongHost.status).toBe(404);
  const unknown = randomUUID();
  expect(
    (
      await description(
        new Request(`${origin}/poppy/schools/${unknown}/openapi.json`),
        { params: Promise.resolve({ schoolId: unknown }) },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await description(
        new Request(`${origin}/poppy/schools/invalid/openapi.json`),
        { params: Promise.resolve({ schoolId: "invalid" }) },
      )
    ).status,
  ).toBe(404);
  const user = await caller();
  await sql`update app.school_domains set state = 'pending' where school_id = ${schoolId}`;
  try {
    const removed = await description(
      new Request(`${root}/openapi.json`),
      params(),
    );
    expect(removed.status).toBe(404);
    expect(removed.headers.get("Cache-Control")).toBe("no-store");
    expect(
      (await list(await user.request("trial-occurrences"), params())).status,
    ).toBe(404);
    expect(
      (await create(await user.request("bookings", bookingRequest()), params()))
        .status,
    ).toBe(404);
  } finally {
    await sql`update app.school_domains set state = 'verified' where school_id = ${schoolId}`;
  }
});

it("reuses an open action even if capacity disappears, without issuing another proposal or changing approved terms", async () => {
  const user = await caller();
  const input = bookingRequest();
  const created = await create(await user.request("bookings", input), params());
  const { operation } = await created.json();
  const [prior] =
    await sql`select booked_count from app.trial_occurrences where school_id = ${schoolId} and trial_window_id = ${window.id} and start_at = ${slot.startAt}`;
  await sql`insert into app.trial_occurrences (school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity, booked_count) values (${schoolId}, ${window.id}, ${offeringId}, ${slot.startAt}, ${slot.endAt}, 10, 10) on conflict (trial_window_id, start_at) do update set booked_count = 10`;
  try {
    const response = await create(
      await user.request("bookings", input),
      params(),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ operation });
    const changed = await create(
      await user.request("bookings", {
        ...input,
        participant: { name: "Taylor", age: 10 },
      }),
      params(),
    );
    expect(changed.status).toBe(409);
  } finally {
    await sql`update app.trial_occurrences set booked_count = ${prior?.booked_count ?? 0} where school_id = ${schoolId} and trial_window_id = ${window.id} and start_at = ${slot.startAt}`;
  }
});
