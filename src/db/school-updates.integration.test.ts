import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
  requireRow,
} from "@/test/integration-env";

loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) {
  throw new Error("School update tests require a local database");
}
const sql = authSql();
const owner = randomUUID();
const stranger = randomUUID();
const school = randomUUID();

beforeAll(async () => {
  await insertAuthUser(sql, owner, `${owner}@local.test`);
  await sql`insert into public.users (id, email) values (${owner}, ${`${owner}@local.test`})`;
  await sql`
    insert into public.schools (id, slug, timezone, updated_at)
    values (${school}, ${school}, 'UTC', '2000-01-01')
  `;
  await sql`insert into public.school_settings (school_id, owner_user_id) values (${school}, ${owner})`;
  await sql`insert into public.school_profiles (school_id) values (${school})`;
});

afterAll(async () => {
  await deleteAuthUser(sql, owner);
  await sql.end({ timeout: 5 });
});

it("lets owners preview and publish, with database-managed updated_at", async () => {
  await sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${owner}, true)`;
    const [preview] = await tx`
      update public.school_settings set previewed_at = now() where school_id = ${school}
      returning previewed_at, updated_at, created_at
    `;
    const row = requireRow(preview, "previewed school");
    expect(row.previewed_at).not.toBeNull();
    expect(new Date(row.updated_at).getTime()).toBeGreaterThan(Date.parse("2000-01-01"));
    const [published] = await tx`
      update public.schools set published_at = now() where id = ${school}
      returning published_at, updated_at > ${row.updated_at}::timestamptz as advanced, created_at
    `;
    expect(requireRow(published, "published school")).toMatchObject({
      advanced: true,
    });
    expect(published?.published_at).not.toBeNull();
  });
});

it.each(["approved_at", "updated_at"])(
  "does not grant owners direct updates to %s",
  async (column) => {
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claim.sub', ${owner}, true)`;
        await tx`update public.schools set ${tx(column)} = ${tx(column)} where id = ${school}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  },
);

it("does not let another owner update the school", async () => {
  await sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${stranger}, true)`;
    const rows =
      await tx`update public.school_settings set previewed_at = now() where school_id = ${school} returning school_id`;
    expect(rows).toHaveLength(0);
  });
});

it.each(["owner_user_id", "school_id", "whatsapp_phone_number_id"])(
  "does not grant owners direct updates to private platform field %s",
  async (column) => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('request.jwt.claim.sub', ${owner}, true)`;
        await tx`UPDATE public.school_settings SET ${tx(column)} = ${tx(column)} WHERE school_id = ${school}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  },
);

it("cannot bypass published identity immutability through direct updates or unpublishing", async () => {
  for (const update of [
    "slug = 'changed-school'",
    "timezone = 'Europe/London'",
    "published_at = NULL",
  ]) {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('request.jwt.claim.sub', ${owner}, true)`;
        await tx.unsafe(`UPDATE public.schools SET ${update} WHERE id = '${school}'`);
      }),
    ).rejects.toMatchObject({
      message: "slug, timezone and publication timestamp are immutable after publish",
    });
  }
});

it("does not let anonymous callers update schools", async () => {
  await expect(
    sql.begin(async (tx) => {
      await tx`set local role anon`;
      await tx`update public.school_settings set previewed_at = now() where school_id = ${school}`;
    }),
  ).rejects.toMatchObject({ code: "42501" });
});

it("overrides caller-supplied timestamps without changing created_at", async () => {
  const [row] = await sql`
    update public.school_settings set updated_at = '2000-01-01'
    where school_id = ${school}
    returning updated_at = statement_timestamp() as current, created_at
  `;
  expect(requireRow(row, "settings").current).toBe(true);
  const [next] = await sql`
    update public.school_settings set agent_instructions = 'Updated' where school_id = ${school}
    returning updated_at > ${row?.created_at}::timestamptz as advanced, created_at
  `;
  expect(requireRow(next, "updated settings")).toMatchObject({
    advanced: true,
    created_at: row?.created_at,
  });
});

it("attaches the shared BEFORE UPDATE row trigger to every public table with updated_at", async () => {
  const missing = await sql`
    select c.table_name from information_schema.columns c
    join information_schema.tables t using (table_catalog, table_schema, table_name)
    where c.table_schema = 'public' and c.column_name = 'updated_at'
      and t.table_type = 'BASE TABLE'
      and not exists (
        select 1 from pg_catalog.pg_trigger tr
        where tr.tgrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
          and tr.tgfoid = 'public.set_updated_at()'::regprocedure
          and tr.tgtype = 19 and tr.tgenabled = 'O' and not tr.tgisinternal
      )
  `;
  expect(missing).toHaveLength(0);
});
