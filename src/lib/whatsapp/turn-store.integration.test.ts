import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import * as assistant from "@/lib/ai/assistant";
import * as conversations from "@/lib/conversations/conversation-store";
import { hashWaId } from "@/lib/crypto";
import { encodeSlotId } from "@/lib/schedule/slot-id";
import { createAdminClient } from "@/lib/supabase/admin";
import { authSql, loadLocalEnv, requireRow, whileSavingMessages } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";
import { post, textInboundPayload } from "@/test/whatsapp-webhook";
import { getPendingBookingIntent } from "./intents";
import { commitWhatsAppTurn, type PreparedEffect } from "./turn-store";
import { drainWhatsAppJobs } from "./worker";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
loadLocalEnv();
const sql = authSql();
const ownerId = randomUUID();
const phone = randomUUID();
const now = new Date();
let schoolId: string;
let offeringId: string;
let slotId: string;
const client = () => createAdminClient();

beforeAll(async () => {
  const school = await seedPublicSchool(sql, {
    ownerId,
    slug: ownerId,
    name: "Turn school",
    publishedAt: now,
    offerings: [{ name: "Karate" }],
  });
  schoolId = school.schoolId;
  offeringId = requireRow(school.offeringIds[0], "offering");
  const [window] =
    await sql`INSERT INTO public.trial_windows (school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity)
    VALUES (${schoolId}, ${offeringId}, 1, 600, 60, 5) RETURNING id`;
  slotId = encodeSlotId(requireRow(window, "window").id, new Date(now.getTime() + 24 * 3600_000));
  await sql`UPDATE public.school_settings SET whatsapp_phone_number_id = ${phone} WHERE school_id = ${schoolId}`;
});
afterAll(async () => {
  await sql`DELETE FROM public.whatsapp_jobs WHERE phone_number_id = ${phone}`;
  await deletePublicSchoolOwner(sql, ownerId);
  await sql.end();
});

async function turn(effect: PreparedEffect = { kind: "reply" }) {
  const waId = randomUUID();
  const resolved = await conversations.findOrCreateConversation({
    schoolId,
    identity: { channel: "whatsapp", waId },
    now,
  });
  const conversationId = resolved.conversation.id;
  const lock = requireRow(
    await conversations.claimGeneration(schoolId, conversationId, { now }),
    "generation",
  );
  return {
    schoolId,
    conversationId,
    generation: lock.generation,
    waId,
    phoneNumberId: phone,
    wamid: randomUUID(),
    inboundMessageId: randomUUID(),
    inboundText: "Hello",
    replyText: "Hello there",
    effect,
    now,
  };
}
function bookingEffect(): Extract<PreparedEffect, { kind: "booking_intent" }> {
  return {
    kind: "booking_intent",
    trialOfferingId: offeringId,
    slotId,
    participantName: "Guest",
    participantAge: 10,
  };
}
function leadEffect(): Extract<PreparedEffect, { kind: "lead_request" }> {
  return {
    kind: "lead_request",
    contactName: "Guest",
    participantName: "Guest",
    participantAge: 10,
    trialOfferingId: offeringId,
    statedNeed: "A different time",
  };
}

