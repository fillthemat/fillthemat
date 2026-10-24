import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { authSql, loadLocalEnv } from "@/test/integration-env";

loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) {
  throw new Error("Migration tests require a local database");
}
const sql = authSql();
afterAll(() => sql.end({ timeout: 5 }));

// Replay into a transaction-local fixture schema, never reset the shared stack.
function inSchema(source: string, schema: string) {
  return source
    .replaceAll('"public"', `"${schema}"`)
    .replaceAll("public.", `${schema}.`)
    .replaceAll("CREATE SCHEMA IF NOT EXISTS public;", `CREATE SCHEMA IF NOT EXISTS ${schema};`);
}

it("backfills all editable school fields before removing their old columns", async () => {
  const rollback = new Error("Rollback migration fixtures");
  await expect(
    sql.begin(async (tx) => {
      const schema = `migration_${randomUUID().replaceAll("-", "")}`;
      await tx.unsafe(`CREATE SCHEMA ${schema}`);
      const migrations = readdirSync("supabase/migrations")
        .filter((name) => name.endsWith(".sql"))
        .sort();
      for (const name of migrations.filter((name) => name < "20261024173748")) {
        await tx.unsafe(inSchema(readFileSync(`supabase/migrations/${name}`, "utf8"), schema));
      }
      const owner = randomUUID();
      const school = randomUUID();
      await tx`insert into auth.users (id) values (${owner})`;
      await tx.unsafe(
        `insert into ${schema}.users (id, email) values ($1, 'migration@local.test')`,
        [owner],
      );
      await tx.unsafe(
        `insert into ${schema}.schools (
      id, owner_user_id, slug, timezone, name, notification_email, phone, website,
      address, country, city, parking_notes, access_notes, trial_guidance, pricing,
      welcome_message, agent_instructions, logo_url, primary_color
    ) values ($1, $2, 'migration-school', 'Europe/London', 'Original name', 'owner@local.test',
      '123', 'https://school.test', 'Street', 'GB', 'London', 'Parking', 'Entrance',
      'Arrive early', 'Free trial', 'Welcome', 'Be concise', 'https://school.test/logo.png', '#123456')`,
        [school, owner],
      );
      const [before] = await tx.unsafe(`select * from ${schema}.schools where id = $1`, [school]);
      for (const name of migrations.filter((name) => name >= "20261024173748")) {
        await tx.unsafe(inSchema(readFileSync(`supabase/migrations/${name}`, "utf8"), schema));
      }
      const [settings] = await tx.unsafe(
        `select * from ${schema}.school_settings where school_id = $1`,
        [school],
      );
      const [identity] = await tx.unsafe(`select * from ${schema}.schools where id = $1`, [school]);
      for (const key of Object.keys(settings ?? {}).filter((key) => key !== "school_id")) {
        expect(settings?.[key], key).toEqual(before?.[key]);
      }
      expect(identity).toMatchObject({
        id: school,
        owner_user_id: owner,
        slug: "migration-school",
        timezone: "Europe/London",
      });
      expect(identity).not.toHaveProperty("notification_email");
      expect(identity).not.toHaveProperty("name");
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it("replays the declarative schemas in filename order on an empty schema", async () => {
  const rollback = new Error("Rollback schema replay");
  await expect(
    sql.begin(async (tx) => {
      const schema = `replay_${randomUUID().replaceAll("-", "")}`;
      for (const name of readdirSync("supabase/schemas")
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        await tx.unsafe(inSchema(readFileSync(`supabase/schemas/${name}`, "utf8"), schema));
      }
      const [row] =
        await tx`select count(*)::integer as count from information_schema.tables where table_schema = ${schema} and table_name = 'school_settings'`;
      expect(row?.count).toBe(1);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
