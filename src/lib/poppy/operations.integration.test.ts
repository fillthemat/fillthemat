import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { loadBookings } from "@/app/dashboard/bookings/queries";
import { GET as discovery } from "@/app/poppy/discovery/[schoolId]/[domain]/route";
import { POST as close } from "@/app/poppy/schools/[schoolId]/conversations/[conversationId]/close/route";
import { GET as events } from "@/app/poppy/schools/[schoolId]/conversations/[conversationId]/events/route";
import { POST as send } from "@/app/poppy/schools/[schoolId]/conversations/[conversationId]/messages/route";
import { POST as start } from "@/app/poppy/schools/[schoolId]/conversations/route";
import { POST as cancel } from "@/app/poppy/schools/[schoolId]/operations/[operationId]/cancel/route";
import { POST as confirm } from "@/app/poppy/schools/[schoolId]/operations/[operationId]/confirm/route";
import { GET as read } from "@/app/poppy/schools/[schoolId]/operations/[operationId]/route";
import { POST as token } from "@/app/schools/[schoolId]/token/route";
import * as languageModel from "@/lib/ai/language-model";
import { attemptPendingForBooking } from "@/lib/email/deliveries";
import type { EmailMessage } from "@/lib/email/dependencies";
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
  throw new Error("Poppy Operation tests require a local database");
const admin = authSql();
const databaseName = `poppy_operations_${randomUUID().replaceAll("-", "")}`;
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
  capacity: 2,
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
    "operations-test-secret-at-least-32-characters",
  );
  vi.stubEnv("POPPY_AUTH_ORIGIN", "https://auth.fillthemat.example");
  const owner = randomUUID();
  await sql`insert into auth.users (id) values (${owner})`;
  await sql`insert into app.users (id, email) values (${owner}, 'owner@local.test')`;
  await sql`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email, approved_at, published_at) values (${schoolId}, ${owner}, 'operations-test', 'Operation School', 'America/New_York', 'owner@local.test', now(), now())`;
  await sql`insert into app.school_domains (school_id, domain, state, verified_at) values (${schoolId}, 'operations.example', 'verified', now())`;
  await sql`insert into app.trial_offerings (id, school_id, name, minimum_age, maximum_age, attire) values (${offeringId}, ${schoolId}, 'Junior Trial', 5, 15, 'Training clothes')`;
  await sql`insert into app.trial_windows (id, school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity) values (${window.id}, ${schoolId}, ${offeringId}, ${window.dayOfWeek}, ${window.startMinute}, 60, 2)`;
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

