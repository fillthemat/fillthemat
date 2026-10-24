import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "@/db/types";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import {
  insertFaq,
  insertOffering,
  MISSING_FAQ,
  MISSING_OFFERING,
  setOfferingActive,
  STALE_EDIT,
  updateFaq,
  updateOffering,
} from "./mutations";

loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) {
  throw new Error("Settings tests require a local database");
}
const sql = authSql();
const owners = [randomUUID(), randomUUID()];
let client: SupabaseClient<Database>;
let foreignClient: SupabaseClient<Database>;
let school = "";
let foreignSchool = "";
let offeringId = "";
let windowId = "";
const input = {
  name: "Kids trial",
  description: "Basics",
  minimumAge: 5,
  maximumAge: 12,
  attire: "Gi",
  expectations: "Warm-up",
};

async function ownerClient(owner: string) {
  const email = `${owner}@local.test`;
  const password = randomUUID();
  await insertAuthUser(sql, owner, email);
  await sql`update auth.users set encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf')) where id = ${owner}`;
  await sql`insert into public.users (id, email) values (${owner}, ${email})`;
  const [row] =
    await sql`insert into public.schools (owner_user_id, slug, timezone) values (${owner}, ${owner}, 'UTC') returning id`;
  const id = requireRow(row, "school").id as string;
  await sql`insert into public.school_settings (school_id, name, notification_email) values (${id}, 'Test school', ${email})`;
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client: supabase, school: id };
}

beforeAll(async () => {
  const a = await ownerClient(requireRow(owners[0], "owner"));
  const b = await ownerClient(requireRow(owners[1], "foreign owner"));
  client = a.client;
  school = a.school;
  foreignClient = b.client;
  foreignSchool = b.school;
  const created = await insertOffering(client, school, {
    ...input,
    waiverNotes: "Preserve waiver",
  });
  offeringId = requireRow(created.values?.id, "offering");
  const { data, error } = await client
    .from("trial_windows")
    .insert({
      school_id: school,
      trial_offering_id: offeringId,
      day_of_week: 1,
      start_minute: 600,
      duration_minutes: 60,
      capacity: 8,
    })
    .select()
    .single();
  if (error) throw error;
  windowId = data.id;
});

afterAll(async () => {
  for (const owner of owners) await deleteAuthUser(sql, owner);
  await sql.end({ timeout: 5 });
});

it("edits offerings in place, preserving hidden fields and schedule links", async () => {
  const before = requireRow(
    (await client.from("trial_offerings").select().eq("id", offeringId).single()).data,
    "offering",
  );
  const result = await updateOffering(client, school, offeringId, before.updated_at, {
    ...input,
    name: "Kids intro",
  });
  expect(result.status).toBe("success");
  expect(result.values?.id).toBe(offeringId);
  const { data } = await client.from("trial_offerings").select().eq("id", offeringId).single();
  expect(data).toMatchObject({ name: "Kids intro", waiver_notes: "Preserve waiver", active: true });
  expect(
    (await client.from("trial_windows").select("trial_offering_id").eq("id", windowId).single())
      .data?.trial_offering_id,
  ).toBe(offeringId);
});

it("rejects another school's offering without exposing it", async () => {
  const foreign = await insertOffering(foreignClient, foreignSchool, input);
  const id = requireRow(foreign.values?.id, "foreign offering");
  const result = await updateOffering(
    client,
    school,
    id,
    requireRow(foreign.values?.updatedAt, "timestamp"),
    { ...input, name: "Hijack" },
  );
  expect(result.message).toBe(MISSING_OFFERING);
  expect((await client.from("trial_offerings").select().eq("id", id)).data).toEqual([]);
});

it("rejects stale edits using the original database timestamp", async () => {
  const result = await updateOffering(client, school, offeringId, "2000-01-01T00:00:00Z", {
    ...input,
    name: "Should not land",
  });
  expect(result.message).toBe(STALE_EDIT);
  expect(
    (await client.from("trial_offerings").select("name").eq("id", offeringId).single()).data?.name,
  ).not.toBe("Should not land");
});

it("uses the desired offering state and handles repeated submissions", async () => {
  expect((await setOfferingActive(client, school, offeringId, false)).status).toBe("success");
  expect((await setOfferingActive(client, school, offeringId, false)).values?.unchanged).toBe(
    "true",
  );
  expect((await setOfferingActive(client, school, offeringId, true)).status).toBe("success");
});

