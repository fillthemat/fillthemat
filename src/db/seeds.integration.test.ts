import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { authSql, loadLocalEnv } from "@/test/integration-env";

loadLocalEnv();
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) {
  throw new Error("Seed tests require a local database");
}
const sql = authSql();
afterAll(() => sql.end({ timeout: 5 }));

it("seeds the current public schema and preserves settings on reruns", async () => {
  const rollback = new Error("Rollback seed fixtures");
  await expect(
    sql.begin(async (tx) => {
      const schema = `seed_${randomUUID().replaceAll("-", "")}`;
      const email = `${schema}@local.test`;
      const fixtureSql = (source: string) =>
        source
          .replaceAll('"public"', `"${schema}"`)
          .replaceAll("public.", `${schema}.`)
          .replaceAll(
            "CREATE SCHEMA IF NOT EXISTS public;",
            `CREATE SCHEMA IF NOT EXISTS ${schema};`,
          )
          .replaceAll("owner@local.test", email);
      await tx.unsafe(`CREATE SCHEMA ${schema}`);
      for (const name of readdirSync("supabase/migrations")
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        await tx.unsafe(fixtureSql(readFileSync(`supabase/migrations/${name}`, "utf8")));
      }
      const seed = fixtureSql(readFileSync("supabase/seeds/10-app.sql", "utf8"));
      await tx.unsafe(fixtureSql(readFileSync("supabase/seeds/00-auth.sql", "utf8")));
      await tx.unsafe(seed);
      const [settings] = await tx.unsafe(`select * from ${schema}.school_settings`);
      expect(settings).toMatchObject({
        name: "Demo Dojo",
        city: "Brooklyn",
        notification_email: email,
      });
      await tx.unsafe(
        `update ${schema}.school_settings set name = 'Edited name', city = 'Edited city'`,
      );
      await tx.unsafe(seed);
      const [edited] = await tx.unsafe(`select name, city from ${schema}.school_settings`);
      expect(edited).toEqual({ name: "Edited name", city: "Edited city" });
      for (const table of [
        "schools",
        "school_settings",
        "trial_offerings",
        "trial_windows",
        "bookings",
        "leads",
      ]) {
        const [row] = await tx.unsafe(`select count(*)::integer as count from ${schema}.${table}`);
        expect(row?.count, table).toBe(1);
      }
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
