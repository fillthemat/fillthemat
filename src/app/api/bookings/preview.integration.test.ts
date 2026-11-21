import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/types";
import { bookSlot } from "@/lib/schedule/book-slot";
import { listOpenSlots } from "@/lib/schedule/occurrences";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";
import { POST } from "./route";

// The real route, Book Trial function and outbox; only CAPTCHA is replaced.
// The cookie client is a real anonymous or signed-in client, so RLS decides access.
const request = vi.hoisted(() => ({ client: null as SupabaseClient<Database> | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => request.client }));
vi.mock("@/lib/security/turnstile", () => ({ verifyTurnstile: async () => true }));
vi.mock("server-only", () => ({}));

loadLocalEnv();
const sql = authSql();
const owners: string[] = [];
const clients: SupabaseClient<Database>[] = [];
type School = { id: string; slug: string; offeringId: string; ownerId: string };
let published: School;
let draft: School;
let anon: SupabaseClient<Database>;
let draftOwner: SupabaseClient<Database>;
let otherOwner: SupabaseClient<Database>;
let otherOwnerId = "";

function client() {
  const result = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  clients.push(result);
  return result;
}

async function school(label: string, publishedAt?: Date): Promise<School> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  const slug = `${label}-${ownerId}`;
  const seeded = await seedPublicSchool(sql, {
    ownerId,
    slug,
    name: label,
    publishedAt,
    offerings: [{ name: `${label} trial`, minimumAge: 5, maximumAge: 16 }],
  });
  const offeringId = requireRow(seeded.offeringIds[0], "offering");
  // One seat per weekly window: capacity applies to previews too.
  await sql`INSERT INTO public.trial_windows (school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity)
    SELECT ${seeded.schoolId}, ${offeringId}, day, 960, 60, 1 FROM generate_series(0, 6) AS day`;
  return { id: seeded.schoolId, slug, offeringId, ownerId };
}

async function signIn(ownerId: string, email: string) {
  const password = randomUUID();
  await sql`UPDATE auth.users SET encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf')) WHERE id = ${ownerId}`;
  const signedIn = client();
  const { error } = await signedIn.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return signedIn;
}

let slotIndex = 0;
async function nextSlot(target: School) {
  const windows = await sql`SELECT * FROM public.trial_windows WHERE school_id = ${target.id}`;
  const slots = listOpenSlots({
    offeringId: target.offeringId,
    timezone: "America/New_York",
    now: new Date(),
    occurrences: [],
    windows: windows.map((row) => ({
      id: row.id,
      trialOfferingId: row.trial_offering_id,
      dayOfWeek: row.day_of_week,
      startMinute: row.start_minute,
      durationMinutes: row.duration_minutes,
      capacity: row.capacity,
      active: row.active,
      label: row.label,
    })),
  });
  return requireRow(slots[slotIndex++], "open slot").slotId;
}

function body(target: School, slotId: string, extra: Record<string, unknown> = {}) {
  return {
    schoolSlug: target.slug,
    offeringId: target.offeringId,
    slotId,
    idempotencyKey: randomUUID(),
    contact: {
      name: "Parent",
      email: `${randomUUID()}@local.test`,
      phone: `555-${randomUUID().slice(0, 8)}`,
    },
    participant: { name: "Student", age: 10 },
    turnstileToken: "test-token",
    ...extra,
  };
}