async function caller(operationsSupported = true) {
  const agent = await createTestPoppyAgent();
  if (!operationsSupported) agent.metadata.extensions.operations.version = "2";
  vi.spyOn(safeFetchNetwork, "resolve").mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ]);
  vi.spyOn(safeFetchNetwork, "request").mockImplementation(agent.fetchReply);
  const response = await token(await agent.tokenRequest(schoolId), {
    params: Promise.resolve({ schoolId }),
  });
  expect(response.status).toBe(200);
  const session = await response.json();
  return {
    agent,
    session,
    request: (path: string, body?: unknown) =>
      agent.protectedRequest(
        `https://app.fillthemat.example/poppy/schools/${schoolId}/${path}`,
        session.access_token,
        { method: body === undefined ? "GET" : "POST", body },
      ),
  };
}
const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
function prepare(
  participantName = "Sam",
  contact = {
    name: "Pat",
    email: `${randomUUID()}@local.test`,
    phone: `+1${Date.now()}${Math.floor(Math.random() * 1000)}`,
  },
  beforeGenerate?: () => Promise<void>,
) {
  const steps: Array<Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>> = [
    {
      content: [
        {
          type: "tool-call",
          toolCallId: randomUUID(),
          toolName: "prepare_booking",
          input: JSON.stringify({
            offeringId,
            slotId: slot.slotId,
            participantName,
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
      content: [{ type: "text", text: "Please approve the proposal." }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    },
  ];
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      await beforeGenerate?.();
      const step = steps.shift();
      if (!step) throw new Error("unexpected model call");
      return step;
    },
  });
  vi.spyOn(languageModel, "defaultLanguageModel").mockReturnValue(model);
  return contact;
}
async function propose(user: Awaited<ReturnType<typeof caller>>) {
  const response = await start(
    await user.request("conversations?wait=2", {
      message: { id: randomUUID(), sender: "agent", text: "Book a trial" },
    }),
    { params: Promise.resolve({ schoolId }) },
  );
  expect(response.status).toBe(201);
  const body = await response.json();
  return {
    body,
    operation: body.events.find(
      (event: { message?: { operation?: unknown } }) =>
        event.message?.operation,
    )?.message.operation,
  };
}

it("a prepare-booking tool call proposes exact terms without booking", async () => {
  const contact = prepare();
  const user = await caller();
  const { operation } = await propose(user);
  expect(operation).toMatchObject({
    operation_id: expect.any(String),
    revision: 1,
    state: "proposed",
    user_approval_required: true,
    confirmation: null,
    result: null,
    terms: {
      school: { id: schoolId, name: "Operation School" },
      offering: { id: offeringId, name: "Junior Trial" },
      occurrence: {
        slot_id: slot.slotId,
        start: slot.startAt.toISOString(),
        end: slot.endAt.toISOString(),
        time_zone: "America/New_York",
      },
      participant: { name: "Sam", age: 10 },
      contact,
    },
  });
  expect(operation.summary).toContain(contact.email);
  expect(operation.summary).toContain("Training clothes");
  expect(new Date(operation.expires_at).getTime() - Date.now()).toBeGreaterThan(
    29 * 60 * 1000,
  );
  const rows =
    await sql`select id from app.bookings where school_id = ${schoolId} and contact_email_snapshot = ${contact.email}`;
  expect(rows).toHaveLength(0);
});

it("changed exact terms revise the proposal and stale approval returns the current Operation", async () => {
  const contact = prepare();
  const user = await caller();
  const { operation, body } = await propose(user);
  prepare("Taylor", contact);
  const response = await send(
    await user.request(
      `conversations/${body.conversation_id}/messages?wait=2`,
      {
        message: {
          id: randomUUID(),
          sender: "agent",
          text: "Change the Participant",
        },
      },
    ),
    {
      params: Promise.resolve({
        schoolId,
        conversationId: body.conversation_id,
      }),
    },
  );
  const revised = (await response.json()).events
    .filter(
      (event: { message?: { operation?: unknown } }) =>
        event.message?.operation,
    )
    .at(-1)?.message.operation;
  expect(revised).toMatchObject({
    operation_id: operation.operation_id,
    revision: 2,
    state: "proposed",
    terms: { participant: { name: "Taylor" } },
  });
  const stale = await confirm(
    await user.request(`operations/${operation.operation_id}/confirm`, {
      revision: 1,
      approved_by: "user",
    }),
    operationParams(operation.operation_id),
  );
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({
    error: "terms_changed",
    operation: revised,
  });
  const standing = await confirm(
    await user.request(`operations/${operation.operation_id}/confirm`, {
      revision: 2,
      approved_by: "standing_permission",
    }),
    operationParams(operation.operation_id),
  );
  expect(standing.status).toBe(403);
  expect(await standing.json()).toEqual({ error: "user_approval_required" });
  // Re-preparing identical terms does not needlessly invalidate approval.
  prepare("Taylor", contact);
  const same = await send(
    await user.request(
      `conversations/${body.conversation_id}/messages?wait=2`,
      { message: { id: randomUUID(), sender: "human", text: "yes" } },
    ),
    {
      params: Promise.resolve({
        schoolId,
        conversationId: body.conversation_id,
      }),
    },
  );
  expect(
    (await same.json()).events
      .filter(
        (event: {
          message?: { operation?: { operation_id: string; revision: number } };
        }) => event.message?.operation,
      )
      .at(-1).message.operation,
  ).toEqual(revised);
});

const operationParams = (operationId: string) => ({
  params: Promise.resolve({ schoolId, operationId }),
});
it("repeated and concurrent confirms book at most once and the owner sees Poppy attribution", async () => {
  const contact = prepare();
  const user = await caller();
  const { operation, body } = await propose(user);
  // Closing the Conversation does not withdraw a separately issued Operation
  // or lose the retained conversation link on its resulting booking.
  await close(
    await user.request(`conversations/${body.conversation_id}/close`, {}),
    {
      params: Promise.resolve({
        schoolId,
        conversationId: body.conversation_id,
      }),
    },
  );
  const results = await Promise.all(
    [0, 1, 2].map(async () =>
      confirm(
        await user.request(`operations/${operation.operation_id}/confirm`, {
          revision: 1,
          approved_by: "user",
        }),
        operationParams(operation.operation_id),
      ),
    ),
  );
  expect(results.every((response) => response.status === 200)).toBe(true);
  const retry = await confirm(
    await user.request(`operations/${operation.operation_id}/confirm`, {
      revision: 1,
      approved_by: "user",
    }),
    operationParams(operation.operation_id),
  );
  const final = await retry.json();
  expect(final).toMatchObject({
    operation_id: operation.operation_id,
    state: "succeeded",
    confirmation: { revision: 1, approved_by: "user" },
    result: {
      summary: expect.stringContaining("Booked"),
      data: { booking_id: expect.any(String) },
    },
  });
  const retained = await read(
    await user.request(`operations/${operation.operation_id}`),
    operationParams(operation.operation_id),
  );
  expect(await retained.json()).toEqual(final);
  const ownerBookings = await loadBookings({ schoolId, filter: "all" });
  const booked = ownerBookings.filter(
    (booking) => booking.contactEmailSnapshot === contact.email,
  );
  expect(booked).toHaveLength(1);
  expect(booked[0]).toMatchObject({
    channel: "poppy",
    poppyClientDisplayName: "Test Personal Agent",
    conversationId: body.conversation_id,
    poppySessionId: user.session.session_id,
  });
  const deliveries =
    await sql`select kind, recipient from app.email_deliveries where booking_id = ${booked[0]?.id}`;
  expect(deliveries).toEqual(
    expect.arrayContaining([
      { kind: "owner_booking", recipient: "owner@local.test" },
      { kind: "prospect_confirmation", recipient: contact.email },
    ]),
  );
  expect(deliveries).toHaveLength(2);
  const messages: EmailMessage[] = [];
  await attemptPendingForBooking(booked[0].id, {
    transport: {
      send: async (message) => {
        messages.push(message);
        return { ok: true, kind: "accepted", providerId: randomUUID() };
      },
    },
  });
  expect(
    messages.find((message) => message.to === contact.email)?.text,
  ).toContain(
    `Not you? Cancel this booking:\nhttps://app.fillthemat.example/poppy/bookings/${booked[0].id}/cancel?token=`,
  );
});

it("another Session for the same User can continue a Conversation but cannot read, confirm or cancel its Operation", async () => {
  prepare();
  const user = await caller();
  const { operation } = await propose(user);
  const nextSession = await (
    await token(await user.agent.tokenRequest(schoolId), {
      params: Promise.resolve({ schoolId }),
    })
  ).json();
  for (const [action, handler] of [
    ["", read],
    ["/confirm", confirm],
    ["/cancel", cancel],
  ] as const) {
    const request = await user.agent.protectedRequest(
      `https://app.fillthemat.example/poppy/schools/${schoolId}/operations/${operation.operation_id}${action}`,
      nextSession.access_token,
      {
        method: action ? "POST" : "GET",
        body:
          action === "/confirm"
            ? { revision: 1, approved_by: "user" }
            : undefined,
      },
    );
    const response = await handler(
      request,
      operationParams(operation.operation_id),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "operation_not_found" });
  }
  const unknown = await read(
    await user.request("operations/op_unknown"),
    operationParams("op_unknown"),
  );
  expect(unknown.status).toBe(404);
  const renewed = await (
    await token(
      await user.agent.tokenRequest(schoolId, {
        sessionId: user.session.session_id,
      }),
      { params: Promise.resolve({ schoolId }) },
    )
  ).json();
  const retained = await read(
    await user.agent.protectedRequest(
      `https://app.fillthemat.example/poppy/schools/${schoolId}/operations/${operation.operation_id}`,
      renewed.access_token,
    ),
    operationParams(operation.operation_id),
  );
  expect(await retained.json()).toMatchObject({
    operation_id: operation.operation_id,
    state: "proposed",
  });
});

it("cancel and expiry are final and cannot be confirmed, including stale final-state requests", async () => {
  prepare();
  const user = await caller();
  const { operation } = await propose(user);
  const cancelled = await cancel(
    await user.request(`operations/${operation.operation_id}/cancel`, {}),
    operationParams(operation.operation_id),
  );
  const final = await cancelled.json();
  expect(final).toMatchObject({
    state: "cancelled",
    confirmation: null,
    result: { summary: expect.stringContaining("No booking was made") },
  });
  const retry = await confirm(
    await user.request(`operations/${operation.operation_id}/confirm`, {
      revision: 100,
      approved_by: "standing_permission",
    }),
    operationParams(operation.operation_id),
  );
  expect(await retry.json()).toEqual(final);
  prepare();
  const expiring = (await propose(user)).operation;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 31 * 60 * 1000);
  // Renewal retains the originating Session when its old token expires.
  const renewed = await (
    await token(
      await user.agent.tokenRequest(schoolId, {
        sessionId: user.session.session_id,
      }),
      { params: Promise.resolve({ schoolId }) },
    )
  ).json();
  const expired = await confirm(
    await user.agent.protectedRequest(
      `https://app.fillthemat.example/poppy/schools/${schoolId}/operations/${expiring.operation_id}/confirm`,
      renewed.access_token,
      { method: "POST", body: { revision: 1, approved_by: "user" } },
    ),
    operationParams(expiring.operation_id),
  );
  expect(await expired.json()).toMatchObject({
    state: "expired",
    confirmation: null,
    result: { summary: expect.stringContaining("No booking was made") },
  });
});

