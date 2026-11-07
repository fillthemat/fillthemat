import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";
import { bookSlot, type BookSlotInput, findBookingByIdempotencyKey } from "./book-slot";
import { listOpenSlots } from "./occurrences";

vi.mock("server-only", () => ({}));
loadLocalEnv();
const sql = authSql();
const ownerId = randomUUID();
const now = new Date();
let schoolId = "";
let offeringId = "";
let slotId = "";
let input: BookSlotInput;

beforeAll(async () => {
  const school = await seedPublicSchool(sql, {
    ownerId,
    slug: `book-${ownerId}`,
    name: "Book trial",
    publishedAt: now,
    offerings: [{ name: "Trial", minimumAge: 5, maximumAge: 16 }],
  });
  schoolId = school.schoolId;
  offeringId = school.offeringIds[0]!;
  const window = requireRow(
    (
      await sql`INSERT INTO public.trial_windows
    (school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity)
    VALUES (${schoolId}, ${offeringId}, 2, 960, 60, 1) RETURNING id`
    )[0],
    "window",
  );
  slotId = requireRow(
    listOpenSlots({
      offeringId,
      timezone: "America/New_York",
      now,
      occurrences: [],
      windows: [
        {
          id: window.id,
          trialOfferingId: offeringId,
          dayOfWeek: 2,
          startMinute: 960,
          durationMinutes: 60,
          capacity: 1,
          active: true,
          label: null,
        },
      ],
    })[0],
    "slot",
  ).slotId;
  input = {
    school: {
      id: schoolId,
      approvedAt: now,
      publishedAt: now,
      timezone: "America/New_York",
      address: null,
      city: null,
      country: "US",
      accessNotes: null,
      parkingNotes: null,
      trialGuidance: null,
    },
    offeringId,
    slotId,
    idempotencyKey: randomUUID(),
    contact: { name: " Parent ", email: " PARENT@local.test ", phone: "555-250" },
    participant: { name: " Student ", age: 10 },
    now,
  };
});
afterAll(async () => {
  await deletePublicSchoolOwner(sql, ownerId);
  await sql.end();
});

it("serializes last-seat bookings, replays the original, and queues each effect once", async () => {
  const results = await Promise.all([
    bookSlot(input),
    bookSlot({
      ...input,
      idempotencyKey: randomUUID(),
      contact: { name: "Other", email: "other@local.test", phone: "555-other" },
    }),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, code: "slot_unavailable" }]);
  const winner = results.find((result) => result.ok);
  if (!winner?.ok) throw new Error("missing winner");
  const replay = await bookSlot({
    ...input,
    idempotencyKey: winner.booking.idempotencyKey,
    offeringId: randomUUID(),
    participant: { name: "Changed", age: 99 },
  });
  expect(replay).toEqual({ ...winner, idempotent: true });
  expect(await findBookingByIdempotencyKey(schoolId, winner.booking.idempotencyKey)).toEqual(
    winner.booking,
  );
  const [occurrence] =
    await sql`SELECT booked_count FROM public.trial_occurrences WHERE school_id = ${schoolId}`;
  expect(occurrence?.booked_count).toBe(1);
  const deliveries =
    await sql`SELECT kind FROM public.email_deliveries WHERE booking_id = ${winner.booking.id} ORDER BY kind::text`;
  expect(deliveries.map((row) => row.kind)).toEqual(["owner_booking", "prospect_confirmation"]);
  expect(
    (await sql`SELECT id FROM public.funnel_events WHERE booking_id = ${winner.booking.id}`).length,
  ).toBe(1);
});