async function post(as: SupabaseClient<Database>, payload: unknown) {
  request.client = as;
  const response = await POST(
    new Request("http://localhost/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return { status: response.status, json: await response.json() };
}

async function effects(bookingId: string) {
  const [booking] = await sql`SELECT * FROM public.bookings WHERE id = ${bookingId}`;
  const deliveries = await sql`SELECT kind, state FROM public.email_deliveries
    WHERE booking_id = ${bookingId} ORDER BY kind::text`;
  const events = await sql`SELECT metadata FROM public.funnel_events
    WHERE booking_id = ${bookingId} AND event_type = 'booking_confirmed'`;
  const [occurrence] = await sql`SELECT booked_count FROM public.trial_occurrences
    WHERE id = ${booking?.trial_occurrence_id ?? null}`;
  return { booking, deliveries, events, bookedCount: occurrence?.booked_count };
}

async function bookingCount(schoolId: string) {
  const [row] = await sql`SELECT
    (SELECT count(*)::int FROM public.bookings WHERE school_id = ${schoolId}) AS bookings,
    (SELECT count(*)::int FROM public.trial_occurrences WHERE school_id = ${schoolId}) AS occurrences,
    (SELECT count(*)::int FROM public.contacts WHERE school_id = ${schoolId}) AS contacts,
    (SELECT count(*)::int FROM public.email_deliveries WHERE school_id = ${schoolId}) AS emails`;
  return row;
}

beforeAll(async () => {
  published = await school("published", new Date());
  draft = await school("draft");
  const other = await school("other");
  otherOwnerId = other.ownerId;
  anon = client();
  draftOwner = await signIn(draft.ownerId, `${draft.slug}@local.test`);
  otherOwner = await signIn(other.ownerId, `${other.slug}@local.test`);
});

afterAll(async () => {
  for (const ownerId of owners) await deletePublicSchoolOwner(sql, ownerId);
  for (const supabase of clients) supabase.auth.stopAutoRefresh();
  await sql.end({ timeout: 5 });
});

describe("published school bookings", () => {
  it("books an anonymous family, sends both emails, and replays retries without new effects", async () => {
    const payload = body(published, await nextSlot(published));
    const first = await post(anon, payload);
    expect(first).toMatchObject({ status: 200, json: { idempotent: false, preview: false } });
    const saved = await effects(first.json.bookingId);
    expect(saved.booking?.is_preview).toBe(false);
    expect(saved.deliveries).toEqual([
      { kind: "owner_booking", state: "sent" },
      { kind: "prospect_confirmation", state: "sent" },
    ]);
    expect(saved.events.map((row) => row.metadata)).toEqual([{ source: "direct" }]);
    expect(saved.bookedCount).toBe(1);

    const before = await bookingCount(published.id);
    const retries = await Promise.all([post(anon, payload), post(anon, payload)]);
    for (const retry of retries)
      expect(retry).toMatchObject({
        status: 200,
        json: { bookingId: first.json.bookingId, idempotent: true },
      });
    expect(await bookingCount(published.id)).toEqual(before);
    expect((await effects(first.json.bookingId)).bookedCount).toBe(1);
  });

  it("treats a preview flag without verified ownership as an ordinary booking", async () => {
    for (const as of [anon, otherOwner]) {
      const result = await post(as, body(published, await nextSlot(published), { preview: true }));
      expect(result).toMatchObject({ status: 200, json: { preview: false } });
      expect((await effects(result.json.bookingId)).booking?.is_preview).toBe(false);
    }
  });
});

describe("unpublished school access", () => {
  it("never lets anonymous visitors or other owners book a draft, with or without preview", async () => {
    const slotId = await nextSlot(draft);
    for (const [as, preview] of [
      [anon, false],
      [anon, true],
      [otherOwner, true],
      [draftOwner, false],
    ] as const) {
      const result = await post(as, body(draft, slotId, { preview }));
      expect(result).toMatchObject({ status: 404, json: { error: "not_found" } });
    }
    expect(await bookingCount(draft.id)).toEqual({
      bookings: 0,
      occurrences: 0,
      contacts: 0,
      emails: 0,
    });
  });

  it("rechecks ownership in the database, not only in the route", async () => {
    const input = {
      school: { id: draft.id },
      offeringId: draft.offeringId,
      slotId: await nextSlot(draft),
      idempotencyKey: randomUUID(),
      contact: { name: "Parent", email: "direct@local.test", phone: "555-direct" },
      participant: { name: "Student", age: 10 },
    };
    expect(await bookSlot(input)).toEqual({ ok: false, code: "school_not_public" });
    expect(await bookSlot({ ...input, previewOwnerId: otherOwnerId })).toEqual({
      ok: false,
      code: "school_not_public",
    });
    expect(await bookSlot({ ...input, previewOwnerId: randomUUID() })).toEqual({
      ok: false,
      code: "school_not_public",
    });
    expect((await bookingCount(draft.id))?.bookings).toBe(0);
  });
});

describe("owner preview bookings", () => {
  it("books, labels and confirms the owner's preview, keeping it out of overview metrics", async () => {
    const slotId = await nextSlot(draft);
    const payload = body(draft, slotId, { preview: true });
    const first = await post(draftOwner, payload);
    expect(first).toMatchObject({ status: 200, json: { idempotent: false, preview: true } });
    const saved = await effects(first.json.bookingId);
    expect(saved.booking?.is_preview).toBe(true);
    expect(saved.deliveries).toEqual([
      { kind: "owner_booking", state: "sent" },
      { kind: "prospect_confirmation", state: "sent" },
    ]);
    expect(saved.events.map((row) => row.metadata)).toEqual([{ source: "direct", preview: true }]);
    expect(saved.bookedCount).toBe(1);

    // The dashboard reads the label through the owner's RLS.
    const { data: listed, error } = await draftOwner
      .from("bookings")
      .select("id, is_preview")
      .eq("school_id", draft.id);
    expect(error).toBeNull();
    expect(listed).toEqual([{ id: first.json.bookingId, is_preview: true }]);
    const { data: metrics, error: metricsError } = await draftOwner.rpc("get_overview_metrics", {
      p_school_id: draft.id,
    });
    expect(metricsError).toBeNull();
    expect(metrics?.[0]?.upcoming_bookings).toBe(0);

    // Capacity applies: the window's single seat is now taken.
    const full = await post(draftOwner, body(draft, slotId, { preview: true }));
    expect(full).toMatchObject({ status: 409, json: { error: "slot_unavailable" } });

    const before = await bookingCount(draft.id);
    const retries = await Promise.all([post(draftOwner, payload), post(draftOwner, payload)]);
    for (const retry of retries)
      expect(retry).toMatchObject({
        status: 200,
        json: { bookingId: first.json.bookingId, idempotent: true, preview: true },
      });
    expect(await bookingCount(draft.id)).toEqual(before);
  });

  it("counts a preview of a published school as the owner's own test, not demand", async () => {
    const publishedOwner = await signIn(published.ownerId, `${published.slug}@local.test`);
    const result = await post(
      publishedOwner,
      body(published, await nextSlot(published), { preview: true }),
    );
    expect(result).toMatchObject({ status: 200, json: { preview: true } });
    const { data: metrics } = await publishedOwner.rpc("get_overview_metrics", {
      p_school_id: published.id,
    });
    const [live] = await sql`SELECT count(*)::int AS count FROM public.bookings
      WHERE school_id = ${published.id} AND status = 'booked' AND NOT is_preview AND start_at >= now()`;
    expect(metrics?.[0]?.upcoming_bookings).toBe(live?.count);
  });
});