it("discovery advertises Operations v1 and unsupported clients receive extension_required in a Company message", async () => {
  const discovered = await discovery(
    new Request(
      `https://app.fillthemat.example/poppy/discovery/${schoolId}/operations.example`,
    ),
    { params: Promise.resolve({ schoolId, domain: "operations.example" }) },
  );
  expect(await discovered.json()).toMatchObject({
    extensions: {
      operations: {
        version: "1",
        endpoint: `https://app.fillthemat.example/poppy/schools/${schoolId}/operations`,
      },
    },
  });
  prepare();
  const user = await caller(false);
  const { body, operation } = await propose(user);
  expect(operation).toBeUndefined();
  expect(body.events).toContainEqual(
    expect.objectContaining({
      type: "message",
      message: expect.objectContaining({
        role: "company",
        text: expect.stringContaining("extension_required"),
        data: { error: "extension_required", extension: "operations" },
      }),
    }),
  );
  const unsupported = await read(
    await user.request("operations/op_unknown"),
    operationParams("op_unknown"),
  );
  expect(unsupported.status).toBe(403);
  expect(await unsupported.json()).toEqual({
    error: "extension_required",
    extension: "operations",
  });
});

it("a class filled after proposal fails without another booking and stays final on replay", async () => {
  prepare();
  const user = await caller();
  const { operation } = await propose(user);
  const before =
    await sql`select id from app.bookings where school_id = ${schoolId}`;
  const existing =
    await sql`select booked_count from app.trial_occurrences where trial_window_id = ${window.id} and start_at = ${slot.startAt}`;
  await sql`insert into app.trial_occurrences (school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity, booked_count) values (${schoolId}, ${window.id}, ${offeringId}, ${slot.startAt}, ${slot.endAt}, 2, 2) on conflict (trial_window_id, start_at) do update set booked_count = app.trial_occurrences.capacity`;
  try {
    const response = await confirm(
      await user.request(`operations/${operation.operation_id}/confirm`, {
        revision: 1,
        approved_by: "user",
      }),
      operationParams(operation.operation_id),
    );
    const failed = await response.json();
    expect(failed).toMatchObject({
      state: "failed",
      result: {
        summary: expect.stringContaining("class is full"),
        data: { code: "slot_unavailable" },
      },
    });
    const retry = await confirm(
      await user.request(`operations/${operation.operation_id}/confirm`, {
        revision: 1,
        approved_by: "user",
      }),
      operationParams(operation.operation_id),
    );
    expect(await retry.json()).toEqual(failed);
    expect(
      await sql`select id from app.bookings where school_id = ${schoolId}`,
    ).toEqual(before);
  } finally {
    await sql`update app.trial_occurrences set booked_count = ${existing[0]?.booked_count ?? 0} where trial_window_id = ${window.id} and start_at = ${slot.startAt}`;
  }
});

