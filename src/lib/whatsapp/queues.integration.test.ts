import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Database } from "@/db/types";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import * as conversationStore from "@/lib/conversations/conversation-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";
import { post, textInboundPayload } from "@/test/whatsapp-webhook";
import type { InboundWhatsAppStatus } from "./status";
import {
  applyWhatsAppStatuses,
  claimDueWhatsAppDeliveries,
  enqueueWhatsAppDelivery,
  recoverStuckWhatsAppDeliveries,
  sendWhatsAppDelivery,
} from "./deliveries";
import * as inboundSchool from "./inbound";
import * as jobs from "./jobs";
import {
  claimDueWhatsAppJobs,
  enqueueInboundJobs,
  failJob,
  markJobDone,
  recoverStuckWhatsAppJobs,
  startJobExecution,
} from "./jobs";
import { deliveryFromRow, updateDeliveryClaim } from "./queue-store";
import { drainWhatsAppJobs } from "./worker";

vi.mock("server-only", () => ({}));
// Queue protocol tests deliberately do not run the legacy Turn (#253).
vi.mock("next/server", () => ({ after: vi.fn() }));
loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname))
  throw new Error("Local database required");
const sql = authSql();
const ownerId = randomUUID();
let schoolId = "";
let bookingId = "";
const phone = randomUUID();
const now = new Date();
const client = () => createAdminClient();
const message = () => ({
  phoneNumberId: phone,
  wamid: randomUUID(),
  waId: "15550000001",
  text: "Hello",
  profileName: "Guest",
});

beforeAll(async () => {
  const school = await seedPublicSchool(sql, {
    ownerId,
    slug: ownerId,
    name: "WhatsApp school",
    offerings: [{ name: "Trial" }],
  });
  schoolId = school.schoolId;
  await sql`UPDATE public.school_settings SET whatsapp_phone_number_id = ${phone} WHERE school_id = ${schoolId}`;
  const contact = requireRow(
    (
      await sql`INSERT INTO public.contacts (school_id, name, email, phone) VALUES (${schoolId}, 'Guest', 'guest@local.test', '15550000001') RETURNING id`
    )[0],
    "contact",
  );
  const participant = requireRow(
    (
      await sql`INSERT INTO public.participants (school_id, contact_id, name, normalized_name) VALUES (${schoolId}, ${contact.id}, 'Guest', 'guest') RETURNING id`
    )[0],
    "participant",
  );
  const offering = school.offeringIds[0]!;
  const window = requireRow(
    (
      await sql`INSERT INTO public.trial_windows (school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity) VALUES (${schoolId}, ${offering}, 1, 600, 60, 5) RETURNING id`
    )[0],
    "window",
  );
  const start = new Date(now.getTime() + 24 * 3600_000);
  const end = new Date(start.getTime() + 3600_000);
  const occurrence = requireRow(
    (
      await sql`INSERT INTO public.trial_occurrences (school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity, booked_count) VALUES (${schoolId}, ${window.id}, ${offering}, ${start}, ${end}, 5, 1) RETURNING id`
    )[0],
    "occurrence",
  );
  bookingId = randomUUID();
  await sql`INSERT INTO public.bookings (id, school_id, contact_id, participant_id, trial_offering_id, trial_window_id, trial_occurrence_id, idempotency_key, participant_name_snapshot, participant_age_snapshot, offering_name_snapshot, timezone_snapshot, start_at, end_at, contact_name_snapshot, contact_phone_snapshot, ics_uid)
    VALUES (${bookingId}, ${schoolId}, ${contact.id}, ${participant.id}, ${offering}, ${window.id}, ${occurrence.id}, ${bookingId}, 'Guest', 10, 'Trial', 'UTC', ${start}, ${end}, 'Guest', '15550000001', ${bookingId})`;
});
afterAll(async () => {
  await sql`DELETE FROM public.whatsapp_jobs WHERE phone_number_id = ${phone}`;
  await deletePublicSchoolOwner(sql, ownerId);
  await sql.end();
});

