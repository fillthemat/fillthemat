import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Database } from "@/db/types";
import { POST } from "@/app/api/webhooks/resend/route";
import { cancelBookingAction } from "@/app/dashboard/bookings/actions";
import { MAX_EXECUTIONS } from "@/lib/retry-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";
import type { EmailMessage } from "./dependencies";
import {
  claimDueDeliveries,
  recoverStuckEmailDeliveries,
  runEmailSendOnce,
  sendDelivery,
} from "./deliveries";
import { recordResendDeliveryEvent } from "./delivery-event";
import { createDueReminderDeliveries } from "./maintenance";
import { updateClaim } from "./store";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (work: () => Promise<void>) => afterTasks.push(work) }));
vi.mock("@/lib/auth/current-school", () => ({ requireSchool: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ownerClient }));
loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname))
  throw new Error("Local database required");
const sql = authSql();
const ownerId = randomUUID();
let schoolId = "";
let bookingId = "";
const client = () => createAdminClient();
const now = new Date();
const afterTasks: Array<() => Promise<void>> = [];
let ownerClient: SupabaseClient<Database>;

beforeAll(async () => {
  const school = await seedPublicSchool(sql, {
    ownerId,
    slug: ownerId,
    name: "Email school",
    offerings: [{ name: "Trial" }],
  });
  schoolId = school.schoolId;
  const password = randomUUID();
  await sql`UPDATE auth.users SET encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf')) WHERE id = ${ownerId}`;
  ownerClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await ownerClient.auth.signInWithPassword({
    email: `${ownerId}@local.test`,
    password,
  });
  if (error) throw error;
  const offering = school.offeringIds[0]!;
  const contact = requireRow(
    (
      await sql`INSERT INTO public.contacts (school_id, name, email, phone) VALUES (${schoolId}, 'Contact', 'delivered@resend.dev', '+123456789') RETURNING id`
    )[0],
    "contact",
  );
  const participant = requireRow(
    (
      await sql`INSERT INTO public.participants (school_id, contact_id, name, normalized_name) VALUES (${schoolId}, ${contact.id}, 'Participant', 'participant') RETURNING id`
    )[0],
    "participant",
  );
  const window = requireRow(
    (
      await sql`INSERT INTO public.trial_windows (school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity) VALUES (${schoolId}, ${offering}, 1, 600, 60, 5) RETURNING id`
    )[0],
    "window",
  );
  const start = new Date(now.getTime() + 23 * 3600_000);
  const end = new Date(start.getTime() + 3600_000);
  const occurrence = requireRow(
    (
      await sql`INSERT INTO public.trial_occurrences (school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity, booked_count) VALUES (${schoolId}, ${window.id}, ${offering}, ${start}, ${end}, 5, 1) RETURNING id`
    )[0],
    "occurrence",
  );
  bookingId = randomUUID();
  await sql`INSERT INTO public.bookings (id, school_id, contact_id, participant_id, trial_offering_id, trial_window_id, trial_occurrence_id, idempotency_key, participant_name_snapshot, participant_age_snapshot, offering_name_snapshot, timezone_snapshot, start_at, end_at, contact_email_snapshot, contact_name_snapshot, contact_phone_snapshot, ics_uid, created_at)
    VALUES (${bookingId}, ${schoolId}, ${contact.id}, ${participant.id}, ${offering}, ${window.id}, ${occurrence.id}, ${bookingId}, 'Participant', 10, 'Trial', 'UTC', ${start}, ${end}, 'delivered@resend.dev', 'Contact', '+123456789', ${bookingId}, ${new Date(start.getTime() - 36 * 3600_000)})`;
});
afterAll(async () => {
  ownerClient?.auth.stopAutoRefresh();
  vi.unstubAllEnvs();
  await deletePublicSchoolOwner(sql, ownerId);
  await sql.end();
});

async function enqueue(attempts = 0) {
  const { data } = await client()
    .from("email_deliveries")
    .insert({
      school_id: schoolId,
      booking_id: bookingId,
      kind: "owner_booking",
      recipient: "delivered@resend.dev",
      provider_idempotency_key: randomUUID(),
      attempts,
      next_attempt_at: now.toISOString(),
    })
    .select()
    .single()
    .throwOnError();
  return requireRow(data, "delivery");
}
async function state(id: string) {
  const { data } = await client()
    .from("email_deliveries")
    .select()
    .eq("id", id)
    .single()
    .throwOnError();
  return requireRow(data, "delivery");
}