it("commits ordered messages and a public reply outbox, and replay is a no-op", async () => {
  const input = await turn();
  const result = requireRow(await commitWhatsAppTurn(input), "turn");
  expect(result.delivery_ids).toHaveLength(1);
  const history = await conversations.loadTranscript(schoolId, input.conversationId);
  expect(history.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(
    await conversations.hasWhatsAppMessage({ schoolId, waId: input.waId, messageId: input.wamid }),
  ).toBe(true);
  expect(await commitWhatsAppTurn(input)).toBeUndefined();
  const { data } = await client()
    .from("whatsapp_deliveries")
    .select()
    .eq("id", result.delivery_ids[0]!)
    .single()
    .throwOnError();
  expect(data).toMatchObject({ school_id: schoolId, state: "pending", body: input.replyText });
});

it("proposes and supersedes intents with a confirm-button notice in the same commit", async () => {
  const input = await turn(bookingEffect());
  const first = requireRow(await commitWhatsAppTurn(input), "turn");
  const intent = requireRow(await getPendingBookingIntent(input.conversationId, now), "intent");
  const { data } = await client()
    .from("whatsapp_deliveries")
    .select("interactive_buttons")
    .eq("id", first.delivery_ids[0]!)
    .single()
    .throwOnError();
  expect(data?.interactive_buttons).toEqual([
    { id: `confirm_booking:${intent.id}`, title: "Confirm booking" },
    { id: "choose_another_time", title: "Choose another time" },
  ]);
  await commitWhatsAppTurn({ ...input, wamid: randomUUID(), inboundMessageId: randomUUID() });
  const pending = requireRow(
    await getPendingBookingIntent(input.conversationId, now),
    "new intent",
  );
  expect(pending.id).not.toBe(intent.id);
  const { data: old } = await client()
    .from("whatsapp_booking_intents")
    .select("state")
    .eq("id", intent.id)
    .single()
    .throwOnError();
  expect(old?.state).toBe("superseded");
});

it("commits a dashboard-visible lead, contact attachment, owner email and event", async () => {
  const input = await turn(leadEffect());
  const result = requireRow(await commitWhatsAppTurn(input), "turn");
  const { data: lead } = await client()
    .from("leads")
    .select()
    .eq("id", result.lead_id)
    .single()
    .throwOnError();
  expect(lead).toMatchObject({
    school_id: schoolId,
    participant_name: "Guest",
    stated_need: "A different time",
  });
  const { data: conversation } = await client()
    .from("conversations")
    .select("contact_id")
    .eq("id", input.conversationId)
    .single()
    .throwOnError();
  expect(conversation?.contact_id).toBe(lead?.contact_id);
  const { count } = await client()
    .from("email_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", result.lead_id)
    .throwOnError();
  expect(count).toBe(1);
});

it.each(["booking_intent", "lead_request"] as const)(
  "rolls back inbound and %s effects when assistant append fails",
  async (kind) => {
    const input = await turn(kind === "booking_intent" ? bookingEffect() : leadEffect());
    const before =
      await sql`SELECT (SELECT count(*) FROM public.leads WHERE school_id = ${schoolId}) AS leads,
    (SELECT count(*) FROM public.contacts WHERE school_id = ${schoolId}) AS contacts,
    (SELECT count(*) FROM public.email_deliveries WHERE school_id = ${schoolId}) AS emails,
    (SELECT count(*) FROM public.funnel_events WHERE school_id = ${schoolId}) AS events`;
    await whileSavingMessages(
      sql,
      {
        conversationId: input.conversationId,
        role: "assistant",
        statement: "raise exception 'injected_failure'",
      },
      async () => {
        await expect(commitWhatsAppTurn(input)).rejects.toMatchObject({
          message: "injected_failure",
        });
      },
    );
    expect(await conversations.loadTranscript(schoolId, input.conversationId)).toEqual([]);
    expect(await getPendingBookingIntent(input.conversationId, now)).toBeNull();
    const after =
      await sql`SELECT (SELECT count(*) FROM public.leads WHERE school_id = ${schoolId}) AS leads,
    (SELECT count(*) FROM public.contacts WHERE school_id = ${schoolId}) AS contacts,
    (SELECT count(*) FROM public.email_deliveries WHERE school_id = ${schoolId}) AS emails,
    (SELECT count(*) FROM public.funnel_events WHERE school_id = ${schoolId}) AS events`;
    expect(after).toEqual(before);
    await commitWhatsAppTurn(input);
  },
);

it("rolls back both messages and lead when final outbox enqueue fails", async () => {
  const input = await turn(leadEffect());
  // Invalid chunks fail after lead + assistant append, not before the boundary.
  const { error } = await client().rpc("commit_whatsapp_turn", {
    p_school_id: schoolId,
    p_conversation_id: input.conversationId,
    p_generation: input.generation,
    p_wa_id: input.waId,
    p_phone_number_id: phone,
    p_wamid: input.wamid,
    p_inbound_id: input.inboundMessageId,
    p_inbound_text: input.inboundText,
    p_reply_id: randomUUID(),
    p_reply_message_id: randomUUID(),
    p_reply_text: input.replyText,
    p_reply_chunks: ["queued first", null],
    p_effect: input.effect,
    p_now: now.toISOString(),
  });
  expect(error?.message).toBe("invalid_reply_chunk");
  expect(await conversations.loadTranscript(schoolId, input.conversationId)).toEqual([]);
  const contacts =
    await sql`SELECT id FROM public.contacts WHERE school_id = ${schoolId} AND phone = ${input.waId}`;
  expect(contacts).toHaveLength(0);
  const { count } = await client()
    .from("whatsapp_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("recipient_wa_id", input.waId)
    .throwOnError();
  expect(count).toBe(0);
});

it("fences stale generation, release, recipient, phone and tenant scope", async () => {
  const input = await turn();
  const next = requireRow(
    await conversations.claimGeneration(schoolId, input.conversationId, {
      now: new Date(now.getTime() + 11 * 60_000),
    }),
    "replacement",
  );
  await expect(commitWhatsAppTurn(input)).rejects.toMatchObject({
    message: "generation_or_scope_lost",
  });
  for (const scope of [
    { waId: randomUUID() },
    { phoneNumberId: randomUUID() },
    { schoolId: randomUUID() },
  ]) {
    await expect(
      commitWhatsAppTurn({ ...input, generation: next.generation, ...scope }),
    ).rejects.toMatchObject({ message: "generation_or_scope_lost" });
  }
  await commitWhatsAppTurn({ ...input, generation: next.generation });
  await next.release();
});

it("serializes concurrent first jobs and keeps terminal history on replacement", async () => {
  const waId = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      conversations.findOrCreateConversation({
        schoolId,
        identity: { channel: "whatsapp", waId },
        now,
      }),
    ),
  );
  expect(new Set(results.map((result) => result.conversation.id)).size).toBe(1);
  const id = results[0]!.conversation.id;
  await client()
    .from("conversations")
    .update({ expires_at: now.toISOString() })
    .eq("id", id)
    .throwOnError();
  const next = await conversations.findOrCreateConversation({
    schoolId,
    identity: { channel: "whatsapp", waId },
    now,
  });
  expect(next.conversation.id).not.toBe(id);
  const { data } = await client()
    .from("conversations")
    .select("ended_at, end_reason, resume_token_hash")
    .eq("id", id)
    .single()
    .throwOnError();
  expect(data?.end_reason).toBe("inactivity");
  expect(data?.resume_token_hash).toHaveLength(64);
});