async function enqueue(confirmation = false) {
  const id = await enqueueWhatsAppDelivery({
    schoolId,
    phoneNumberId: phone,
    recipientWaId: "15550000001",
    providerIdempotencyKey: randomUUID(),
    body: "Hello",
    windowExpiresAt: new Date(now.getTime() + 3600_000),
    templateName: confirmation ? "booking_confirmation" : undefined,
    bookingId: confirmation ? bookingId : undefined,
  });
  return requireRow(id, "delivery ID");
}
async function state(id: string) {
  const { data } = await client()
    .from("whatsapp_deliveries")
    .select()
    .eq("id", id)
    .single()
    .throwOnError();
  return requireRow(data, "delivery");
}
function status(
  id: string,
  name: InboundWhatsAppStatus["status"],
  extra: Partial<InboundWhatsAppStatus> = {},
): InboundWhatsAppStatus {
  return {
    wamid: id,
    status: name,
    timestamp: null,
    recipientId: "15550000001",
    errorCode: null,
    errorMessage: null,
    ...extra,
  };
}
async function claim(id: string, at = new Date()) {
  return requireRow(
    (await claimDueWhatsAppDeliveries(randomUUID(), { ids: [id], now: at }))[0],
    "claim",
  );
}

it("signed inbound webhook replay enqueues one public job; concurrent claims and starts are fenced", async () => {
  const inbound = message();
  const payload = textInboundPayload(inbound);
  expect((await POST(post(payload))).status).toBe(200);
  expect((await POST(post(payload))).status).toBe(200);
  expect(await enqueueInboundJobs([inbound])).toBe(0);
  const [a, b] = await Promise.all([
    claimDueWhatsAppJobs("a", { phoneNumberIds: [phone] }),
    claimDueWhatsAppJobs("b", { phoneNumberIds: [phone] }),
  ]);
  expect(a.length + b.length).toBe(1);
  const job = requireRow([...a, ...b][0], "job");
  const starts = await Promise.all([
    startJobExecution(job, schoolId),
    startJobExecution(job, schoolId),
  ]);
  expect(starts.filter(Boolean)).toHaveLength(1);
  expect(await markJobDone(job)).toBe(false);
  expect(await markJobDone(requireRow(starts.find(Boolean), "started"))).toBe(true);
});

it("reserves retry lanes, refills, skips held rows and fences recovered job owners", async () => {
  const inbound = Array.from({ length: 7 }, message);
  await enqueueInboundJobs(inbound);
  await sql`UPDATE public.whatsapp_jobs SET attempts = 1 WHERE dedupe_key = ${inbound[6]!.wamid}`;
  const claimed = await claimDueWhatsAppJobs("lanes", { phoneNumberIds: [phone], limit: 5 });
  expect(claimed.map((row) => row.attempts)).toEqual([0, 0, 0, 0, 1]);
  const stale = requireRow(claimed[0], "claim");
  await recoverStuckWhatsAppJobs(0, new Date(Date.now() + 1000), "recovery", [phone]);
  expect(await startJobExecution(stale)).toBeNull();
  expect(await markJobDone(stale)).toBe(false);
  await sql.begin(async (tx) => {
    await tx`SELECT id FROM public.whatsapp_jobs WHERE phone_number_id = ${phone} FOR UPDATE`;
    expect(await claimDueWhatsAppJobs("skip", { phoneNumberIds: [phone] })).toEqual([]);
  });
  const remaining = await claimDueWhatsAppJobs("refill", { phoneNumberIds: [phone], limit: 10 });
  expect(remaining).toHaveLength(7);
  for (const job of remaining) await markJobDone(job);
});