it("restricts platform RPCs to service_role, including authenticated owners", async () => {
  const browser = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  for (const authenticated of [false, true]) {
    if (authenticated) {
      const { error } = await browser.auth.signInWithPassword({
        email: "owner@local.test",
        password: "local-dev-password",
      });
      if (error) throw error;
    }
    expect((await browser.rpc("claim_email_deliveries", { p_run_id: "forged" })).error?.code).toBe(
      "42501",
    );
    expect(
      (await browser.rpc("recover_email_deliveries", { p_stale_before: now.toISOString() })).error
        ?.code,
    ).toBe("42501");
    expect(
      (
        await browser.rpc("start_email_delivery", {
          p_id: randomUUID(),
          p_claimed_by: "forged",
          p_claimed_at: now.toISOString(),
          p_attempts: 0,
        })
      ).error?.code,
    ).toBe("42501");
    expect((await browser.rpc("enqueue_email_reminders", {})).error?.code).toBe("42501");
    expect(
      (
        await browser.rpc("enqueue_email_delivery", {
          p_school_id: schoolId,
          p_kind: "owner_booking",
          p_recipient: "delivered@resend.dev",
          p_key: randomUUID(),
        })
      ).error?.code,
    ).toBe("42501");
  }
});

it("claims disjoint batches concurrently, reserves a retry lane, and refills spare lanes", async () => {
  const rows = await Promise.all(Array.from({ length: 12 }, (_, i) => enqueue(i < 10 ? 0 : 1)));
  const ids = rows.map((row) => row.id);
  const first = await claimDueDeliveries("lanes", 5, { ids, now });
  expect(first.map((row) => row.attempts)).toEqual([0, 0, 0, 0, 1]);
  const batches = await Promise.all(
    ["a", "b", "c"].map((run) => claimDueDeliveries(run, 5, { ids, now })),
  );
  const all = [...first, ...batches.flat()];
  expect(all).toHaveLength(12);
  expect(new Set(all.map((row) => row.id)).size).toBe(12);
  expect(await claimDueDeliveries("empty", 5, { ids: [], now })).toEqual([]);
});

it("skips a row locked by another connection rather than waiting", async () => {
  const row = await enqueue();
  await sql.begin(async (tx) => {
    await tx`SELECT id FROM public.email_deliveries WHERE id = ${row.id} FOR UPDATE`;
    expect(await claimDueDeliveries("locked", 1, { ids: [row.id], now })).toEqual([]);
  });
  expect(await claimDueDeliveries("unlocked", 1, { ids: [row.id], now })).toHaveLength(1);
});

it("fences stale starts and all stale finalizers, even when a run ID is reused", async () => {
  const row = await enqueue();
  const old = requireRow(
    (await claimDueDeliveries("reused", 1, { ids: [row.id], now }))[0],
    "claim",
  );
  const later = new Date(now.getTime() + 6 * 60_000);
  expect(await recoverStuckEmailDeliveries(5 * 60_000, later, "recover", [row.id])).toEqual({
    recovered: 1,
    dead: 0,
  });
  const current = requireRow(
    (await claimDueDeliveries("reused", 1, { ids: [row.id], now: later }))[0],
    "claim",
  );
  const send = vi.fn(async () => ({
    ok: true as const,
    kind: "local_noop" as const,
    providerId: null,
  }));
  expect(await sendDelivery(old, { transport: { send } })).toBe("deferred");
  for (const state of ["sent", "failed", "dead"] as const)
    expect(await updateClaim(old, { state })).toBeNull();
  const result = await Promise.all([
    sendDelivery(current, { transport: { send } }),
    sendDelivery(current, { transport: { send } }),
  ]);
  expect(result.sort()).toEqual(["deferred", "sent"]);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await state(row.id)).attempts).toBe(1);
});

it("preserves backoff, retry budget and terminal causes, including crashed executions", async () => {
  const row = await enqueue();
  let clock = now;
  const transport = {
    send: async () => ({
      ok: false as const,
      kind: "email_error" as const,
      name: "rate_limit_exceeded",
      status: 429,
      message: "retry",
    }),
  };
  for (let execution = 1; execution <= MAX_EXECUTIONS; execution++) {
    const result = await runEmailSendOnce(
      "retry",
      { now: () => clock, transport },
      { ids: [row.id] },
    );
    const saved = await state(row.id);
    expect(saved.attempts).toBe(execution);
    if (execution < MAX_EXECUTIONS) {
      expect(result.retrying).toBe(1);
      expect(new Date(saved.next_attempt_at).getTime() - clock.getTime()).toBe(
        2 ** (execution - 1) * 60_000,
      );
      expect(await claimDueDeliveries("too-early", 1, { ids: [row.id], now: clock })).toEqual([]);
      clock = new Date(saved.next_attempt_at);
    } else
      expect(saved).toMatchObject({
        state: "dead",
        terminal_cause: "attempts_exhausted",
        failure_reason: "rate_limit_exceeded",
      });
  }
  const permanent = await enqueue();
  await runEmailSendOnce(
    "permanent",
    {
      now: () => now,
      transport: {
        send: async () => ({
          ok: false,
          kind: "email_error",
          name: "validation_error",
          status: 422,
          message: "invalid",
        }),
      },
    },
    { ids: [permanent.id] },
  );
  expect(await state(permanent.id)).toMatchObject({
    state: "dead",
    terminal_cause: "permanent",
    attempts: 1,
  });
  const crashed = await enqueue(MAX_EXECUTIONS);
  await claimDueDeliveries("crashed", 1, { ids: [crashed.id], now });
  expect(
    await recoverStuckEmailDeliveries(0, new Date(now.getTime() + 1), "recover", [crashed.id]),
  ).toEqual({ recovered: 1, dead: 1 });
  expect(await state(crashed.id)).toMatchObject({
    state: "dead",
    terminal_cause: "attempts_exhausted",
    failure_reason: "worker_crashed",
  });
});

