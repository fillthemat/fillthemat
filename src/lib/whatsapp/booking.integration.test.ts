import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { claimGeneration, findOrCreateConversation } from "@/lib/conversations/conversation-store";
import { encodeSlotId } from "@/lib/schedule/slot-id";
import { authSql, loadLocalEnv, requireRow, whileSavingMessages } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";
import { confirmWhatsAppBooking } from "./booking";

vi.mock("server-only", () => ({}));
loadLocalEnv();
const sql = authSql();
const ownerId = randomUUID();
const phone = randomUUID();
const now = new Date();
const start = new Date(now.getTime() + 3 * 86400_000);
start.setUTCHours(10, 0, 0, 0);
let schoolId: string;
let offeringId: string;
let windowId: string;

beforeAll(async () => {
  const school = await seedPublicSchool(sql, {
    ownerId,
    slug: ownerId,
    name: "Confirmation school",
    offerings: [{ name: "Karate" }],
  });
  schoolId = school.schoolId;
  offeringId = requireRow(school.offeringIds[0], "offering");
  const [window] = await sql`INSERT INTO public.trial_windows
    (school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity)
    VALUES (${schoolId}, ${offeringId}, ${start.getUTCDay()}, 600, 60, 50) RETURNING id`;
  windowId = requireRow(window, "window").id;
  await sql`UPDATE public.schools SET timezone = 'UTC', published_at = ${now} WHERE id = ${schoolId}`;
  await sql`UPDATE public.school_settings SET whatsapp_phone_number_id = ${phone} WHERE school_id = ${schoolId}`;
});
afterAll(async () => {
  await deletePublicSchoolOwner(sql, ownerId);
  await sql.end();
});

async function confirmation() {
  const waId = randomUUID();
  const conversation = await findOrCreateConversation({
    schoolId,
    identity: { channel: "whatsapp", waId },
    now,
  });
  const lock = requireRow(await claimGeneration(schoolId, conversation.id, { now }), "generation");
  const [intent] = await sql`INSERT INTO public.whatsapp_booking_intents
    (school_id, conversation_id, offering_id, slot_id, participant_name, participant_age, expires_at)
    VALUES (${schoolId}, ${conversation.id}, ${offeringId}, ${encodeSlotId(windowId, start)}, 'Sam', 10,
      ${new Date(now.getTime() + 1800_000)}) RETURNING id`;
  return {
    schoolId,
    conversationId: conversation.id,
    generation: lock.generation,
    intentId: requireRow(intent, "intent").id as string,
    waId,
    phoneNumberId: phone,
    wamid: randomUUID(),
    inboundMessageId: randomUUID(),
    inboundText: "yes",
    profileName: null,
    now,
  };
}

it("atomically books, confirms, links, orders messages and queues confirmation + owner email; replay writes nothing", async () => {
  const input = await confirmation();
  const result = await confirmWhatsAppBooking(input);
  expect(result).toMatchObject({ already_committed: false, outcome: "booked" });
  expect(result.reply_text).toContain("Booked! Sam's trial for Karate");
  const [booking] = await sql`SELECT * FROM public.bookings WHERE id = ${result.booking_id}`;
  expect(booking?.conversation_id).toBe(input.conversationId);
  const [intent] =
    await sql`SELECT state FROM public.whatsapp_booking_intents WHERE id = ${input.intentId}`;
  expect(intent?.state).toBe("confirmed");
  const messages =
    await sql`SELECT role, created_at FROM public.messages WHERE conversation_id = ${input.conversationId} ORDER BY created_at`;
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(messages[0]!.created_at.getTime()).toBeLessThanOrEqual(messages[1]!.created_at.getTime());
  const deliveries =
    await sql`SELECT * FROM public.whatsapp_deliveries WHERE booking_id = ${result.booking_id}`;
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.template_name).toBe("booking_confirmation");
  const emails =
    await sql`SELECT * FROM public.email_deliveries WHERE booking_id = ${result.booking_id}`;
  expect(emails).toHaveLength(1);
  expect(emails[0]?.kind).toBe("owner_booking");
  const replay = await confirmWhatsAppBooking(input);
  expect(replay).toMatchObject({ already_committed: true, delivery_ids: [] });
  expect(
    await sql`SELECT id FROM public.bookings WHERE conversation_id = ${input.conversationId}`,
  ).toHaveLength(1);
});

