import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/types";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";
import { getSchoolForLandingAccess, loadSchoolCatalog } from "./public";

const request = vi.hoisted(() => ({ client: null as SupabaseClient<Database> | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => request.client }));

loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) {
  throw new Error("Public school tests require a local database");
}
const sql = authSql();
const owners: string[] = [];
const schools = new Map<string, string>();
let anon: SupabaseClient<Database>;
let owner: SupabaseClient<Database>;
const clients: SupabaseClient<Database>[] = [];

function client() {
  const result = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  clients.push(result);
  return result;
}

async function fixture(label: string, approved: boolean, published: boolean) {
  const user = randomUUID();
  owners.push(user);
  const email = `${user}@local.test`;
  const password = randomUUID();
  await insertAuthUser(sql, user, email);
  await sql`update auth.users set encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf')) where id = ${user}`;
  await sql`insert into public.users (id, email) values (${user}, ${email})`;
  const schoolKey = randomUUID();
  const row = requireRow(
    (
      await sql`
    insert into public.schools (id, owner_user_id, slug, timezone, approved_at, published_at)
    values (${schoolKey}, ${user}, ${schoolKey}, 'UTC', ${approved ? new Date() : null}, ${published ? new Date() : null}) returning id
  `
    )[0],
    "school",
  );
  const schoolId = row.id as string;
  schools.set(label, schoolId);
  await sql`
    insert into public.school_settings (school_id, name, notification_email, agent_instructions)
    values (${schoolId}, ${label}, ${email}, 'Private owner instructions')
  `;
  const offering = requireRow(
    (
      await sql`
    insert into public.trial_offerings (school_id, name) values (${schoolId}, 'Active trial') returning id
  `
    )[0],
    "offering",
  );
  const inactiveOffering = requireRow(
    (
      await sql`
    insert into public.trial_offerings (school_id, name, active)
    values (${schoolId}, 'Inactive trial', false) returning id
  `
    )[0],
    "inactive offering",
  );
  for (const [offeringId, active] of [
    [offering.id, true],
    [offering.id, false],
    [inactiveOffering.id, true],
  ] as const) {
    const window = requireRow(
      (
        await sql`
      insert into public.trial_windows (school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity, active)
      values (${schoolId}, ${offeringId}, 1, 600, 60, 5, ${active}) returning id
    `
      )[0],
      "window",
    );
    await sql`
    insert into public.trial_occurrences (school_id, trial_offering_id, trial_window_id, start_at, end_at, capacity)
    values (${schoolId}, ${offeringId}, ${window.id}, '2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z', 5)
  `;
  }
  await sql`insert into public.faqs (school_id, question, answer) values (${schoolId}, 'Where?', 'Here')`;
  return { user, email, password };
}

function id(label: string) {
  return requireRow(schools.get(label), label);
}

beforeAll(async () => {
  anon = client();
  await fixture("published", true, true);
  const draft = await fixture("draft", false, false);
  await fixture("unapproved", false, true);
  await fixture("foreign", true, false);
  owner = client();
  const { error } = await owner.auth.signInWithPassword({
    email: draft.email,
    password: draft.password,
  });
  if (error) throw error;
});

afterAll(async () => {
  for (const user of owners) await deleteAuthUser(sql, user);
  for (const supabase of clients) supabase.auth.stopAutoRefresh();
  await sql.end({ timeout: 5 });
});

describe("landing RPC and catalog RLS", () => {
  it.each(["anon", "owner"])(
    "lets %s read published profiles without private settings",
    async (role) => {
      request.client = role === "anon" ? anon : owner;
      const profile = await getSchoolForLandingAccess(id("published"));
      expect(profile).toMatchObject({ id: id("published"), name: "published" });
      const { data, error } = await request.client.rpc("get_landing_school", {
        p_slug: id("published"),
      });
      expect(error).toBeNull();
      for (const field of [
        "notification_email",
        "agent_instructions",
        "owner_user_id",
        "whatsapp_phone_number_id",
      ]) {
        expect(data?.[0]).not.toHaveProperty(field);
      }
    },
  );

  it.each(["draft", "unapproved", "foreign"])(
    "hides %s profiles and catalogs from anonymous visitors, even with preview",
    async (label) => {
      request.client = anon;
      expect(await getSchoolForLandingAccess(id(label), { preview: true })).toBeNull();
      expect(await loadSchoolCatalog(id(label))).toEqual({
        offerings: [],
        windows: [],
        occurrences: [],
        faqs: [],
      });
    },
  );

  it("limits owner previews to their school and requires an explicit preview", async () => {
    request.client = owner;
    expect(await getSchoolForLandingAccess(id("draft"))).toBeNull();
    expect(await getSchoolForLandingAccess(id("draft"), { preview: true })).toMatchObject({
      name: "draft",
      approvedAt: null,
      publishedAt: null,
    });
    expect(await getSchoolForLandingAccess(id("foreign"), { preview: true })).toBeNull();
    expect((await loadSchoolCatalog(id("draft"))).offerings).toHaveLength(2);
    expect((await loadSchoolCatalog(id("foreign"))).offerings).toEqual([]);
  });

  it("exposes active published catalog rows with scheduling Dates", async () => {
    request.client = anon;
    const catalog = await loadSchoolCatalog(id("published"));
    expect(catalog.offerings).toHaveLength(1);
    expect(catalog.windows).toHaveLength(1);
    expect(catalog.occurrences).toHaveLength(1);
    expect(catalog.occurrences[0]?.startAt).toEqual(new Date("2026-11-02T10:00:00Z"));
    expect(catalog.faqs).toHaveLength(1);
  });

  it("reuses the server client for background public reads without request cookies", async () => {
    const { createClient: serverClient } =
      await vi.importActual<typeof import("@/lib/supabase/server")>("@/lib/supabase/server");
    const supabase = await serverClient({ anonymous: true });
    clients.push(supabase);
    const { data, error } = await supabase
      .from("trial_offerings")
      .select("id")
      .eq("school_id", id("published"));
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((await supabase.auth.getSession()).data.session).toBeNull();
  });

  it("does not grant anonymous access to base school/settings tables or catalog writes", async () => {
    for (const table of ["schools", "school_settings"] as const) {
      expect((await anon.from(table).select("*")).error?.code).toBe("42501");
    }
    const { error } = await anon
      .from("trial_offerings")
      .insert({ school_id: id("published"), name: "Forbidden" });
    expect(error?.code).toBe("42501");
    const foreignSettings = await owner
      .from("school_settings")
      .select("*")
      .eq("school_id", id("published"));
    expect(foreignSettings.error).toBeNull();
    expect(foreignSettings.data).toEqual([]);
  });
});