it("enqueues SQL intents idempotently and reminders once at the existing 36-hour lead boundary", async () => {
  const key = randomUUID();
  const args = {
    p_school_id: schoolId,
    p_booking_id: bookingId,
    p_kind: "owner_booking" as const,
    p_recipient: "delivered@resend.dev",
    p_key: key,
  };
  const results = await Promise.all([
    client().rpc("enqueue_email_delivery", args).throwOnError(),
    client().rpc("enqueue_email_delivery", args).throwOnError(),
  ]);
  expect(results.filter((result) => result.data)).toHaveLength(1);
  await Promise.all([createDueReminderDeliveries(now), createDueReminderDeliveries(now)]);
  expect(
    await sql`SELECT id FROM public.email_deliveries WHERE booking_id = ${bookingId} AND kind = 'booking_reminder'`,
  ).toHaveLength(1);
  await createDueReminderDeliveries(now);
  expect(
    await sql`SELECT id FROM public.email_deliveries WHERE booking_id = ${bookingId} AND kind = 'booking_reminder'`,
  ).toHaveLength(1);
});

it("replays signed Resend events, rejects forged signatures and leaves dead rows terminal", async () => {
  const row = await enqueue();
  const providerId = randomUUID();
  await client()
    .from("email_deliveries")
    .update({ state: "sent", provider_id: providerId })
    .eq("id", row.id)
    .throwOnError();
  const key = Buffer.from("local-webhook-integration-secret");
  vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${key.toString("base64")}`);
  vi.stubEnv("RESEND_API_KEY", "re_local_integration_no_network");
  try {
    for (const [type, expected] of [
      ["email.delivered", "delivered"],
      ["email.delivered", "delivered"],
      ["email.complained", "complained"],
      ["email.delivered", "complained"],
      ["email.bounced", "complained"],
    ]) {
      const payload = JSON.stringify({ type, data: { email_id: providerId } });
      const id = randomUUID();
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", key)
        .update(`${id}.${timestamp}.${payload}`)
        .digest("base64");
      const request = (sig: string) =>
        new Request("http://localhost/api/webhooks/resend", {
          method: "POST",
          body: payload,
          headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": sig },
        });
      expect((await POST(request("v1,forged"))).status).toBe(401);
      expect((await POST(request(`v1,${signature}`))).status).toBe(200);
      expect((await state(row.id)).state).toBe(expected);
    }
    await client()
      .from("email_deliveries")
      .update({ state: "dead" })
      .eq("id", row.id)
      .throwOnError();
    await recordResendDeliveryEvent({ type: "email.delivered", data: { email_id: providerId } });
    expect((await state(row.id)).state).toBe("dead");
  } finally {
    vi.unstubAllEnvs();
  }
});

it("keeps bounced terminal and ignores provider events before a successful send", async () => {
  const row = await enqueue();
  const providerId = randomUUID();
  await client()
    .from("email_deliveries")
    .update({ provider_id: providerId })
    .eq("id", row.id)
    .throwOnError();
  await recordResendDeliveryEvent({ type: "email.delivered", data: { email_id: providerId } });
  expect((await state(row.id)).state).toBe("pending");
  await client().from("email_deliveries").update({ state: "sent" }).eq("id", row.id).throwOnError();
  await recordResendDeliveryEvent({ type: "email.bounced", data: { email_id: providerId } });
  await recordResendDeliveryEvent({ type: "email.delivered", data: { email_id: providerId } });
  expect((await state(row.id)).state).toBe("bounced");
});

it("renders lead contacts and an ICS confirmation with facts from split school tables", async () => {
  const session = requireRow(
    (
      await sql`INSERT INTO public.landing_sessions (school_id, session_key_hash) VALUES (${schoolId}, ${randomUUID()}) RETURNING id`
    )[0],
    "session",
  );
  const contact = requireRow(
    (await sql`SELECT contact_id FROM public.bookings WHERE id = ${bookingId}`)[0],
    "contact",
  );
  const lead = requireRow(
    (
      await sql`INSERT INTO public.leads (school_id, landing_session_id, contact_id, participant_name, participant_age, stated_need) VALUES (${schoolId}, ${session.id}, ${contact.contact_id}, 'Lead participant', 9, 'Weekend classes') RETURNING id`
    )[0],
    "lead",
  );
  const { data: leadDelivery } = await client()
    .from("email_deliveries")
    .insert({
      school_id: schoolId,
      lead_id: lead.id,
      kind: "owner_lead",
      recipient: "delivered@resend.dev",
      provider_idempotency_key: randomUUID(),
      next_attempt_at: now.toISOString(),
    })
    .select()
    .single()
    .throwOnError();
  const confirmation = await enqueue();
  await client()
    .from("email_deliveries")
    .update({ kind: "prospect_confirmation" })
    .eq("id", confirmation.id)
    .throwOnError();
  const messages: EmailMessage[] = [];
  const result = await runEmailSendOnce(
    "render",
    {
      now: () => now,
      transport: {
        send: async (message) => {
          messages.push(message);
          return { ok: true, kind: "local_noop", providerId: null };
        },
      },
    },
    { ids: [requireRow(leadDelivery, "lead delivery").id, confirmation.id] },
  );
  expect(result.sent).toBe(2);
  expect(messages.find((message) => message.subject.includes("lead"))?.text).toContain(
    "Contact <delivered@resend.dev> +123456789",
  );
  expect(messages.find((message) => message.subject.includes("lead"))?.text).toContain(
    "Weekend classes",
  );
  const prospect = requireRow(
    messages.find((message) => message.subject.includes("confirmed")),
    "confirmation",
  );
  expect(prospect.text).toContain("Email school");
  expect(prospect.text).toContain(`${ownerId}@local.test`);
  expect(prospect.attachments?.[0]?.content?.toString()).toContain("METHOD:PUBLISH");
  expect(prospect.attachments?.[0]?.content?.toString()).toContain(`UID:${bookingId}`);
});

it("continues the batch after a success-write DB error, leaving that claim for recovery", async () => {
  const first = await enqueue();
  const second = await enqueue();
  await client()
    .from("email_deliveries")
    .update({ created_at: new Date(now.getTime() - 86_400_000).toISOString() })
    .eq("id", first.id)
    .throwOnError();
  const name = `test_email_finish_${randomUUID().replaceAll("-", "")}`;
  await sql.unsafe(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test_success_write_failed'; END; $$`,
  );
  await sql.unsafe(
    `CREATE TRIGGER ${name} BEFORE UPDATE ON public.email_deliveries FOR EACH ROW WHEN (NEW.id = '${first.id}' AND NEW.state = 'sent') EXECUTE FUNCTION public.${name}()`,
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await runEmailSendOnce(
      "db-error",
      {
        now: () => now,
        transport: { send: async () => ({ ok: true, kind: "local_noop", providerId: null }) },
      },
      { ids: [first.id, second.id] },
    );
    expect(result).toMatchObject({ claimed: 2, sent: 1, deferred: 1 });
    expect((await state(first.id)).state).toBe("claimed");
    expect((await state(second.id)).state).toBe("sent");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"event":"email_delivery_attempt_failed"'),
    );
  } finally {
    log.mockRestore();
    await sql.unsafe(`DROP TRIGGER ${name} ON public.email_deliveries`);
    await sql.unsafe(`DROP FUNCTION public.${name}()`);
  }
});

it("dashboard cancellation sends its durable notifications in after(), without a cron", async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  try {
    const form = new FormData();
    form.set("id", bookingId);
    await cancelBookingAction(form);
    expect(afterTasks).toHaveLength(1);
    const { data: before } = await client()
      .from("email_deliveries")
      .select()
      .eq("booking_id", bookingId)
      .in("kind", ["booking_cancellation", "owner_cancellation"])
      .throwOnError();
    expect(before?.map((row) => row.state)).toEqual(["pending", "pending"]);
    await afterTasks.shift()!();
    const { data: sent } = await client()
      .from("email_deliveries")
      .select()
      .eq("booking_id", bookingId)
      .in("kind", ["booking_cancellation", "owner_cancellation"])
      .throwOnError();
    expect(sent?.map((row) => row.state)).toEqual(["sent", "sent"]);
    await cancelBookingAction(form); // replay must not schedule another inline attempt
    expect(afterTasks).toHaveLength(0);
  } finally {
    vi.unstubAllEnvs();
  }
});
