import { afterAll, expect, it } from "vitest";
import { authSql, loadLocalEnv } from "@/test/integration-env";

loadLocalEnv();
const sql = authSql();
afterAll(() => sql.end({ timeout: 5 }));

it.each(["anon", "authenticated"])("does not let %s create objects in public", async (role) => {
  const rows = await sql`
    select has_schema_privilege(${role}, 'public', 'CREATE') as can_create
  `;
  expect(rows).toEqual([{ can_create: false }]);
});