it("maintenance ends both channels, expires intents, retains messages and protects live generation", async () => {
  const input = await turn(bookingEffect());
  await commitWhatsAppTurn(input);
  const live = await turn();
  const expired = new Date(now.getTime() - 1).toISOString();
  await client()
    .from("conversations")
    .update({ expires_at: expired, generating_at: null })
    .eq("id", input.conversationId)
    .throwOnError();
  await client()
    .from("conversations")
    .update({ expires_at: expired })
    .eq("id", live.conversationId)
    .throwOnError();
  const { data: web } = await client()
    .from("conversations")
    .insert({ school_id: schoolId, resume_token_hash: randomUUID(), expires_at: expired })
    .select("id")
    .single()
    .throwOnError();
  await conversations.endInactiveConversations(now);
  expect(await getPendingBookingIntent(input.conversationId, now)).toBeNull();
  expect(await conversations.loadTranscript(schoolId, input.conversationId)).toHaveLength(2);
  const { data } = await client()
    .from("conversations")
    .select("id, ended_at")
    .in("id", [input.conversationId, live.conversationId, web!.id])
    .throwOnError();
  expect(data?.find((row) => row.id === live.conversationId)?.ended_at).toBeNull();
  expect(data?.filter((row) => row.ended_at)).toHaveLength(2);
});