it("job exhaustion atomically enqueues a deduplicated fallback using private school settings", async () => {
  const inbound = message();
  await enqueueInboundJobs([inbound]);
  await sql`UPDATE public.whatsapp_jobs SET attempts = 4 WHERE dedupe_key = ${inbound.wamid}`;
  const job = requireRow(
    (await claimDueWhatsAppJobs("death", { phoneNumberIds: [phone] }))[0],
    "claim",
  );
  const started = requireRow(await startJobExecution(job, schoolId), "started");
  expect(await failJob(started, { kind: "internal", reason: "whatsapp_job_failed" }, "test")).toBe(
    "dead",
  );
  expect(await failJob(started, { kind: "internal", reason: "whatsapp_job_failed" }, "test")).toBe(
    "deferred",
  );
  const { data } = await client()
    .from("whatsapp_deliveries")
    .select()
    .eq("provider_idempotency_key", `job-fallback/${job.id}`)
    .single()
    .throwOnError();
  expect(data?.school_id).toBe(schoolId);
  expect(data?.recipient_wa_id).toBe(inbound.waId);
  expect(data?.state).toBe("pending");
});

it("SQL enqueue deduplicates; disjoint delivery claims and full-fenced starts/finalizers prevent double sends", async () => {
  const key = randomUUID();
  const input = {
    schoolId,
    phoneNumberId: phone,
    recipientWaId: "1555",
    providerIdempotencyKey: key,
    body: "Hello",
  };
  const ids = await Promise.all([enqueueWhatsAppDelivery(input), enqueueWhatsAppDelivery(input)]);
  expect(ids.filter(Boolean)).toHaveLength(1);
  const id = requireRow(ids.find(Boolean), "id");
  const [a, b] = await Promise.all([
    claimDueWhatsAppDeliveries("a", { ids: [id] }),
    claimDueWhatsAppDeliveries("b", { ids: [id] }),
  ]);
  expect(a.length + b.length).toBe(1);
  const snapshot = requireRow([...a, ...b][0], "claim");
  const args = {
    p_id: id,
    p_claimed_by: snapshot.claimedBy!,
    p_claimed_at: snapshot.claimedAt!,
    p_attempts: 0,
  };
  const starts = await Promise.all([
    client().rpc("start_whatsapp_delivery", args).throwOnError(),
    client().rpc("start_whatsapp_delivery", args).throwOnError(),
  ]);
  expect(starts.flatMap((row) => row.data ?? [])).toHaveLength(1);
  expect(await updateDeliveryClaim(snapshot, { state: "sent" })).toBeNull();
  await recoverStuckWhatsAppDeliveries(0, new Date(Date.now() + 1000), "recovery", [phone]);
  const successor = await claim(id, new Date(Date.now() + 2000));
  expect(
    await updateDeliveryClaim(
      deliveryFromRow(requireRow(starts.flatMap((row) => row.data ?? [])[0], "execution")),
      { state: "sent" },
    ),
  ).toBeNull();
  expect(
    await updateDeliveryClaim(successor, {
      state: "dead",
      terminal_cause: "permanent",
      claimed_at: null,
      claimed_by: null,
    }),
  ).not.toBeNull();
});

it("unknown sends retry with backoff; same-attempt receipts reconcile before the next execution", async () => {
  const id = await enqueue();
  const transport = {
    sendText: vi.fn(async () => ({
      ok: false as const,
      kind: "unknown" as const,
      reason: "network_error" as const,
      message: "timeout",
    })),
    sendTemplate: vi.fn(),
    sendInteractive: vi.fn(),
  };
  expect(await sendWhatsAppDelivery(await claim(id), { now: () => now, transport })).toBe(
    "retrying",
  );
  const failed = await state(id);
  expect(failed.attempts).toBe(1);
  expect(failed.send_outcome).toBe("unknown");
  expect(new Date(failed.next_attempt_at).getTime()).toBe(now.getTime() + 10_000);
  await applyWhatsAppStatuses([
    status("receipt", "delivered", { callbackData: `${id}:1`, phoneNumberId: "wrong" }),
  ]);
  expect((await state(id)).state).toBe("failed");
  await applyWhatsAppStatuses([
    status("receipt", "delivered", { callbackData: `${id}:1`, phoneNumberId: phone }),
  ]);
  expect((await state(id)).state).toBe("delivered");
  expect(
    await claimDueWhatsAppDeliveries("no-retry", {
      ids: [id],
      now: new Date(now.getTime() + 60_000),
    }),
  ).toEqual([]);
  expect(transport.sendText).toHaveBeenCalledTimes(1);
});

