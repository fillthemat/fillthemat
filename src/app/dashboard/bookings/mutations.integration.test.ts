import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/db/types";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";

loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) {
  throw new Error("Booking mutation tests require a local database");
}
const sql = authSql();
const owners: string[] = [];
let client: SupabaseClient<Database>;
let foreignClient: SupabaseClient<Database>;
let school = "";
let offering = "";
let window = "";
let sequence = 0;

async function account() {
  const user = randomUUID();
  owners.push(user);
  const email = `${user}@local.test`;
  const password = randomUUID();
  await insertAuthUser(sql, user, email);
  await sql`UPDATE auth.users SET encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf')) WHERE id = ${user}`;
  await sql`INSERT INTO public.users (id, email) VALUES (${user}, ${email})`;
  const row = requireRow(
    (
      await sql`INSERT INTO public.schools (slug, timezone) VALUES (${user}, 'UTC') RETURNING id`
    )[0],
    "school",
  );
  await sql`INSERT INTO public.school_settings (school_id, owner_user_id, notification_email) VALUES (${row.id}, ${user}, ${email})`;
  await sql`INSERT INTO public.school_profiles (school_id, name) VALUES (${row.id}, 'Booking tests')`;
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client: supabase, school: row.id as string };
}

async function booking() {
  const id = randomUUID();
  const contact = requireRow(
    (
      await sql`
    INSERT INTO public.contacts (school_id, name, email, phone)
    VALUES (${school}, 'Test contact', ${`${id}@local.test`}, ${id}) RETURNING id
  `
    )[0],
    "contact",
  );
  const participant = requireRow(
    (
      await sql`
    INSERT INTO public.participants (school_id, contact_id, name, normalized_name)
    VALUES (${school}, ${contact.id}, 'Test participant', 'test participant') RETURNING id
  `
    )[0],
    "participant",
  );
  const start = new Date(Date.now() + 86_400_000 + ++sequence * 60_000);
  const end = new Date(start.getTime() + 3_600_000);
  const occurrence = requireRow(
    (
      await sql`
    INSERT INTO public.trial_occurrences (school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity, booked_count)
    VALUES (${school}, ${window}, ${offering}, ${start}, ${end}, 5, 1) RETURNING id
  `
    )[0],
    "occurrence",
  );
  await sql`
    INSERT INTO public.bookings (
      id, school_id, contact_id, participant_id, trial_offering_id, trial_window_id, trial_occurrence_id,
      idempotency_key, participant_name_snapshot, participant_age_snapshot, offering_name_snapshot,
      timezone_snapshot, start_at, end_at, contact_email_snapshot, contact_name_snapshot, contact_phone_snapshot, ics_uid
    ) VALUES (
      ${id}, ${school}, ${contact.id}, ${participant.id}, ${offering}, ${window}, ${occurrence.id},
      ${id}, 'Test participant', 10, 'Trial', 'UTC', ${start}, ${end},
      ${`${id}@local.test`}, 'Test contact', ${id}, ${id}
    )
  `;
  return { id, occurrence: occurrence.id as string };
}

async function state(id: string) {
  return requireRow(
    (await sql`SELECT status, ics_sequence, cancelled_at FROM public.bookings WHERE id = ${id}`)[0],
    "booking",
  );
}

beforeAll(async () => {
  const own = await account();
  client = own.client;
  school = own.school;
  foreignClient = (await account()).client;
  offering = requireRow(
    (
      await sql`INSERT INTO public.trial_offerings (school_id, name) VALUES (${school}, 'Trial') RETURNING id`
    )[0],
    "offering",
  ).id as string;
  window = requireRow(
    (
      await sql`
    INSERT INTO public.trial_windows (school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity)
    VALUES (${school}, ${offering}, 1, 600, 60, 5) RETURNING id
  `
    )[0],
    "window",
  ).id as string;
});

afterAll(async () => {
  for (const owner of owners) await deleteAuthUser(sql, owner);
  client?.auth.stopAutoRefresh();
  foreignClient?.auth.stopAutoRefresh();
  await sql.end({ timeout: 5 });
});