it("eligibility changed after proposal fails with a clear result", async () => {
  prepare();
  const user = await caller();
  const { operation } = await propose(user);
  await sql`update app.trial_offerings set minimum_age = 12 where id = ${offeringId}`;
  try {
    const response = await confirm(
      await user.request(`operations/${operation.operation_id}/confirm`, {
        revision: 1,
        approved_by: "user",
      }),
      operationParams(operation.operation_id),
    );
    expect(await response.json()).toMatchObject({
      state: "failed",
      result: {
        summary: expect.stringContaining("no longer eligible"),
        data: { code: "ineligible" },
      },
    });
  } finally {
    await sql`update app.trial_offerings set minimum_age = 5 where id = ${offeringId}`;
  }
});

it("the platform never books silently changed occurrence terms", async () => {
  prepare();
  const user = await caller();
  const { operation } = await propose(user);
  await sql`update app.trial_windows set duration_minutes = 90 where id = ${window.id}`;
  try {
    const response = await confirm(
      await user.request(`operations/${operation.operation_id}/confirm`, {
        revision: 1,
        approved_by: "user",
      }),
      operationParams(operation.operation_id),
    );
    expect(await response.json()).toMatchObject({
      state: "failed",
      result: {
        summary: expect.stringContaining("approved terms have changed"),
        data: { code: "terms_changed" },
      },
    });
  } finally {
    await sql`update app.trial_windows set duration_minutes = 60 where id = ${window.id}`;
  }
});