it("a new execution invalidates old unknown callbacks, and receipts win over in-flight finalizers", async () => {
  const id = await enqueue();
  const first = await claim(id);
  const { data } = await client()
    .rpc("start_whatsapp_delivery", {
      p_id: id,
      p_claimed_at: first.claimedAt!,
      p_claimed_by: first.claimedBy!,
      p_attempts: 0,
    })
    .throwOnError();
  const executing = deliveryFromRow(requireRow(data?.[0], "started"));
  await updateDeliveryClaim(executing, {
    state: "failed",
    next_attempt_at: now.toISOString(),
    claimed_at: null,
    claimed_by: null,
  });
  const second = await claim(id);
  const next = await client()
    .rpc("start_whatsapp_delivery", {
      p_id: id,
      p_claimed_at: second.claimedAt!,
      p_claimed_by: second.claimedBy!,
      p_attempts: 1,
    })
    .throwOnError();
  await applyWhatsAppStatuses([
    status("old", "read", { callbackData: `${id}:1`, phoneNumberId: phone }),
  ]);
  expect((await state(id)).state).toBe("claimed");
  await applyWhatsAppStatuses([
    status("new", "sent", { callbackData: `${id}:2`, phoneNumberId: phone }),
  ]);
  expect((await state(id)).state).toBe("sent");
  expect(
    await updateDeliveryClaim(deliveryFromRow(requireRow(next.data?.[0], "started")), {
      state: "failed",
    }),
  ).toBeNull();
});

it("status webhook ignores regressions but same-attempt delivered/read cancels a known failure retry", async () => {
  const id = await enqueue();
  const send = vi.fn(async () => ({
    ok: true as const,
    kind: "accepted" as const,
    providerId: id,
  }));
  expect(
    await sendWhatsAppDelivery(await claim(id), {
      transport: { sendText: send, sendTemplate: send, sendInteractive: send },
    }),
  ).toBe("sent");
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phone },
              statuses: [
                { id, status: "delivered", timestamp: `${Math.floor(Date.now() / 1000)}` },
              ],
            },
          },
        ],
      },
    ],
  };
  expect((await POST(post(payload))).status).toBe(200);
  expect((await POST(post(payload))).status).toBe(200);
  await applyWhatsAppStatuses([status(id, "sent"), status(id, "failed", { errorCode: "131026" })]);
  expect((await state(id)).state).toBe("delivered");
  await applyWhatsAppStatuses([status(id, "read"), status(id, "delivered"), status(id, "failed")]);
  expect((await state(id)).state).toBe("read");
  const rejected = await enqueue();
  await client()
    .from("whatsapp_deliveries")
    .update({ state: "sent", attempts: 1, send_outcome: "accepted", provider_id: rejected })
    .eq("id", rejected)
    .throwOnError();
  await applyWhatsAppStatuses([status(rejected, "failed", { errorCode: "131000" })]);
  const before = await state(rejected);
  expect(before.state).toBe("failed");
  await applyWhatsAppStatuses([status(rejected, "failed"), status(rejected, "sent")]);
  expect(await state(rejected)).toEqual(before);
  await applyWhatsAppStatuses([status(rejected, "delivered")]);
  expect((await state(rejected)).state).toBe("delivered");
  expect(
    await claimDueWhatsAppDeliveries("no-second-send", {
      ids: [rejected],
      now: new Date(Date.now() + 60_000),
    }),
  ).toEqual([]);
  await applyWhatsAppStatuses([
    status(rejected, "read"),
    status(rejected, "sent"),
    status(rejected, "failed"),
  ]);
  expect((await state(rejected)).state).toBe("read");
});