it("replays signed webhook through the real scripted worker entirely on public", async () => {
  const waId = randomUUID();
  const wamid = randomUUID();
  expect(
    (
      await POST(
        post(textInboundPayload({ phoneNumberId: phone, waId, wamid, text: "What classes?" })),
      )
    ).status,
  ).toBe(200);
  expect(await drainWhatsAppJobs(randomUUID(), 10, { phoneNumberIds: [phone] })).toMatchObject({
    done: 1,
    retrying: 0,
  });
  const { data: conversation } = await client()
    .from("conversations")
    .select("id")
    .eq("school_id", schoolId)
    .eq("wa_id_hash", hashWaId(waId))
    .single()
    .throwOnError();
  const history = await conversations.loadTranscript(schoolId, conversation!.id);
  expect(history.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(JSON.stringify(history)).toContain("Karate");
  const { data } = await client()
    .from("whatsapp_deliveries")
    .select("state, school_id")
    .eq("provider_idempotency_key", `wa-reply/${wamid}/0`)
    .single()
    .throwOnError();
  expect(data).toMatchObject({ school_id: schoolId, state: "sent" });
});

it.each(["booking_intent", "lead_request"] as const)(
  "worker commits a prepared %s without assistant-side writes",
  async (kind) => {
    const waId = randomUUID();
    const wamid = randomUUID();
    const mock = vi.spyOn(assistant, "completedReply").mockResolvedValueOnce({
      text: "Prepared reply",
      provenance: { modelId: "test-prepared", platformInstructionsHash: "test" },
      bookingIntent:
        kind === "booking_intent"
          ? { trialOfferingId: offeringId, slotId, participantName: "Guest", participantAge: 10 }
          : null,
      leadRequest:
        kind === "lead_request"
          ? {
              trialOfferingId: offeringId,
              participantName: "Guest",
              participantAge: 10,
              statedNeed: "Weekend please",
            }
          : null,
    });
    try {
      expect(
        (await POST(post(textInboundPayload({ phoneNumberId: phone, waId, wamid })))).status,
      ).toBe(200);
      expect(await drainWhatsAppJobs(randomUUID(), 10, { phoneNumberIds: [phone] })).toMatchObject({
        done: 1,
        retrying: 0,
      });
      const { data } = await client()
        .from("conversations")
        .select("id")
        .eq("school_id", schoolId)
        .eq("wa_id_hash", hashWaId(waId))
        .single()
        .throwOnError();
      expect(await conversations.loadTranscript(schoolId, data!.id)).toHaveLength(2);
      if (kind === "booking_intent") {
        expect(await getPendingBookingIntent(data!.id)).toMatchObject({
          offeringId,
          slotId,
          state: "pending",
        });
      } else {
        // Same public table and owner RLS used by the dashboard, not just an admin read.
        const leads = await sql.begin(async (tx) => {
          await tx`SELECT set_config('request.jwt.claim.sub', ${ownerId}, true)`;
          await tx`SET LOCAL ROLE authenticated`;
          return tx`SELECT participant_name, stated_need FROM public.leads WHERE school_id = ${schoolId} AND stated_need = ${"Weekend please"}`;
        });
        expect([...leads]).toEqual([{ participant_name: "Guest", stated_need: "Weekend please" }]);
      }
    } finally {
      mock.mockRestore();
    }
  },
);

it("message-limit termination and TTL maintenance expire pending choices", async () => {
  const input = await turn(bookingEffect());
  await commitWhatsAppTurn(input);
  await sql`INSERT INTO public.messages (conversation_id, message_id, role, parts)
    SELECT ${input.conversationId}::uuid, gen_random_uuid()::text, 'user', '[]'::jsonb FROM generate_series(1, 28)`;
  expect(
    await conversations.endConversationAtMessageLimit(
      schoolId,
      input.conversationId,
      input.generation,
      now,
    ),
  ).toBe(true);
  expect(await getPendingBookingIntent(input.conversationId, now)).toBeNull();
  const ttl = await turn(bookingEffect());
  await commitWhatsAppTurn(ttl);
  await conversations.endInactiveConversations(new Date(now.getTime() + 31 * 60_000));
  expect(await getPendingBookingIntent(ttl.conversationId, now)).toBeNull();
  const { data } = await client()
    .from("conversations")
    .select("ended_at")
    .eq("id", ttl.conversationId)
    .single()
    .throwOnError();
  expect(data?.ended_at).toBeNull();
});

it("expired confirmation notice and inbound marker commit together without an assistant message", async () => {
  const input = await turn({ kind: "expired_confirmation" });
  const result = requireRow(await commitWhatsAppTurn(input), "notice");
  expect(result.reply_message_id).toBeNull();
  expect(result.delivery_ids).toHaveLength(1);
  expect(
    (await conversations.loadTranscript(schoolId, input.conversationId)).map(
      (message) => message.role,
    ),
  ).toEqual(["user"]);
});

it("rejects mismatched prepared offering/window scope and rolls back inbound", async () => {
  const input = await turn({ ...bookingEffect(), trialOfferingId: randomUUID() });
  await expect(commitWhatsAppTurn(input)).rejects.toMatchObject({ message: "invalid_slot_scope" });
  expect(await conversations.loadTranscript(schoolId, input.conversationId)).toEqual([]);
});

it("all Turn/lifecycle functions are service-only invokers with empty search_path", async () => {
  const functions =
    await sql`SELECT oid::regprocedure::text AS signature, prosecdef, proconfig FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN ('commit_whatsapp_turn', 'resolve_whatsapp_conversation', 'end_inactive_conversations', 'expire_ended_conversation_intents')`;
  expect(functions).toHaveLength(4);
  for (const fn of functions) {
    expect(fn.prosecdef).toBe(false);
    expect(fn.proconfig).toContain('search_path=""');
    const [grants] =
      await sql`SELECT has_function_privilege('anon', ${fn.signature}, 'EXECUTE') AS anon,
      has_function_privilege('authenticated', ${fn.signature}, 'EXECUTE') AS owner,
      has_function_privilege('service_role', ${fn.signature}, 'EXECUTE') AS service`;
    expect(grants).toEqual({ anon: false, owner: false, service: true });
  }
});
