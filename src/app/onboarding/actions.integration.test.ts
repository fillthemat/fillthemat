import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import type { Database } from "@/db/types";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";

loadLocalEnv();
const sql = authSql();
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const users: string[] = [];

async function freshUser() {
  const id = randomUUID();
  users.push(id);
  await insertAuthUser(sql, id, `${id}@local.test`);
  return id;
}

function createSchool(owner: string, slug = randomUUID(), approve = false, city = "New York") {
  return admin.rpc("create_onboarding_school", {
    p_owner_user_id: owner,
    p_owner_email: `${owner}@local.test`,
    p_name: "Fresh school",
    p_slug: slug,
    p_timezone: "America/New_York",
    p_city: city,
    p_notification_email: "notifications@local.test",
    p_self_approve: approve,
  });
}

afterAll(async () => {
  for (const user of users) await deleteAuthUser(sql, user);
  await sql.end({ timeout: 5 });
});

it.each(["New York", ""])(
  "atomically provisions an owner-visible school with city %j",
  async (city) => {
    const owner = await freshUser();
    expect(await createSchool(owner, randomUUID(), false, city)).toMatchObject({
      data: "created",
      error: null,
    });
    await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${owner}, true)`;
      const [row] = await tx`
      select s.approved_at, s.published_at, p.name, p.city, p.country,
        settings.notification_email, u.email
      from public.school_settings settings
      join public.schools s on s.id = settings.school_id
      join public.school_profiles p on p.school_id = s.id
      join public.users u on u.id = settings.owner_user_id
    `;
      expect(requireRow(row, "new school")).toMatchObject({
        approved_at: null,
        published_at: null,
        name: "Fresh school",
        city: city || null,
        country: "US",
        notification_email: "notifications@local.test",
        email: `${owner}@local.test`,
      });
    });
  },
);

it("maps a taken slug and rolls back the new user and all school rows", async () => {
  const owner = await freshUser();
  const other = await freshUser();
  const slug = randomUUID();
  expect(await createSchool(owner, slug)).toMatchObject({ data: "created", error: null });
  expect(await createSchool(other, slug)).toMatchObject({ data: "slug_taken", error: null });
  expect(await sql`select id from public.users where id = ${other}`).toHaveLength(0);
  expect(
    await sql`select school_id from public.school_settings where owner_user_id = ${other}`,
  ).toHaveLength(0);
  expect(await sql`select id from public.schools where slug = ${slug}`).toHaveLength(1);
});

it("serializes concurrent requests for one owner without orphan schools", async () => {
  const owner = await freshUser();
  const slugs = [randomUUID(), randomUUID()];
  const results = await Promise.all(slugs.map((slug) => createSchool(owner, slug)));
  expect(results.every((result) => result.error === null)).toBe(true);
  expect(results.map((result) => result.data).sort()).toEqual(["already_exists", "created"]);
  expect(await sql`select id from public.schools where slug in ${sql(slugs)}`).toHaveLength(1);
});

it("rolls back identity and profile if inserting private settings fails", async () => {
  const owner = await freshUser();
  const slug = randomUUID();
  await expect(
    sql.begin(async (tx) => {
      await tx`set local role service_role`;
      await tx`select public.create_onboarding_school(
      ${owner}::uuid, 'owner@local.test', 'School', ${slug}, 'UTC', '', null, false
    )`;
    }),
  ).rejects.toMatchObject({ code: "23502" });
  expect(await sql`select id from public.users where id = ${owner}`).toHaveLength(0);
  expect(await sql`select id from public.schools where slug = ${slug}`).toHaveLength(0);
});

it("allows only the platform to opt into development approval", async () => {
  const owner = await freshUser();
  const slug = randomUUID();
  expect(await createSchool(owner, slug, true)).toMatchObject({ data: "created", error: null });
  const [row] =
    await sql`select approved_at, published_at from public.schools where slug = ${slug}`;
  expect(requireRow(row, "approved school").approved_at).not.toBeNull();
  expect(row?.published_at).toBeNull();
});

it.each(["anon", "authenticated"])(
  "denies %s provisioning and direct identity/ownership inserts",
  async (role) => {
    const owner = await freshUser();
    for (const statement of [
      "select public.create_onboarding_school($1::uuid, 'x@local.test', 'X', 'new-school', 'UTC', '', 'x@local.test', true)",
      "insert into public.users (id, email) values ($1::uuid, 'x@local.test')",
      "insert into public.schools (id, slug, timezone, approved_at) values ($1::uuid, 'new-school', 'UTC', now())",
      "insert into public.school_settings (school_id, owner_user_id) values ($1::uuid, $1::uuid)",
    ]) {
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select set_config('request.jwt.claim.sub', ${owner}, true)`;
          await tx.unsafe(statement, [owner]);
        }),
      ).rejects.toMatchObject({ code: "42501" });
    }
  },
);