it("legacy Turn IDs never enter public queue FKs and processing errors consume an execution", async () => {
  const legacyId = randomUUID();
  const resolve = vi
    .spyOn(inboundSchool, "resolveInboundSchool")
    .mockResolvedValue({ resolved: true, schoolId: legacyId });
  const answered = vi
    .spyOn(conversationStore, "hasWhatsAppMessage")
    .mockRejectedValue(new Error("legacy Turn failed"));
  try {
    const inbound = message();
    await enqueueInboundJobs([inbound]);
    const counts = await drainWhatsAppJobs("legacy-failure", 10, { phoneNumberIds: [phone] });
    expect(counts).toMatchObject({ claimed: 1, retrying: 1 });
    const { data } = await client()
      .from("whatsapp_jobs")
      .select()
      .eq("dedupe_key", inbound.wamid)
      .single()
      .throwOnError();
    expect(data).toMatchObject({ school_id: schoolId, attempts: 1, state: "failed" });
    // An answered legacy marker also completes using public identity, not the
    // unrelated app school ID. Reply enqueues share the authoritative mapping.
    answered.mockResolvedValue(true);
    await client()
      .from("whatsapp_jobs")
      .update({ next_attempt_at: new Date().toISOString() })
      .eq("dedupe_key", inbound.wamid)
      .throwOnError();
    expect(await drainWhatsAppJobs("legacy-done", 10, { phoneNumberIds: [phone] })).toMatchObject({
      done: 1,
    });
    const { data: done } = await client()
      .from("whatsapp_jobs")
      .select()
      .eq("dedupe_key", inbound.wamid)
      .single()
      .throwOnError();
    expect(done).toMatchObject({ school_id: schoolId, state: "done" });
    const id = await enqueueWhatsAppDelivery({
      schoolId: legacyId,
      phoneNumberId: phone,
      recipientWaId: "1555",
      providerIdempotencyKey: randomUUID(),
    });
    expect((await state(requireRow(id, "reply"))).school_id).toBe(schoolId);
  } finally {
    resolve.mockRestore();
    answered.mockRestore();
  }
});

it("one job persistence failure does not abort the next job in the batch", async () => {
  const resolve = vi
    .spyOn(inboundSchool, "resolveInboundSchool")
    .mockResolvedValue({ resolved: false, reason: "empty_text" });
  const start = vi
    .spyOn(jobs, "startJobExecution")
    .mockRejectedValueOnce(new Error("start write failed"))
    .mockRejectedValueOnce(new Error("start retry failed"));
  try {
    await enqueueInboundJobs([message(), message()]);
    expect(await drainWhatsAppJobs("isolation", 10, { phoneNumberIds: [phone] })).toMatchObject({
      claimed: 2,
      done: 1,
      deferred: 1,
    });
  } finally {
    resolve.mockRestore();
    start.mockRestore();
  }
  await client()
    .from("whatsapp_jobs")
    .update({ state: "done", claimed_at: null, claimed_by: null })
    .eq("phone_number_id", phone)
    .eq("state", "claimed")
    .throwOnError();
});

it("dead unknown confirmation queues owner email atomically; confirmed cancels only unstarted email", async () => {
  const id = await enqueue(true);
  await client()
    .from("whatsapp_deliveries")
    .update({
      state: "claimed",
      attempts: 5,
      claimed_at: new Date(now.getTime() - 600_000).toISOString(),
      claimed_by: "crashed",
      send_outcome: "unknown",
    })
    .eq("id", id)
    .throwOnError();
  await recoverStuckWhatsAppDeliveries(300_000, now, "death", [phone]);
  expect((await state(id)).state).toBe("dead");
  const email = async () =>
    client()
      .from("email_deliveries")
      .select()
      .eq("booking_id", bookingId)
      .eq("kind", "owner_whatsapp_confirmation_failed")
      .maybeSingle()
      .throwOnError();
  expect((await email()).data?.state).toBe("pending");
  await applyWhatsAppStatuses([
    status("confirmed", "read", { callbackData: `${id}:5`, phoneNumberId: phone }),
  ]);
  expect((await state(id)).state).toBe("read");
  expect((await email()).data).toBeNull();
  const second = await enqueue(true);
  await client()
    .from("whatsapp_deliveries")
    .update({ state: "dead", terminal_cause: "permanent", send_outcome: "unknown", attempts: 1 })
    .eq("id", second)
    .throwOnError();
  const notice = requireRow((await email()).data, "notice");
  await client()
    .from("email_deliveries")
    .update({ state: "claimed", attempts: 1 })
    .eq("id", notice.id)
    .throwOnError();
  await applyWhatsAppStatuses([
    status("confirmed-again", "delivered", { callbackData: `${second}:1`, phoneNumberId: phone }),
  ]);
  expect((await email()).data?.state).toBe("claimed");
});

