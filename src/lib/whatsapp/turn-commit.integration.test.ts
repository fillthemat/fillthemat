import { randomUUID } from "node:crypto";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import { getDb } from "@/db";
import {
  emailDeliveries,
  leads,
  trialWindows,
  whatsappBookingIntents,
  whatsappDeliveries,
  whatsappJobs,
} from "@/db/schema";
import * as languageModel from "@/lib/ai/language-model";
import {
  findOrCreateConversation,
  loadTranscript,
} from "@/lib/conversations/conversation-store";
import { listOpenSlots } from "@/lib/schedule/occurrences";
import {
  authSql,
  loadLocalEnv,
  whileSavingMessages,
} from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import {
  buttonReplyPayload,
  post,
  textInboundPayload,
} from "@/test/whatsapp-webhook";
import { scopedWhatsAppRunner } from "@/test/whatsapp-worker";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const phoneNumberId = `turn-commit-${randomUUID()}`;
const { drainWhatsAppJobs, runWhatsAppWorkerOnce } = scopedWhatsAppRunner(
  () => [phoneNumberId],
);
let schoolId: string;
let offeringId: string;
afterEach(() => vi.restoreAllMocks());

function modelCalling(toolName: string, input: Record<string, unknown>) {
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const isReply = prompt.at(-1)?.role === "tool";
      return {
        content: isReply
          ? [{ type: "text", text: "Thanks, Alex." }]
          : [
              {
                type: "tool-call",
                toolCallId: randomUUID(),
                toolName,
                input: JSON.stringify(input),
              },
            ],
        finishReason: {
          unified: isReply ? "stop" : "tool-calls",
          raw: undefined,
        },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  vi.spyOn(languageModel, "defaultLanguageModel").mockReturnValue(model);
}

async function whileFirstAssistantSaveFails(
  conversationId: string,
  work: () => Promise<void>,
) {
  const sequence = `test_turn_commit_${randomUUID().replaceAll("-", "")}`;
  await sql.unsafe(`create sequence public.${sequence}`);
  try {
    await whileSavingMessages(
      sql,
      {
        conversationId,
        role: "assistant",
        // Sequence increments survive rollback, so only the first save fails.
        statement: `if nextval('public.${sequence}') = 1 then raise exception 'test reply save failure'; end if`,
      },
      work,
    );
  } finally {
    await sql.unsafe(`drop sequence public.${sequence}`);
  }
}

async function whileEnqueueingReply(waId: string, work: () => Promise<void>) {
  const name = `test_turn_enqueue_${randomUUID().replaceAll("-", "")}`;
  await sql.unsafe(
    `create function public.${name}() returns trigger language plpgsql as $$ begin raise exception 'test enqueue failure'; end $$`,
  );
  await sql.unsafe(
    `create trigger ${name} before insert on app.whatsapp_deliveries for each row when (new.school_id = '${schoolId}' and new.recipient_wa_id = '${waId}' and new.provider_idempotency_key like 'wa-%') execute function public.${name}()`,
  );
  try {
    await work();
  } finally {
    await sql.unsafe(`drop trigger ${name} on app.whatsapp_deliveries`);
    await sql.unsafe(`drop function public.${name}()`);
  }
}

beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "Turn Commit School",
    slug: phoneNumberId,
    whatsappPhoneNumberId: phoneNumberId,
    offerings: [{ name: "Kids BJJ" }],
  });
  schoolId = seeded.schoolId;
  offeringId = seeded.offeringIds[0];
  await db.insert(trialWindows).values({
    schoolId,
    trialOfferingId: offeringId,
    dayOfWeek: 3,
    startMinute: 18 * 60,
    durationMinutes: 60,
    capacity: 8,
  });
});
afterAll(async () => {
  await db
    .delete(whatsappJobs)
    .where(eq(whatsappJobs.phoneNumberId, phoneNumberId));
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("WhatsApp Turn commit through webhook and worker", () => {
  it("retries a failed assistant save and answers the inbound message exactly once", async () => {
    const waId = "16505556901";
    const wamid = `wamid.commit.${randomUUID()}`;
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId },
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    const payload = textInboundPayload({
      phoneNumberId,
      waId,
      wamid,
      text: "What trials?",
    });
    expect((await POST(post(payload))).status).toBe(200);
    const send = vi.fn(async () => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: "outbound",
    }));
    await whileFirstAssistantSaveFails(
      conversation.conversation.id,
      async () => {
        await runWhatsAppWorkerOnce(randomUUID(), {
          transport: {
            sendText: send,
            sendTemplate: send,
            sendInteractive: send,
          },
        });
      },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await loadTranscript(conversation.conversation.id)).map(
        ({ role }) => role,
      ),
    ).toEqual(["user", "assistant"]);
    const [job] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    expect(job).toMatchObject({ state: "done", attempts: 2 });
    const deliveries = await db
      .select()
      .from(whatsappDeliveries)
      .where(eq(whatsappDeliveries.recipientWaId, waId));
    expect(deliveries).toMatchObject([
      { state: "sent", providerIdempotencyKey: `wa-reply/${wamid}/0` },
    ]);
    // Replayed webhook and another worker pass cannot send the committed reply twice.
    await POST(post(payload));
    await runWhatsAppWorkerOnce(randomUUID(), {
      transport: { sendText: send, sendTemplate: send, sendInteractive: send },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rolls back a Lead Request on reply-save failure and retries with one lead, owner email, and reply", async () => {
    modelCalling("request_contact", {
      participantName: "Alex",
      statedNeed: "Please contact me",
    });
    const waId = "16505556902";
    const wamid = `wamid.lead.${randomUUID()}`;
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId },
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    await POST(
      post(
        textInboundPayload({
          phoneNumberId,
          waId,
          wamid,
          text: "Please contact me",
        }),
      ),
    );
    const send = vi.fn(async () => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: "outbound-lead",
    }));
    await whileFirstAssistantSaveFails(
      conversation.conversation.id,
      async () => {
        await runWhatsAppWorkerOnce(randomUUID(), {
          transport: {
            sendText: send,
            sendTemplate: send,
            sendInteractive: send,
          },
        });
      },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await loadTranscript(conversation.conversation.id)).map(
        ({ role }) => role,
      ),
    ).toEqual(["user", "assistant"]);
    expect(
      await db.select().from(leads).where(eq(leads.schoolId, schoolId)),
    ).toMatchObject([{ participantName: "Alex" }]);
    expect(
      await db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.schoolId, schoolId)),
    ).toMatchObject([{ kind: "owner_lead", state: "sent", attempts: 1 }]);
    const [job] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    expect(job).toMatchObject({ state: "done", attempts: 2 });
  });

  it("rolls back a Booking Intent on reply-save failure and retries with one pending intent and confirmation reply", async () => {
    const now = new Date();
    const [window] = await db
      .select()
      .from(trialWindows)
      .where(eq(trialWindows.schoolId, schoolId));
    const [slot] = listOpenSlots({
      windows: [window],
      occurrences: [],
      offeringId,
      timezone: "America/New_York",
      now,
    });
    modelCalling("prepare_booking", {
      offeringId,
      slotId: slot.slotId,
      participantName: "Alex",
      participantAge: 8,
    });
    const waId = "16505556903";
    const wamid = `wamid.intent.${randomUUID()}`;
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId },
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    await POST(
      post(
        textInboundPayload({
          phoneNumberId,
          waId,
          wamid,
          text: "Book that time",
        }),
      ),
    );
    const send = vi.fn(async () => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: "outbound-intent",
    }));
    await whileFirstAssistantSaveFails(
      conversation.conversation.id,
      async () => {
        await runWhatsAppWorkerOnce(randomUUID(), {
          now: () => new Date(now.getTime() + 1000),
          transport: {
            sendText: send,
            sendTemplate: send,
            sendInteractive: send,
          },
        });
      },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await loadTranscript(conversation.conversation.id)).map(
        ({ role }) => role,
      ),
    ).toEqual(["user", "assistant"]);
    const intents = await db
      .select()
      .from(whatsappBookingIntents)
      .where(
        eq(whatsappBookingIntents.conversationId, conversation.conversation.id),
      );
    expect(intents).toMatchObject([
      { state: "pending", participantName: "Alex" },
    ]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: [
          { id: `confirm_booking:${intents[0].id}`, title: "Confirm booking" },
          { id: "choose_another_time", title: "Choose another time" },
        ],
      }),
    );
    expect(
      await db
        .select()
        .from(whatsappDeliveries)
        .where(eq(whatsappDeliveries.recipientWaId, waId)),
    ).toMatchObject([
      { state: "sent", providerIdempotencyKey: `wa-confirm/${wamid}` },
    ]);
    const [job] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    expect(job).toMatchObject({ state: "done", attempts: 2 });
  });

  it("retries an expired-confirmation notice after enqueue fails without leaving a saved unanswered message", async () => {
    const waId = "16505556904";
    const wamid = `wamid.notice.${randomUUID()}`;
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId },
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    const payload = buttonReplyPayload({
      phoneNumberId,
      waId,
      wamid,
      buttonId: `confirm_booking:${randomUUID()}`,
    });
    await POST(post(payload));
    const now = new Date();
    const send = vi.fn(async () => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: "outbound-notice",
    }));
    const transport = {
      sendText: send,
      sendTemplate: send,
      sendInteractive: send,
    };
    await whileEnqueueingReply(waId, async () => {
      expect(
        (
          await drainWhatsAppJobs(randomUUID(), 10, {
            now: () => now,
            transport,
          })
        ).retrying,
      ).toBe(1);
    });
    expect(await loadTranscript(conversation.conversation.id)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => new Date(now.getTime() + 10_000),
      transport,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "That booking option has expired or was replaced. Please ask for available times again.",
      }),
    );
    expect(
      await db
        .select()
        .from(whatsappDeliveries)
        .where(eq(whatsappDeliveries.recipientWaId, waId)),
    ).toMatchObject([
      { state: "sent", providerIdempotencyKey: `wa-notice/${waId}/${wamid}` },
    ]);
    expect(
      (await loadTranscript(conversation.conversation.id)).map(
        ({ role }) => role,
      ),
    ).toEqual(["user"]);
    await POST(post(payload));
    await runWhatsAppWorkerOnce(randomUUID(), { transport });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rolls back the transcript when delivery enqueue fails, then delivers every reply chunk once", async () => {
    const text = "A".repeat(5000);
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      },
    });
    vi.spyOn(languageModel, "defaultLanguageModel").mockReturnValue(model);
    const waId = "16505556905";
    const wamid = `wamid.enqueue.${randomUUID()}`;
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId },
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    await POST(
      post(
        textInboundPayload({
          phoneNumberId,
          waId,
          wamid,
          text: "Tell me more",
        }),
      ),
    );
    const now = new Date();
    const send = vi.fn(async () => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: "outbound-chunk",
    }));
    const transport = {
      sendText: send,
      sendTemplate: send,
      sendInteractive: send,
    };
    await whileEnqueueingReply(waId, async () => {
      expect(
        (
          await drainWhatsAppJobs(randomUUID(), 10, {
            now: () => now,
            transport,
          })
        ).retrying,
      ).toBe(1);
    });
    expect(await loadTranscript(conversation.conversation.id)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await runWhatsAppWorkerOnce(randomUUID(), {
      now: () => new Date(now.getTime() + 10_000),
      transport,
    });
    expect(send).toHaveBeenCalledTimes(2);
    const deliveries = await db
      .select()
      .from(whatsappDeliveries)
      .where(eq(whatsappDeliveries.recipientWaId, waId));
    expect(
      deliveries
        .map(({ providerIdempotencyKey }) => providerIdempotencyKey)
        .sort(),
    ).toEqual([`wa-reply/${wamid}/0`, `wa-reply/${wamid}/1`]);
    expect(deliveries.every(({ state }) => state === "sent")).toBe(true);
    expect(
      (await loadTranscript(conversation.conversation.id)).map(
        ({ role }) => role,
      ),
    ).toEqual(["user", "assistant"]);
  });

  it("exhausts five failed reply saves and sends the fallback instead of silently completing", async () => {
    const waId = "16505556906";
    const wamid = `wamid.exhaustion.${randomUUID()}`;
    const conversation = await findOrCreateConversation({
      schoolId,
      identity: { channel: "whatsapp", waId },
    });
    if (!conversation.ok) throw new Error(conversation.reason);
    await POST(
      post(
        textInboundPayload({
          phoneNumberId,
          waId,
          wamid,
          text: "What trials?",
        }),
      ),
    );
    const send = vi.fn(async () => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: "outbound-fallback",
    }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await whileSavingMessages(
      sql,
      {
        conversationId: conversation.conversation.id,
        role: "assistant",
        statement: "raise exception 'test persistent save failure'",
      },
      async () => {
        await runWhatsAppWorkerOnce(randomUUID(), {
          transport: {
            sendText: send,
            sendTemplate: send,
            sendInteractive: send,
          },
        });
      },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Sorry, we're having trouble replying right now. Please message us again in a bit.",
      }),
    );
    expect(await loadTranscript(conversation.conversation.id)).toEqual([]);
    const [job] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    expect(job).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("does not send again when completing the job fails after the reply was sent", async () => {
    const waId = "16505556907";
    const wamid = `wamid.sent.${randomUUID()}`;
    await POST(
      post(
        textInboundPayload({
          phoneNumberId,
          waId,
          wamid,
          text: "What trials?",
        }),
      ),
    );
    const send = vi.fn(async () => ({
      ok: true as const,
      kind: "accepted" as const,
      providerId: "outbound-sent",
    }));
    const name = `test_job_done_${randomUUID().replaceAll("-", "")}`;
    await sql.unsafe(`create sequence public.${name}`);
    await sql.unsafe(
      `create function public.${name}() returns trigger language plpgsql as $$ begin if nextval('public.${name}') = 1 then raise exception 'test job done failure'; end if; return new; end $$`,
    );
    await sql.unsafe(
      `create trigger ${name} before update on app.whatsapp_jobs for each row when (new.dedupe_key = '${wamid}' and new.state = 'done') execute function public.${name}()`,
    );
    try {
      await runWhatsAppWorkerOnce(randomUUID(), {
        transport: {
          sendText: send,
          sendTemplate: send,
          sendInteractive: send,
        },
      });
    } finally {
      await sql.unsafe(`drop trigger ${name} on app.whatsapp_jobs`);
      await sql.unsafe(`drop function public.${name}()`);
      await sql.unsafe(`drop sequence public.${name}`);
    }
    expect(send).toHaveBeenCalledTimes(1);
    const [job] = await db
      .select()
      .from(whatsappJobs)
      .where(eq(whatsappJobs.dedupeKey, wamid));
    expect(job).toMatchObject({ state: "done", attempts: 1 });
    expect(
      await db
        .select()
        .from(whatsappDeliveries)
        .where(eq(whatsappDeliveries.recipientWaId, waId)),
    ).toMatchObject([{ state: "sent", attempts: 1 }]);
  });
});
