import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { authSql, loadLocalEnv } from "@/test/integration-env";

loadLocalEnv();
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
          .replaceAll("ON SCHEMA public ", `ON SCHEMA ${schema} `)
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
      const [profile] = await tx.unsafe(`select * from ${schema}.school_profiles`);
      expect(profile).toMatchObject({
        name: "OpenMat MMA",
        city: "Toronto",
        country: "CA",
        address: "295 College St, Level B",
        website: "https://www.openmat.ca",
      });
      const [school] = await tx.unsafe(`select slug, timezone from ${schema}.schools`);
      expect(school).toEqual({ slug: "openmat", timezone: "America/Toronto" });
      const [settings] = await tx.unsafe(`select * from ${schema}.school_settings`);
      expect(settings?.notification_email).toBe(email);
      await tx.unsafe(
        `update ${schema}.school_profiles set name = 'Edited name', city = 'Edited city'`,
      );
      await tx.unsafe(`update ${schema}.faqs set answer = 'Edited answer' where sort_order = 0`);
      await tx.unsafe(
        `update ${schema}.trial_offerings set name = 'Edited class' where name = 'Boxing'`,
      );
      await tx.unsafe(`update ${schema}.trial_windows set capacity = 7`);
      await tx.unsafe(seed);
      const [edited] = await tx.unsafe(`select name, city from ${schema}.school_profiles`);
      expect(edited).toEqual({ name: "Edited name", city: "Edited city" });
      const [faq] = await tx.unsafe(`select answer from ${schema}.faqs where sort_order = 0`);
      expect(faq?.answer).toBe("Edited answer");
      const [offering] = await tx.unsafe(
        `select count(*)::integer as count from ${schema}.trial_offerings where name = 'Edited class'`,
      );
      expect(offering?.count).toBe(1);
      const [windows] = await tx.unsafe(
        `select count(*)::integer as count from ${schema}.trial_windows where capacity = 7`,
      );
      expect(windows?.count).toBe(44);
      for (const [table, count] of Object.entries({
        schools: 1,
        school_settings: 1,
        school_profiles: 1,
        faqs: 6,
        trial_offerings: 15,
        trial_windows: 44,
        bookings: 1,
        leads: 1,
      })) {
        const [row] = await tx.unsafe(`select count(*)::integer as count from ${schema}.${table}`);
        expect(row?.count, table).toBe(count);
      }
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