it("blank private notification addresses do not enqueue owner email", async () => {
  await client().from("email_deliveries").delete().eq("booking_id", bookingId).throwOnError();
  await sql`UPDATE public.school_settings SET notification_email = '   ' WHERE school_id = ${schoolId}`;
  try {
    const id = await enqueue(true);
    await client()
      .from("whatsapp_deliveries")
      .update({ state: "dead", terminal_cause: "permanent" })
      .eq("id", id)
      .throwOnError();
    const { data } = await client()
      .from("email_deliveries")
      .select("id")
      .eq("booking_id", bookingId)
      .throwOnError();
    expect(data).toEqual([]);
  } finally {
    await sql`UPDATE public.school_settings SET notification_email = ${`${ownerId}@local.test`} WHERE school_id = ${schoolId}`;
  }
});

it("five started sends share the retry budget and a normal retry can succeed", async () => {
  const id = await enqueue();
  let clock = new Date();
  const send = vi.fn(async () => ({
    ok: false as const,
    kind: "unknown" as const,
    reason: "network_error" as const,
    message: "timeout",
  }));
  const transport = { sendText: send, sendTemplate: send, sendInteractive: send };
  for (let attempt = 1; attempt <= 5; attempt++) {
    const snapshot = await claim(id, clock);
    expect(await sendWhatsAppDelivery(snapshot, { now: () => clock, transport })).toBe(
      attempt === 5 ? "dead" : "retrying",
    );
    const row = await state(id);
    expect(row.attempts).toBe(attempt);
    if (attempt < 5) {
      expect(new Date(row.next_attempt_at).getTime() - clock.getTime()).toBe(
        10_000 * 2 ** (attempt - 1),
      );
      clock = new Date(row.next_attempt_at);
    } else {
      expect(row.terminal_cause).toBe("attempts_exhausted");
      expect(row.send_outcome).toBe("unknown");
    }
  }
  expect(send).toHaveBeenCalledTimes(5);
  const retry = await enqueue();
  expect(await sendWhatsAppDelivery(await claim(retry), { transport })).toBe("retrying");
  const at = new Date((await state(retry)).next_attempt_at);
  const success = vi.fn(async () => ({
    ok: true as const,
    kind: "accepted" as const,
    providerId: retry,
  }));
  expect(
    await sendWhatsAppDelivery(await claim(retry, at), {
      now: () => at,
      transport: { sendText: success, sendTemplate: success, sendInteractive: success },
    }),
  ).toBe("sent");
  expect((await state(retry)).attempts).toBe(2);
});

it("crash recovery death queues one fallback, but an expired inbound window queues none", async () => {
  const inbound = message();
  await enqueueInboundJobs([inbound]);
  await sql`UPDATE public.whatsapp_jobs SET state = 'claimed', attempts = 5, claimed_by = 'crash', claimed_at = now() - interval '10 minutes' WHERE dedupe_key = ${inbound.wamid}`;
  expect(await recoverStuckWhatsAppJobs(300_000, new Date(), "recovery", [phone])).toEqual({
    recovered: 0,
    dead: 1,
  });
  expect(await recoverStuckWhatsAppJobs(300_000, new Date(), "replay", [phone])).toEqual({
    recovered: 0,
    dead: 0,
  });
  const [job] = await sql`SELECT id FROM public.whatsapp_jobs WHERE dedupe_key = ${inbound.wamid}`;
  const { data } = await client()
    .from("whatsapp_deliveries")
    .select("id")
    .eq("provider_idempotency_key", `job-fallback/${job!.id}`)
    .throwOnError();
  expect(data).toHaveLength(1);
  const old = { ...message(), waId: randomUUID() };
  await enqueueInboundJobs([old]);
  await sql`UPDATE public.whatsapp_jobs SET created_at = now() - interval '25 hours', state = 'claimed', attempts = 5, claimed_by = 'crash', claimed_at = now() - interval '10 minutes' WHERE dedupe_key = ${old.wamid}`;
  await recoverStuckWhatsAppJobs(300_000, new Date(), "expired", [phone]);
  const { data: expired } = await client()
    .from("whatsapp_deliveries")
    .select("id")
    .eq("recipient_wa_id", old.waId)
    .throwOnError();
  expect(expired).toEqual([]);
});

