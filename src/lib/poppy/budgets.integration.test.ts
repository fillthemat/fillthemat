import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { GET as events } from "@/app/poppy/schools/[schoolId]/conversations/[conversationId]/events/route";
import { POST as send } from "@/app/poppy/schools/[schoolId]/conversations/[conversationId]/messages/route";
import { POST as start } from "@/app/poppy/schools/[schoolId]/conversations/route";
import { POST as confirm } from "@/app/poppy/schools/[schoolId]/operations/[operationId]/confirm/route";
import { POST as token } from "@/app/schools/[schoolId]/token/route";
import * as database from "@/db";
import * as schema from "@/db/schema";
import * as languageModel from "@/lib/ai/language-model";
import { runMaintenance } from "@/lib/maintenance";
import { listOpenSlots } from "@/lib/schedule/occurrences";
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
  throw new Error("Poppy budget tests require a local database");
const admin = authSql();
const databaseName = `poppy_budgets_${randomUUID().replaceAll("-", "")}`;
localUrl.pathname = `/${databaseName}`;
const sql = postgres(localUrl.toString(), { max: 1 });
let databaseCreated = false;
const schoolId = randomUUID();
const offeringId = randomUUID();
const window = {
  id: randomUUID(),
  trialOfferingId: offeringId,
  dayOfWeek: 3,
  startMinute: 1080,
  durationMinutes: 60,
  capacity: 50,
  active: true,
  label: null,
};
const slot = listOpenSlots({
  offeringId,
  timezone: "America/New_York",
  windows: [window],
  occurrences: [],
  now: new Date(),
})[0];
if (!slot) throw new Error("missing trial fixture");
const primary = { schoolId, offeringId, window, slot };
async function schoolFixture() {
  const schoolId = randomUUID();
  const offeringId = randomUUID();
  const trialWindow = {
    ...window,
    id: randomUUID(),
    trialOfferingId: offeringId,
  };
  const trialSlot = listOpenSlots({
    offeringId,
    timezone: "America/New_York",
    windows: [trialWindow],
    occurrences: [],
    now: new Date(),
  })[0];
  if (!trialSlot) throw new Error("missing trial fixture");
  const owner = randomUUID();
  await sql`insert into auth.users (id) values (${owner})`;
  await sql`insert into app.users (id, email) values (${owner}, ${`${owner}@local.test`})`;
  await sql`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email, approved_at, published_at) values (${schoolId}, ${owner}, ${schoolId}, 'Budget School', 'America/New_York', 'owner@local.test', now(), now())`;
  await sql`insert into app.school_domains (school_id, domain, state, verified_at) values (${schoolId}, ${`${schoolId}.example`}, 'verified', now())`;
  await sql`insert into app.trial_offerings (id, school_id, name, minimum_age, maximum_age) values (${offeringId}, ${schoolId}, 'Junior Trial', 5, 15)`;
  await sql`insert into app.trial_windows (id, school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity) values (${trialWindow.id}, ${schoolId}, ${offeringId}, ${trialWindow.dayOfWeek}, ${trialWindow.startMinute}, 60, 50)`;
  return { schoolId, offeringId, window: trialWindow, slot: trialSlot };
}
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
  vi.stubEnv(
    "POPPY_CANCEL_LINK_SECRET",
    "budget-test-secret-at-least-32-characters",
  );
  vi.stubEnv("POPPY_AUTH_ORIGIN", "https://auth.fillthemat.example");
  const owner = randomUUID();
  await sql`insert into auth.users (id) values (${owner})`;
  await sql`insert into app.users (id, email) values (${owner}, 'owner@local.test')`;
  await sql`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email, approved_at, published_at) values (${schoolId}, ${owner}, 'budget-test', 'Budget School', 'America/New_York', 'owner@local.test', now(), now())`;
  await sql`insert into app.school_domains (school_id, domain, state, verified_at) values (${schoolId}, 'budgets.example', 'verified', now())`;
  await sql`insert into app.trial_offerings (id, school_id, name, minimum_age, maximum_age) values (${offeringId}, ${schoolId}, 'Junior Trial', 5, 15)`;
  await sql`insert into app.trial_windows (id, school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity) values (${window.id}, ${schoolId}, ${offeringId}, ${window.dayOfWeek}, ${window.startMinute}, 60, 50)`;
}, 60000);
afterEach(async () => {
  await Promise.all(deferred.splice(0));
  vi.restoreAllMocks();
  vi.useRealTimers();
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

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
async function caller(
  fixture = primary,
  agent?: Awaited<ReturnType<typeof createTestPoppyAgent>>,
  userId?: string,
) {
  agent ??= await createTestPoppyAgent();
  const schoolId = fixture.schoolId;
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(agent.fetchReply);
  const response = await token(
    await agent.tokenRequest(schoolId, {
      sessionClaims: userId ? { sub: userId } : {},
    }),
    {
      params: Promise.resolve({ schoolId }),
    },
  );
  expect(response.status).toBe(200);
  const session = await response.json();
  return {
    agent,
    session,
    fixture,
    request: (path: string, body?: unknown) =>
      agent.protectedRequest(
        `https://app.fillthemat.example/poppy/schools/${schoolId}/${path}`,
        session.access_token,
        { method: body === undefined ? "GET" : "POST", body },
      ),
  };
}
function answer() {
  vi.spyOn(languageModel, "defaultLanguageModel").mockReturnValue(
    new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "How can I help?" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    }),
  );
}
let contactSequence = 0;
function prepare(
  fixture = primary,
  contact = {
    name: "Pat",
    email: `${randomUUID()}@local.test`,
    phone: `+1555${String(++contactSequence).padStart(7, "0")}`,
  },
) {
  const steps: Array<Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>> = [
    {
      content: [
        {
          type: "tool-call",
          toolCallId: randomUUID(),
          toolName: "prepare_booking",
          input: JSON.stringify({
            offeringId: fixture.offeringId,
            slotId: fixture.slot.slotId,
            participantName: "Sam",
            participantAge: 10,
            contact,
          }),
        },
      ],
      finishReason: { unified: "tool-calls", raw: undefined },
      usage,
      warnings: [],
    },
    {
      content: [{ type: "text", text: "Please approve." }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    },
  ];
  vi.spyOn(languageModel, "defaultLanguageModel").mockReturnValue(
    new MockLanguageModelV4({
      doGenerate: async () => {
        const step = steps.shift();
        if (!step) throw new Error("unexpected model call");
        return step;
      },
    }),
  );
}
async function propose(user: Awaited<ReturnType<typeof caller>>) {
  prepare(user.fixture);
  const response = await startConversation(user);
  expect(response.status).toBe(201);
  const body = await response.json();
  const operation = body.events.find(
    (event: { message?: { operation?: unknown } }) => event.message?.operation,
  )?.message.operation;
  expect(operation).toBeDefined();
  return operation;
}
async function confirmBooking(
  user: Awaited<ReturnType<typeof caller>>,
  operation: { operation_id: string; revision: number },
) {
  const response = await confirm(
    await user.request(`operations/${operation.operation_id}/confirm`, {
      revision: operation.revision,
      approved_by: "user",
    }),
    {
      params: Promise.resolve({
        schoolId: user.fixture.schoolId,
        operationId: operation.operation_id,
      }),
    },
  );
  expect(response.status).toBe(200);
  return response.json();
}
async function sendProposal(
  user: Awaited<ReturnType<typeof caller>>,
  conversationId: string,
  messageId = randomUUID(),
  contact?: { name: string; email: string; phone: string },
) {
  prepare(user.fixture, contact);
  return send(
    await user.request(`conversations/${conversationId}/messages?wait=2`, {
      message: { id: messageId, sender: "agent", text: "Change the Contact" },
    }),
    {
      params: Promise.resolve({
        schoolId: user.fixture.schoolId,
        conversationId,
      }),
    },
  );
}
async function startConversation(
  user: Awaited<ReturnType<typeof caller>>,
  id = randomUUID(),
) {
  return start(
    await user.request("conversations?wait=2", {
      message: { id, sender: "agent", text: "Find a trial" },
    }),
    { params: Promise.resolve({ schoolId: user.fixture.schoolId }) },
  );
}

it("the eleventh new Conversation is refused before model work; first-message replay is free", async () => {
  answer();
  const user = await caller();
  const firstId = randomUUID();
  const first = await startConversation(user, firstId);
  expect(first.status).toBe(201);
  const original = await first.json();
  for (let index = 1; index < 10; index++)
    expect((await startConversation(user)).status).toBe(201);
  const rejected = await startConversation(user);
  expect(rejected.status).toBe(429);
  expect(Number(rejected.headers.get("Retry-After"))).toBeGreaterThan(86000);
  expect(await rejected.json()).toEqual({ error: "rate_limited" });
  expect(await (await startConversation(user, firstId)).json()).toEqual(
    original,
  );
  const nextSession = await caller(primary, user.agent);
  expect((await startConversation(nextSession)).status).toBe(429);
  const differentUser = await caller(primary, user.agent, randomUUID());
  expect((await startConversation(differentUser)).status).toBe(201);
  const differentSchool = await caller(await schoolFixture(), user.agent);
  expect((await startConversation(differentSchool)).status).toBe(201);
  const continued = await send(
    await user.request(
      `conversations/${original.conversation_id}/messages?wait=2`,
      {
        message: { id: randomUUID(), sender: "agent", text: "Tell me more" },
      },
    ),
    {
      params: Promise.resolve({
        schoolId,
        conversationId: original.conversation_id,
      }),
    },
  );
  expect(continued.status).toBe(202);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const reset = await caller(primary, user.agent);
  expect((await startConversation(reset)).status).toBe(201);
});

it("concurrent confirms cannot exceed three bookings for one User and replays spend nothing", async () => {
  const user = await caller();
  const operations = [];
  for (let index = 0; index < 4; index++) operations.push(await propose(user));
  const first = await confirmBooking(user, operations[0]);
  expect(first.state).toBe("succeeded");
  for (let index = 0; index < 5; index++)
    expect(await confirmBooking(user, operations[0])).toEqual(first);
  // Independent real connections ensure the pool doesn't serialize the attack
  // before requests reach the transaction-level budget locks.
  const connections = postgres(localUrl.toString(), { max: 8, prepare: false });
  let results: Array<Awaited<ReturnType<typeof confirmBooking>>>;
  try {
    vi.spyOn(database, "getDb").mockReturnValue(
      drizzle(connections, { schema }),
    );
    results = await Promise.all(
      operations.slice(1).map((operation) => confirmBooking(user, operation)),
    );
  } finally {
    vi.restoreAllMocks();
    await connections.end({ timeout: 5 });
  }
  expect(results.filter((result) => result.state === "succeeded")).toHaveLength(
    2,
  );
  expect(results.find((result) => result.state === "failed")).toMatchObject({
    result: {
      summary: expect.stringContaining("agent user"),
      data: { code: "poppy_user_booking_limit" },
    },
  });
  const nextSession = await caller(primary, user.agent);
  expect(
    (await confirmBooking(nextSession, await propose(nextSession))).result.data
      .code,
  ).toBe("poppy_user_booking_limit");
  const otherUser = await caller(primary, user.agent, randomUUID());
  expect(
    (await confirmBooking(otherUser, await propose(otherUser))).state,
  ).toBe("succeeded");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const reset = await caller(primary, user.agent);
  expect((await confirmBooking(reset, await propose(reset))).state).toBe(
    "succeeded",
  );
});

it("twenty issued proposal revisions exhaust the User budget and the next request gets Retry-After", async () => {
  const user = await caller();
  prepare();
  const first = await (await startConversation(user)).json();
  for (let index = 1; index < 15; index++)
    expect((await sendProposal(user, first.conversation_id)).status).toBe(202);
  prepare();
  const second = await (await startConversation(user)).json();
  for (let index = 16; index < 19; index++)
    expect((await sendProposal(user, second.conversation_id)).status).toBe(202);
  const contact = {
    name: "Pat",
    email: `${randomUUID()}@local.test`,
    phone: `+1${Date.now()}`,
  };
  const twentieth = await sendProposal(
    user,
    second.conversation_id,
    randomUUID(),
    contact,
  );
  const same = await sendProposal(
    user,
    second.conversation_id,
    randomUUID(),
    contact,
  );
  expect(same.status).toBe(202);
  const latest = (body: {
    events: Array<{ message?: { operation?: unknown } }>;
  }) =>
    body.events.filter((event) => event.message?.operation).at(-1)?.message
      ?.operation;
  expect(latest(await same.json())).toEqual(latest(await twentieth.json()));
  const rejectedId = randomUUID();
  const response = await sendProposal(user, second.conversation_id, rejectedId);
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(86000);
  expect(await response.json()).toMatchObject({ error: "rate_limited" });
  expect(
    (await sendProposal(user, second.conversation_id, rejectedId)).status,
  ).toBe(429);
  const page = await events(
    await user.request(`conversations/${second.conversation_id}/events`),
    {
      params: Promise.resolve({
        schoolId,
        conversationId: second.conversation_id,
      }),
    },
  );
  const body = await page.json();
  expect(body.status).toBe("idle");
  const refusal = body.events
    .filter(
      (event: { message?: { role: string } }) =>
        event.message?.role === "company",
    )
    .at(-1).message;
  expect(refusal).toMatchObject({
    text: expect.stringContaining("No proposal was issued"),
    data: { error: "rate_limited", retry_after: expect.any(Number) },
  });
  expect(refusal.operation).toBeUndefined();
  const nextSession = await caller(primary, user.agent);
  expect((await sendProposal(nextSession, second.conversation_id)).status).toBe(
    429,
  );
  // Lead and booking proposals share the same principal-wide budget.
  vi.spyOn(languageModel, "defaultLanguageModel").mockReturnValue(
    new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: randomUUID(),
              toolName: "request_contact",
              input: JSON.stringify({ contact }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [{ type: "text", text: "Please approve contact." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
      ],
    }),
  );
  const leadRefused = await send(
    await user.request(
      `conversations/${second.conversation_id}/messages?wait=2`,
      {
        message: {
          id: randomUUID(),
          sender: "agent",
          text: "Ask the School to contact me",
        },
      },
    ),
    {
      params: Promise.resolve({
        schoolId,
        conversationId: second.conversation_id,
      }),
    },
  );
  expect(leadRefused.status).toBe(429);
  expect(Number(leadRefused.headers.get("Retry-After"))).toBeGreaterThan(86000);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const reset = await caller(primary, user.agent);
  expect((await propose(reset)).state).toBe("proposed");
});

it("the School cap spans clients and resets at local midnight, including a 25-hour DST day", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:01:00Z"));
  const fixture = await schoolFixture();
  const agents = [await createTestPoppyAgent(), await createTestPoppyAgent()];
  for (let index = 0; index < 20; index++) {
    const user = await caller(fixture, agents[index % 2], randomUUID());
    expect((await confirmBooking(user, await propose(user))).state).toBe(
      "succeeded",
    );
  }
  for (const instant of ["2026-11-02T00:00:00Z", "2026-11-02T04:59:59Z"]) {
    vi.setSystemTime(new Date(instant));
    const user = await caller(fixture, agents[0], randomUUID());
    expect(await confirmBooking(user, await propose(user))).toMatchObject({
      state: "failed",
      result: {
        summary: expect.stringContaining("School's daily"),
        data: { code: "poppy_school_booking_limit" },
      },
    });
  }
  vi.setSystemTime(new Date("2026-11-02T05:00:00Z"));
  const user = await caller(fixture, agents[0], randomUUID());
  expect((await confirmBooking(user, await propose(user))).state).toBe(
    "succeeded",
  );
}, 60000);