it("the existing Contact email delivery cap still applies to Poppy confirmation", async () => {
  const contact = prepare();
  const user = await caller();
  const { operation } = await propose(user);
  for (let index = 0; index < 12; index++)
    await sql`insert into app.email_deliveries (school_id, kind, recipient, provider_idempotency_key) values (${schoolId}, 'owner_lead', ${contact.email}, ${randomUUID()})`;
  const response = await confirm(
    await user.request(`operations/${operation.operation_id}/confirm`, {
      revision: 1,
      approved_by: "user",
    }),
    operationParams(operation.operation_id),
  );
  expect(await response.json()).toMatchObject({
    state: "failed",
    result: {
      summary: expect.stringContaining("email booking or delivery limit"),
      data: { code: "email_limit" },
    },
  });
  expect(
    (await loadBookings({ schoolId, filter: "all" })).filter(
      (booking) => booking.contactEmailSnapshot === contact.email,
    ),
  ).toHaveLength(0);
});

it("a failure committing the effect remains in_progress, never silently retries or claims failure", async () => {
  const contact = prepare();
  const user = await caller();
  const { operation } = await propose(user);
  // Simulate storage failure at the atomic booking/final-result boundary, not
  // a mocked business helper. Only this disposable database is affected.
  await sql.unsafe(
    `create function app.test_final_write_failure() returns trigger language plpgsql as $$ begin if NEW.state = 'succeeded' and NEW.id = '${operation.operation_id}' then raise exception 'storage unavailable'; end if; return NEW; end; $$`,
  );
  await sql`create trigger test_final_write_failure before update on app.poppy_operations for each row execute function app.test_final_write_failure()`;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await confirm(
      await user.request(`operations/${operation.operation_id}/confirm`, {
        revision: 1,
        approved_by: "user",
      }),
      operationParams(operation.operation_id),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "server_error" });
    const retained = await read(
      await user.request(`operations/${operation.operation_id}`),
      operationParams(operation.operation_id),
    );
    expect(retained.headers.get("Retry-After")).toBe("1");
    expect(await retained.json()).toMatchObject({
      state: "in_progress",
      confirmation: { approved_by: "user" },
      result: null,
    });
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "poppy_request_failed" }),
    );
  } finally {
    await sql`drop trigger test_final_write_failure on app.poppy_operations`;
    await sql`drop function app.test_final_write_failure()`;
  }
  const replay = await confirm(
    await user.request(`operations/${operation.operation_id}/confirm`, {
      revision: 1,
      approved_by: "user",
    }),
    operationParams(operation.operation_id),
  );
  expect(await replay.json()).toMatchObject({ state: "in_progress" });
  prepare("Sam", contact);
  const repeated = (await propose(user)).operation;
  expect(repeated).toMatchObject({
    operation_id: operation.operation_id,
    state: "in_progress",
  });
  expect(
    (await loadBookings({ schoolId, filter: "all" })).filter(
      (booking) => booking.contactEmailSnapshot === contact.email,
    ),
  ).toHaveLength(0);
});