it.each(["expired", "superseded", "confirmed"])(
  "%s intent yields existing notice and no booking",
  async (state) => {
    const input = await confirmation();
    if (state === "expired")
      await sql`UPDATE public.whatsapp_booking_intents SET expires_at = ${new Date(now.getTime() - 1)} WHERE id = ${input.intentId}`;
    else
      await sql`UPDATE public.whatsapp_booking_intents SET state = ${state} WHERE id = ${input.intentId}`;
    const result = await confirmWhatsAppBooking(input);
    expect(result.outcome).toBe("expired");
    expect(result.reply_text).toContain("expired or was replaced");
    expect(
      await sql`SELECT id FROM public.bookings WHERE conversation_id = ${input.conversationId}`,
    ).toHaveLength(0);
  },
);

it("assistant append failure rolls back booking, intent, inbound, counters, emails and reply", async () => {
  const input = await confirmation();
  const before =
    await sql`SELECT booked_count FROM public.trial_occurrences WHERE trial_window_id = ${windowId}`;
  await whileSavingMessages(
    sql,
    {
      conversationId: input.conversationId,
      role: "assistant",
      statement: "raise exception 'injected_crash'",
    },
    async () => {
      await expect(confirmWhatsAppBooking(input)).rejects.toMatchObject({
        message: "injected_crash",
      });
    },
  );
  const [intent] =
    await sql`SELECT state FROM public.whatsapp_booking_intents WHERE id = ${input.intentId}`;
  expect(intent?.state).toBe("pending");
  expect(
    await sql`SELECT id FROM public.messages WHERE conversation_id = ${input.conversationId}`,
  ).toHaveLength(0);
  expect(
    await sql`SELECT id FROM public.bookings WHERE conversation_id = ${input.conversationId}`,
  ).toHaveLength(0);
  expect(
    await sql`SELECT booked_count FROM public.trial_occurrences WHERE trial_window_id = ${windowId}`,
  ).toEqual(before);
  expect((await confirmWhatsAppBooking(input)).outcome).toBe("booked");
});

it("full slot returns the existing response without confirming or booking", async () => {
  const input = await confirmation();
  await sql`UPDATE public.trial_occurrences SET capacity = booked_count WHERE trial_window_id = ${windowId}`;
  try {
    const result = await confirmWhatsAppBooking(input);
    expect(result.outcome).toBe("slot_unavailable");
    expect(result.reply_text).toBe("That time is no longer open — please pick another time.");
    expect(
      await sql`SELECT id FROM public.bookings WHERE conversation_id = ${input.conversationId}`,
    ).toHaveLength(0);
  } finally {
    await sql`UPDATE public.trial_occurrences SET capacity = 50 WHERE trial_window_id = ${windowId}`;
  }
});

it("rejects stale generations and mismatched recipient scope before writes", async () => {
  const input = await confirmation();
  for (const changed of [
    { generation: new Date(0).toISOString() },
    { waId: randomUUID() },
    { phoneNumberId: randomUUID() },
  ]) {
    await expect(confirmWhatsAppBooking({ ...input, ...changed })).rejects.toMatchObject({
      message: "generation_or_scope_lost",
    });
  }
  expect(
    await sql`SELECT id FROM public.messages WHERE conversation_id = ${input.conversationId}`,
  ).toHaveLength(0);
});

it("only service_role can execute the invoker with an empty search path", async () => {
  const [fn] = await sql`SELECT p.prosecdef, p.proconfig,
    has_function_privilege('service_role', p.oid, 'EXECUTE') service,
    has_function_privilege('anon', p.oid, 'EXECUTE') anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_whatsapp_booking'`;
  expect(fn).toMatchObject({ prosecdef: false, service: true, anon: false, authenticated: false });
  expect(fn?.proconfig).toEqual(['search_path=""']);
});

it("uses public school IDs for the six-booking recipient quota", async () => {
  const input = await confirmation();
  for (let i = 0; i < 6; i++) {
    // Different participants allow six bookings in the same occurrence.
    await sql`UPDATE public.whatsapp_booking_intents SET state = 'pending', participant_name = ${`Child ${i}`} WHERE id = ${input.intentId}`;
    const result = await confirmWhatsAppBooking({
      ...input,
      wamid: randomUUID(),
      inboundMessageId: randomUUID(),
    });
    expect(result.outcome).toBe("booked");
  }
  await sql`UPDATE public.whatsapp_booking_intents SET state = 'pending' WHERE id = ${input.intentId}`;
  const result = await confirmWhatsAppBooking(input);
  expect(result.outcome).toBe("rate_limited");
  expect(result.reply_text).toContain("daily booking limit");
  expect(
    await sql`SELECT id FROM public.bookings WHERE school_id = ${schoolId} AND contact_phone_snapshot = ${input.waId}`,
  ).toHaveLength(6);
});