it("one client's fifty bookings span Schools and Users; another client retains its budget", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const instant = new Date("2026-10-12T12:00:00Z");
  vi.setSystemTime(instant);
  const fixtures = [
    await schoolFixture(),
    await schoolFixture(),
    await schoolFixture(),
  ];
  const agent = await createTestPoppyAgent();
  for (let index = 0; index < 50; index++) {
    const user = await caller(fixtures[index % 3], agent, randomUUID());
    expect((await confirmBooking(user, await propose(user))).state).toBe(
      "succeeded",
    );
  }
  const user = await caller(fixtures[0], agent, randomUUID());
  expect(await confirmBooking(user, await propose(user))).toMatchObject({
    state: "failed",
    result: {
      summary: expect.stringContaining("across all Schools"),
      data: { code: "poppy_client_booking_limit" },
    },
  });
  const other = await caller(fixtures[0]);
  expect((await confirmBooking(other, await propose(other))).state).toBe(
    "succeeded",
  );
  vi.setSystemTime(new Date(instant.getTime() + 24 * 60 * 60 * 1000 - 1000));
  const beforeReset = await caller(fixtures[0], agent, randomUUID());
  expect(
    (await confirmBooking(beforeReset, await propose(beforeReset))).result.data
      .code,
  ).toBe("poppy_client_booking_limit");
  vi.setSystemTime(new Date(instant.getTime() + 24 * 60 * 60 * 1000));
  const reset = await caller(fixtures[0], agent, randomUUID());
  expect((await confirmBooking(reset, await propose(reset))).state).toBe(
    "succeeded",
  );
}, 60000);