it("enforces the FAQ limit while allowing edits without reordering", async () => {
  for (let i = 0; i < 20; i++)
    expect(
      (await insertFaq(client, school, { question: `Question ${i}?`, answer: "Answer" })).status,
    ).toBe("success");
  expect((await insertFaq(client, school, { question: "Extra?", answer: "No" })).status).toBe(
    "error",
  );
  const { data } = await client.from("faqs").select().eq("school_id", school).order("sort_order");
  const target = requireRow(data?.[0], "faq");
  expect(
    (
      await updateFaq(client, school, target.id, target.updated_at, {
        question: target.question,
        answer: "Corrected",
      })
    ).status,
  ).toBe("success");
  const after = (await client.from("faqs").select().eq("school_id", school).order("sort_order"))
    .data;
  expect(after).toHaveLength(20);
  expect(after?.map((row) => row.sort_order)).toEqual(data?.map((row) => row.sort_order));
});

it("does not report success for a missing FAQ", async () => {
  expect(
    (
      await updateFaq(client, school, randomUUID(), new Date().toISOString(), {
        question: "Gone?",
        answer: "No",
      })
    ).message,
  ).toBe(MISSING_FAQ);
});

it("allows own settings changes but denies foreign settings and platform fields", async () => {
  const own = await client
    .from("school_settings")
    .update({ pricing: "Trial is free" })
    .eq("school_id", school)
    .select();
  expect(own.error).toBeNull();
  expect(own.data).toHaveLength(1);
  const foreign = await client
    .from("school_settings")
    .update({ pricing: "Hijack" })
    .eq("school_id", foreignSchool)
    .select();
  expect(foreign.error).toBeNull();
  expect(foreign.data).toEqual([]);
  expect(
    (
      await client
        .from("schools")
        .update({ approved_at: new Date().toISOString() })
        .eq("id", school)
    ).error?.code,
  ).toBe("42501");
  expect(
    (await client.from("school_settings").insert({ school_id: foreignSchool, name: "Hijack" }))
      .error?.code,
  ).toBe("42501");
});

it("updates profile and unpublished identity atomically, but locks published identity", async () => {
  const slug = `settings-${school}`;
  const saved = await client.rpc("update_school_profile", {
    p_school_id: school,
    p_slug: slug,
    p_timezone: "Europe/London",
    p_profile: { name: "Renamed", notification_email: "owner@local.test", city: "London" },
  });
  expect(saved.error).toBeNull();
  await sql`update public.schools set published_at = now() where id = ${school}`;
  const locked = await client.rpc("update_school_profile", {
    p_school_id: school,
    p_slug: `changed-${school}`,
    p_timezone: "UTC",
    p_profile: { name: "Should not land", notification_email: "owner@local.test" },
  });
  expect(locked.error).not.toBeNull();
  expect(
    (await client.from("school_settings").select("name").eq("school_id", school).single()).data
      ?.name,
  ).toBe("Renamed");
  expect(
    (
      await foreignClient.rpc("update_school_profile", {
        p_school_id: school,
        p_slug: slug,
        p_timezone: "UTC",
        p_profile: {},
      })
    ).error?.code,
  ).toBe("42501");
});

it("updates capacity atomically and prevents deleting calendar-backed windows", async () => {
  await sql`insert into public.trial_occurrences (school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity, booked_count) values (${school}, ${windowId}, ${offeringId}, now() + interval '1 day', now() + interval '25 hours', 8, 3)`;
  expect(
    (
      await client
        .rpc("update_settings_window_capacity", { p_window_id: windowId, p_capacity: 2 })
        .single()
    ).data,
  ).toMatchObject({ result: "below_booked", max_booked: 3 });
  expect(
    (
      await client
        .rpc("update_settings_window_capacity", { p_window_id: windowId, p_capacity: 4 })
        .single()
    ).data?.result,
  ).toBe("updated");
  expect(
    (
      await client
        .from("trial_occurrences")
        .select("capacity")
        .eq("trial_window_id", windowId)
        .single()
    ).data?.capacity,
  ).toBe(4);
  expect((await client.rpc("delete_settings_window", { p_window_id: windowId })).data).toBe(
    "on_calendar",
  );
  expect(
    (
      await foreignClient
        .rpc("update_settings_window_capacity", { p_window_id: windowId, p_capacity: 4 })
        .single()
    ).data?.result,
  ).toBe("not_found");
  expect(
    (await client.from("trial_windows").update({ capacity: 1 }).eq("id", windowId)).error?.code,
  ).toBe("42501");
});