describe("invoker booking mutations", () => {
  it("cancels once under concurrent RPCs, releasing capacity and queuing notifications atomically", async () => {
    const created = await booking();
    const results = await Promise.all([
      client.rpc("cancel_dashboard_booking", { p_booking_id: created.id }),
      client.rpc("cancel_dashboard_booking", { p_booking_id: created.id }),
    ]);
    expect(results.map((result) => result.error)).toEqual([null, null]);
    expect(results.map((result) => result.data).sort()).toEqual(["cancelled", "replay"]);
    expect(await state(created.id)).toMatchObject({ status: "cancelled", ics_sequence: 1 });
    expect((await state(created.id)).cancelled_at).not.toBeNull();
    expect(
      (
        await sql`SELECT booked_count FROM public.trial_occurrences WHERE id = ${created.occurrence}`
      )[0]?.booked_count,
    ).toBe(0);
    expect(
      await sql`SELECT id FROM public.email_deliveries WHERE booking_id = ${created.id}`,
    ).toHaveLength(2);
    expect(
      await sql`SELECT id FROM public.funnel_events WHERE booking_id = ${created.id} AND event_type = 'booking_cancelled'`,
    ).toHaveLength(1);
  });

  it("applies the same cancellation invariants to direct status updates and rejects rebooking", async () => {
    const created = await booking();
    expect(
      (await client.from("bookings").update({ status: "cancelled" }).eq("id", created.id)).error,
    ).toBeNull();
    expect(await state(created.id)).toMatchObject({ status: "cancelled", ics_sequence: 1 });
    expect(
      await sql`SELECT id FROM public.email_deliveries WHERE booking_id = ${created.id}`,
    ).toHaveLength(2);
    expect(
      (await client.from("bookings").update({ status: "booked" }).eq("id", created.id)).error?.code,
    ).toBe("22023");
    expect(
      (await client.from("bookings").update({ ics_sequence: 50 }).eq("id", created.id)).error?.code,
    ).toBe("42501");
  });

  it("records valid attendance changes but never lets another owner mutate bookings", async () => {
    const created = await booking();
    expect(
      (
        await foreignClient.rpc("update_booking_attendance", {
          p_booking_id: created.id,
          p_status: "showed",
        })
      ).data,
    ).toBe(false);
    expect(
      (await foreignClient.rpc("cancel_dashboard_booking", { p_booking_id: created.id })).data,
    ).toBe("not_found");
    const foreign = await foreignClient
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", created.id)
      .select();
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
    for (const status of ["showed", "no_show"]) {
      const result = await client.rpc("update_booking_attendance", {
        p_booking_id: created.id,
        p_status: status,
      });
      expect(result.error).toBeNull();
      expect(result.data).toBe(true);
    }
    expect(
      await sql`SELECT id FROM public.funnel_events WHERE booking_id = ${created.id}`,
    ).toHaveLength(2);
    expect((await client.rpc("cancel_dashboard_booking", { p_booking_id: created.id })).data).toBe(
      "not_cancellable",
    );
    expect(
      (
        await client.rpc("update_booking_attendance", {
          p_booking_id: created.id,
          p_status: "booked",
        })
      ).error?.code,
    ).toBe("22023");
  });

  it("does not allow direct event/outbox inserts or counter edits through the Data API", async () => {
    const created = await booking();
    expect(
      (
        await client.from("email_deliveries").insert({
          school_id: school,
          booking_id: created.id,
          kind: "owner_cancellation",
          recipient: "forged@local.test",
          provider_idempotency_key: randomUUID(),
        })
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await client
          .from("funnel_events")
          .insert({ school_id: school, booking_id: created.id, event_type: "forged" })
      ).error?.code,
    ).toBe("42501");
    const counter = await client
      .from("trial_occurrences")
      .update({ booked_count: 0 })
      .eq("id", created.occurrence)
      .select();
    expect(counter.error).toBeNull();
    expect(counter.data).toEqual([]);
    expect(
      (
        await sql`SELECT booked_count FROM public.trial_occurrences WHERE id = ${created.occurrence}`
      )[0]?.booked_count,
    ).toBe(1);
  });

  it("rolls the entire cancellation back if notification enqueueing fails", async () => {
    const created = await booking();
    const name = `test_cancel_${randomUUID().replaceAll("-", "")}`;
    await sql.unsafe(
      `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN RAISE EXCEPTION 'test_enqueue_failure'; END; $$`,
    );
    await sql.unsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON public.email_deliveries FOR EACH ROW WHEN (NEW.booking_id = '${created.id}') EXECUTE FUNCTION public.${name}()`,
    );
    try {
      const result = await client.rpc("cancel_dashboard_booking", { p_booking_id: created.id });
      expect(result.error?.message).toBe("test_enqueue_failure");
      expect(await state(created.id)).toMatchObject({
        status: "booked",
        ics_sequence: 0,
        cancelled_at: null,
      });
      expect(
        (
          await sql`SELECT booked_count FROM public.trial_occurrences WHERE id = ${created.occurrence}`
        )[0]?.booked_count,
      ).toBe(1);
      expect(
        await sql`SELECT id FROM public.email_deliveries WHERE booking_id = ${created.id}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT id FROM public.funnel_events WHERE booking_id = ${created.id}`,
      ).toHaveLength(0);
    } finally {
      await sql.unsafe(`DROP TRIGGER ${name} ON public.email_deliveries`);
      await sql.unsafe(`DROP FUNCTION public.${name}()`);
    }
  });
});