it("permanent failure status queues the confirmation notice exactly once; stale confirmations do not send", async () => {
  await client().from("email_deliveries").delete().eq("booking_id", bookingId).throwOnError();
  const id = await enqueue(true);
  await client()
    .from("whatsapp_deliveries")
    .update({ state: "sent", attempts: 1, send_outcome: "accepted", provider_id: id })
    .eq("id", id)
    .throwOnError();
  await applyWhatsAppStatuses([status(id, "failed", { errorCode: "131026" })]);
  expect((await state(id)).terminal_cause).toBe("permanent");
  const notice = await client()
    .from("email_deliveries")
    .select()
    .eq("booking_id", bookingId)
    .single()
    .throwOnError();
  expect(notice.data?.kind).toBe("owner_whatsapp_confirmation_failed");
  await applyWhatsAppStatuses([status(id, "failed"), status(id, "read")]);
  expect((await state(id)).state).toBe("dead");
  expect(
    (
      await client()
        .from("email_deliveries")
        .select("id")
        .eq("booking_id", bookingId)
        .single()
        .throwOnError()
    ).data?.id,
  ).toBe(notice.data?.id);
  await client().from("email_deliveries").delete().eq("booking_id", bookingId).throwOnError();
  await sql`UPDATE public.bookings SET start_at = now() - interval '1 hour' WHERE id = ${bookingId}`;
  const stale = await enqueue(true);
  const send = vi.fn();
  expect(
    await sendWhatsAppDelivery(await claim(stale), {
      transport: { sendText: send, sendTemplate: send, sendInteractive: send },
    }),
  ).toBe("dead");
  expect((await state(stale)).terminal_cause).toBe("stale");
  expect(send).not.toHaveBeenCalled();
  const { data } = await client()
    .from("email_deliveries")
    .select("id")
    .eq("booking_id", bookingId)
    .throwOnError();
  expect(data).toEqual([]);
});

it("platform functions are service_role-only invokers with empty search_path", async () => {
  const functions =
    await sql`SELECT oid::regprocedure::text AS signature, proname, prosecdef, proconfig FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND (proname LIKE '%whatsapp%' AND proname NOT LIKE '%booking%')`;
  expect(functions.length).toBe(10);
  for (const fn of functions) {
    expect(fn.prosecdef).toBe(false);
    expect(fn.proconfig).toContain('search_path=""');
    const [grants] =
      await sql`SELECT has_function_privilege('anon', ${fn.signature}, 'EXECUTE') AS anon, has_function_privilege('authenticated', ${fn.signature}, 'EXECUTE') AS owner, has_function_privilege('service_role', ${fn.signature}, 'EXECUTE') AS service`;
    expect(grants).toMatchObject({ anon: false, owner: false, service: true });
  }
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
    expect((await browser.rpc("claim_whatsapp_jobs", { p_run_id: "forged" })).error?.code).toBe(
      "42501",
    );
    expect(
      (
        await browser.rpc("enqueue_whatsapp_delivery", {
          p_school_id: schoolId,
          p_recipient: "forged",
          p_phone_number_id: phone,
          p_key: randomUUID(),
        })
      ).error?.code,
    ).toBe("42501");
  }
  browser.auth.stopAutoRefresh();
});
