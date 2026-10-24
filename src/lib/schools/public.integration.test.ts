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
let ownerId: string;
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
    insert into public.schools (id, slug, timezone, approved_at, published_at)
    values (${schoolKey}, ${schoolKey}, 'UTC', ${approved ? new Date() : null}, ${published ? new Date() : null}) returning id
  `
    )[0],
    "school",
  );
  const schoolId = row.id as string;
  schools.set(label, schoolId);
  await sql`
    insert into public.school_settings (school_id, owner_user_id, notification_email, agent_instructions)
    values (${schoolId}, ${user}, ${email}, 'Private owner instructions')
  `;
  await sql`insert into public.school_profiles (school_id, name) values (${schoolId}, ${label})`;
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
  ownerId = draft.user;
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

describe("public school and catalog RLS", () => {
  it.each(["anon", "owner"])(
    "lets %s read published profiles without private settings",
    async (role) => {
      request.client = role === "anon" ? anon : owner;
      const profile = await getSchoolForLandingAccess(id("published"));
      expect(profile).toMatchObject({ id: id("published"), name: "published" });
      const { data, error } = await request.client
        .from("schools")
        .select("*, school_profiles(*)")
        .eq("id", id("published"))
        .single();
      expect(error).toBeNull();
      for (const field of [
        "notification_email",
        "agent_instructions",
        "owner_user_id",
        "whatsapp_phone_number_id",
      ]) {
        expect(data).not.toHaveProperty(field);
        expect(data?.school_profiles).not.toHaveProperty(field);
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

  it("assembles the owner dashboard school through the private ownership row", async () => {
    const { data, error } = await owner
      .from("school_settings")
      .select("*, schools!inner(*, school_profiles(*))")
      .eq("owner_user_id", ownerId)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      owner_user_id: ownerId,
      schools: { id: id("draft"), school_profiles: { name: "draft" } },
    });
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

  it("keeps private settings and catalog writes unavailable to anonymous visitors", async () => {
    expect((await anon.from("school_settings").select("*")).error?.code).toBe("42501");
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

  it("has no SECURITY DEFINER routines in the application schema", async () => {
    const functions = await sql`
      SELECT p.proname FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
    `;
    expect(functions).toHaveLength(0);
  });

  it("does not let API roles install permanent trigger code", async () => {
    const [privileges] = await sql`
      SELECT has_schema_privilege('authenticated', 'public', 'CREATE') AS create_schema,
             has_table_privilege('authenticated', 'public.bookings', 'TRIGGER') AS create_trigger,
             has_database_privilege('authenticated', current_database(), 'CREATE') AS create_schema_in_database
    `;
    expect(privileges).toMatchObject({
      create_schema: false,
      create_trigger: false,
      create_schema_in_database: false,
    });
  });

  it("does not let temporary triggers forge internal write access", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated" })}, true)`;
        await tx`CREATE TEMP TABLE forged_trigger (id integer)`;
        await tx.unsafe(`CREATE FUNCTION pg_temp.forge_event() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
        BEGIN INSERT INTO public.funnel_events (school_id, event_type) VALUES ('${id("draft")}', 'forged'); RETURN NEW; END;
      $$`);
        await tx`CREATE TRIGGER forge_event AFTER INSERT ON forged_trigger FOR EACH ROW EXECUTE FUNCTION pg_temp.forge_event()`;
        await tx`INSERT INTO forged_trigger VALUES (1)`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("preserves account deletion cascades after moving ownership", async () => {
    const account = await fixture("deleted", false, false);
    await deleteAuthUser(sql, account.user);
    expect(await sql`SELECT id FROM public.schools WHERE id = ${id("deleted")}`).toHaveLength(0);
    expect(
      await sql`SELECT school_id FROM public.school_profiles WHERE school_id = ${id("deleted")}`,
    ).toHaveLength(0);
  });
});
