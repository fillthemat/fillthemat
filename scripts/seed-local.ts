import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { getSupabaseEnv } from "./local-env";

/** Never accept DATABASE_URL: fixtures belong only to the CLI's running local stack. */
export function localSeedDatabaseUrl(status: Record<string, string>) {
  const value = status["DB_URL"];
  if (!value) throw new Error("supabase status did not include DB_URL.");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/postgres" ||
    url.username !== "postgres" ||
    url.search
  ) {
    throw new Error("Refusing to seed anything except the local Supabase postgres database.");
  }
  return value;
}

export async function seedLocal() {
  const client = postgres(localSeedDatabaseUrl(await getSupabaseEnv()), { max: 1 });
  try {
    await client.begin(async (transaction) => {
      // Serialize repeated setup/reseed calls without adding database objects.
      await transaction`SELECT pg_advisory_xact_lock(240, 1)`;
      const [schema] = await transaction`SELECT to_regclass('app.bookings') AS bookings`;
      if (!schema.bookings)
        throw new Error("Run bun run setup to apply Drizzle migrations before seeding.");
      for (const file of ["00-auth.sql", "10-app.sql"]) {
        await transaction.unsafe(
          readFileSync(new URL(`../supabase/seeds/${file}`, import.meta.url), "utf8"),
        );
      }
    });
    console.log("Seeded local owner and app demo fixtures (see docs/local-development.md).");
  } finally {
    await client.end();
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  await seedLocal();
}