it("an expected booking failure spends no budget", async () => {
  const fixture = await schoolFixture();
  const user = await caller(fixture);
  const operation = await propose(user);
  await sql`update app.trial_offerings set minimum_age = 12 where id = ${fixture.offeringId}`;
  expect((await confirmBooking(user, operation)).result.data.code).toBe(
    "ineligible",
  );
  await sql`update app.trial_offerings set minimum_age = 5 where id = ${fixture.offeringId}`;
  for (let index = 0; index < 3; index++)
    expect((await confirmBooking(user, await propose(user))).state).toBe(
      "succeeded",
    );
  expect(
    (await confirmBooking(user, await propose(user))).result.data.code,
  ).toBe("poppy_user_booking_limit");
});

it("rolling back the booking/final-Operation transaction also rolls back budget consumption", async () => {
  const fixture = await schoolFixture();
  const user = await caller(fixture);
  const operation = await propose(user);
  await sql.unsafe(
    `create function app.test_budget_rollback() returns trigger language plpgsql as $$ begin if NEW.state = 'succeeded' and NEW.id = '${operation.operation_id}' then raise exception 'storage unavailable'; end if; return NEW; end; $$`,
  );
  await sql`create trigger test_budget_rollback before update on app.poppy_operations for each row execute function app.test_budget_rollback()`;
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await confirm(
      await user.request(`operations/${operation.operation_id}/confirm`, {
        revision: 1,
        approved_by: "user",
      }),
      {
        params: Promise.resolve({
          schoolId: fixture.schoolId,
          operationId: operation.operation_id,
        }),
      },
    );
    expect(response.status).toBe(503);
  } finally {
    await sql`drop trigger test_budget_rollback on app.poppy_operations`;
    await sql`drop function app.test_budget_rollback()`;
  }
  expect((await confirmBooking(user, operation)).state).toBe("in_progress");
  for (let index = 0; index < 3; index++)
    expect((await confirmBooking(user, await propose(user))).state).toBe(
      "succeeded",
    );
});

it("maintenance removes expired budget records without refunding active spend", async () => {
  const expiredId = randomUUID();
  const activeId = randomUUID();
  await sql`insert into app.poppy_budget_usages (id, key, expires_at) values (${expiredId}, 'expired-maintenance-fixture', now() - interval '1 minute'), (${activeId}, 'active-maintenance-fixture', now() + interval '1 hour')`;
  const result = await runMaintenance({
    transport: {
      send: async () => ({
        ok: true,
        kind: "accepted",
        providerId: randomUUID(),
      }),
    },
  });
  expect(result.result).toBe("success");
  expect(
    await sql`select id from app.poppy_budget_usages where id in (${expiredId}, ${activeId})`,
  ).toEqual([{ id: activeId }]);
});
