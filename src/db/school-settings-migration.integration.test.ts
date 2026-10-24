import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";

loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) {
  throw new Error("Migration tests require a local database");
}
const sql = authSql();
afterAll(() => sql.end({ timeout: 5 }));

function inSchema(source: string, schema: string) {
  return source
    .replaceAll('"public"', `"${schema}"`)
    .replaceAll("public.", `${schema}.`)
    .replaceAll("ON SCHEMA public ", `ON SCHEMA ${schema} `)
    .replaceAll("CREATE SCHEMA IF NOT EXISTS public;", `CREATE SCHEMA IF NOT EXISTS ${schema};`);
}

it("preserves profile, ownership, private configuration and timestamps when splitting public/private data", async () => {
  const rollback = new Error("Rollback migration fixtures");
  await expect(
    sql.begin(async (tx) => {
      const schema = `migration_${randomUUID().replaceAll("-", "")}`;
      await tx.unsafe(`CREATE SCHEMA ${schema}`);
      const migrations = readdirSync("supabase/migrations")
        .filter((name) => name.endsWith(".sql"))
        .sort();
      const split = "20261024202441";
      for (const name of migrations.filter((name) => name < split)) {
        await tx.unsafe(inSchema(readFileSync(`supabase/migrations/${name}`, "utf8"), schema));
      }
      const owner = randomUUID();
      const school = randomUUID();
      await tx`INSERT INTO auth.users (id) VALUES (${owner})`;
      await tx.unsafe(
        `INSERT INTO ${schema}.users (id, email) VALUES ($1, 'migration@local.test')`,
        [owner],
      );
      await tx.unsafe(
        `INSERT INTO ${schema}.schools (
      id, owner_user_id, slug, timezone, previewed_at, whatsapp_phone_number_id, whatsapp_waba_id
    ) VALUES ($1, $2, 'migration-school', 'Europe/London', '2026-01-01', 'migration-phone', 'migration-waba')`,
        [school, owner],
      );
      await tx.unsafe(
        `INSERT INTO ${schema}.school_settings (
      school_id, name, notification_email, phone, website, address, country, city,
      parking_notes, access_notes, trial_guidance, pricing, welcome_message,
      agent_instructions, logo_url, primary_color, created_at, updated_at
    ) VALUES ($1, 'Original name', 'owner@local.test', '123', 'https://school.test',
      'Street', 'GB', 'London', 'Parking', 'Entrance', 'Arrive early', 'Free trial',
      'Welcome', 'Be concise', 'https://school.test/logo.png', '#123456', '2020-01-01', '2021-01-01')`,
        [school],
      );
      const before = requireRow(
        (
          await tx.unsafe(`SELECT * FROM ${schema}.school_settings WHERE school_id = $1`, [school])
        )[0],
        "old settings",
      );
      for (const name of migrations.filter((name) => name >= split)) {
        await tx.unsafe(inSchema(readFileSync(`supabase/migrations/${name}`, "utf8"), schema));
      }
      const profile = requireRow(
        (
          await tx.unsafe(`SELECT * FROM ${schema}.school_profiles WHERE school_id = $1`, [school])
        )[0],
        "profile",
      );
      for (const key of Object.keys(profile)) expect(profile[key], key).toEqual(before[key]);
      const account = requireRow(
        (
          await tx.unsafe(`SELECT * FROM ${schema}.school_settings WHERE school_id = $1`, [school])
        )[0],
        "account",
      );
      expect(account).toMatchObject({
        owner_user_id: owner,
        notification_email: before.notification_email,
        agent_instructions: before.agent_instructions,
        previewed_at: new Date("2026-01-01T00:00:00Z"),
        whatsapp_phone_number_id: "migration-phone",
        whatsapp_waba_id: "migration-waba",
        created_at: before.created_at,
        updated_at: before.updated_at,
      });
      const identity = requireRow(
        (await tx.unsafe(`SELECT * FROM ${schema}.schools WHERE id = $1`, [school]))[0],
        "identity",
      );
      expect(identity).toMatchObject({
        id: school,
        slug: "migration-school",
        timezone: "Europe/London",
      });
      for (const privateField of [
        "owner_user_id",
        "notification_email",
        "agent_instructions",
        "whatsapp_phone_number_id",
      ]) {
        expect(identity).not.toHaveProperty(privateField);
        expect(profile).not.toHaveProperty(privateField);
      }
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it("includes all grouped invoker routines from the configured declarative tree", async () => {
  expect(readFileSync("supabase/config.toml", "utf8")).toContain(
    'declarative_schema_path = "./schemas"',
  );
  const names = readdirSync("supabase/schemas/functions")
    .filter((file) => file.endsWith(".sql"))
    .flatMap((file) =>
      [
        ...readFileSync(`supabase/schemas/functions/${file}`, "utf8").matchAll(
          /CREATE (?:OR REPLACE )?FUNCTION public\.([a-z_]+)\(/g,
        ),
      ].map((match) => requireRow(match[1], "routine name")),
    );
  expect(names.length).toBeGreaterThan(0);
  const installed = await sql`
    SELECT p.proname, p.prosecdef FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(${names})
  `;
  expect(installed).toHaveLength(names.length);
  expect(installed.every((routine) => !routine.prosecdef)).toBe(true);
});