it("links web chat, serializes concurrent replays, and rolls back duplicate participants", async () => {
  const token = randomUUID();
  const conversation = requireRow(
    (
      await sql`INSERT INTO public.conversations (school_id, resume_token_hash, expires_at)
    VALUES (${schoolId}, ${hashToken(token)}, now() + interval '30 days') RETURNING id`
    )[0],
    "conversation",
  );
  const landing = requireRow(
    (
      await sql`INSERT INTO public.landing_sessions (school_id, session_key_hash)
    VALUES (${schoolId}, ${hashToken(token)}) RETURNING id`
    )[0],
    "landing",
  );
  // A different start has its own capacity; use next week's same window.
  // Resolve the other generated slot without depending on the slot encoding.
  const window = requireRow(
    (await sql`SELECT * FROM public.trial_windows WHERE school_id = ${schoolId}`)[0],
    "window",
  );
  await sql`UPDATE public.trial_windows SET capacity = 2 WHERE id = ${window.id}`;
  const slots = listOpenSlots({
    offeringId,
    timezone: input.school.timezone,
    now,
    occurrences: [],
    windows: [
      {
        id: window.id,
        trialOfferingId: offeringId,
        dayOfWeek: 2,
        startMinute: 960,
        durationMinutes: 60,
        capacity: 1,
        active: true,
        label: null,
      },
    ],
  });
  const chatInput = {
    ...input,
    slotId: requireRow(slots[1], "second slot").slotId,
    idempotencyKey: randomUUID(),
    contact: { name: "Chat", email: null, phone: "555-chat" },
    conversationResumeToken: token,
    landingSessionToken: token,
  };
  const results = await Promise.all([bookSlot(chatInput), bookSlot(chatInput)]);
  expect(results.filter((result) => result.ok && !result.idempotent)).toHaveLength(1);
  expect(results.filter((result) => result.ok && result.idempotent)).toHaveLength(1);
  const result = results[0]!;
  if (!result.ok) throw new Error(result.code);
  expect(result.booking.conversationId).toBe(conversation.id);
  expect(result.booking.landingSessionId).toBe(landing.id);
  expect(result.booking.contactEmailSnapshot).toBeNull();
  expect(result.booking.contactPhoneSnapshot).toBe("555-chat");
  expect(result.booking.participantNameSnapshot).toBe("Student");
  expect(result.booking.icsUid).toBe(`${result.booking.id}@fillthemat.com`);
  const [linked] =
    await sql`SELECT contact_id FROM public.conversations WHERE id = ${conversation.id}`;
  expect(linked?.contact_id).toBe(result.booking.contactId);
  expect(
    (
      await sql`SELECT kind FROM public.email_deliveries WHERE booking_id = ${result.booking.id}`
    ).map((row) => row.kind),
  ).toEqual(["owner_booking"]);
  expect(
    await bookSlot({
      ...chatInput,
      idempotencyKey: randomUUID(),
      contact: {
        ...chatInput.contact,
        name: "Must roll back",
      },
    }),
  ).toEqual({ ok: false, code: "already_booked" });
  const [contact] =
    await sql`SELECT name FROM public.contacts WHERE id = ${result.booking.contactId}`;
  expect(contact?.name).toBe("Chat");
  const [occurrence] =
    await sql`SELECT booked_count FROM public.trial_occurrences WHERE id = ${result.booking.trialOccurrenceId}`;
  expect(occurrence?.booked_count).toBe(1);
});

it("preserves expected validation failure codes without side effects", async () => {
  expect(await bookSlot({ ...input, slotId: "invalid" })).toEqual({
    ok: false,
    code: "invalid_slot",
  });
  expect(
    await bookSlot({
      ...input,
      idempotencyKey: randomUUID(),
      participant: { name: "Too old", age: 17 },
    }),
  ).toEqual({ ok: false, code: "ineligible" });
  expect(await bookSlot({ ...input, school: { ...input.school, id: randomUUID() } })).toEqual({
    ok: false,
    code: "school_not_public",
  });
});

it("is invoker, empty-search-path, and executable only by the service role", async () => {
  const [routine] = await sql`SELECT prosecdef, proconfig, oid::text AS oid FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'book_trial'`;
  expect(routine?.prosecdef).toBe(false);
  expect(routine?.proconfig).toEqual(['search_path=""']);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const [grant] =
      await sql`SELECT has_function_privilege(${role}, ${routine!.oid}::oid, 'EXECUTE') AS allowed`;
    expect(grant?.allowed).toBe(role === "service_role");
  }
  // Exercise RPC with the real service key, not only postgres fixture writes.
  const { error } = await createAdminClient().rpc("book_trial", {
    p_school_id: schoolId,
    p_offering_id: offeringId,
    p_window_id: randomUUID(),
    p_start_at: now.toISOString(),
    p_idempotency_key: randomUUID(),
    p_contact_name: "Test",
    p_email: "",
    p_phone: "555",
    p_participant_name: "Test",
    p_participant_age: 10,
  });
  expect(error?.message).toBe("invalid_slot");
});