it("a delayed proposal belongs to the receipt's Session, not the new Session polling the Conversation", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  prepare("Sam", undefined, async () => {
    started.resolve();
    await release.promise;
  });
  const user = await caller();
  try {
    const response = await start(
      await user.request("conversations?wait=0", {
        message: {
          id: randomUUID(),
          sender: "agent",
          text: "Propose a booking",
        },
      }),
      { params: Promise.resolve({ schoolId }) },
    );
    const first = await response.json();
    await started.promise;
    const nextSession = await (
      await token(await user.agent.tokenRequest(schoolId), {
        params: Promise.resolve({ schoolId }),
      })
    ).json();
    release.resolve();
    await Promise.all(deferred.splice(0));
    const page = await events(
      await user.agent.protectedRequest(
        `https://app.fillthemat.example/poppy/schools/${schoolId}/conversations/${first.conversation_id}/events`,
        nextSession.access_token,
      ),
      {
        params: Promise.resolve({
          schoolId,
          conversationId: first.conversation_id,
        }),
      },
    );
    const operation = (await page.json()).events.find(
      (event: { message?: { operation?: unknown } }) =>
        event.message?.operation,
    ).message.operation;
    const foreign = await read(
      await user.agent.protectedRequest(
        `https://app.fillthemat.example/poppy/schools/${schoolId}/operations/${operation.operation_id}`,
        nextSession.access_token,
      ),
      operationParams(operation.operation_id),
    );
    expect(foreign.status).toBe(404);
    const owned = await read(
      await user.request(`operations/${operation.operation_id}`),
      operationParams(operation.operation_id),
    );
    expect(await owned.json()).toEqual(operation);
  } finally {
    release.resolve();
  }
});
