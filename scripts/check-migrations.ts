import { readFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

class MigrationCheckError extends Error {}

async function main() {
  // Check the runtime database, not a potentially different DIRECT_URL target.
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new MigrationCheckError(
      "DATABASE_URL is required for the migration check.",
    );
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as {
    entries: Array<{ tag: string }>;
  };
  const required = readMigrationFiles({ migrationsFolder: "drizzle" });
  const client = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    // No DDL or migration execution: this gate must remain read-only, including
    // on an empty database. Only an operator applies hosted migrations.
    await client.begin("READ ONLY", async (tx) => {
      const [table] =
        await tx`select to_regclass('drizzle.__drizzle_migrations') as name`;
      const applied = table?.name
        ? await tx<
            { hash: string; created_at: string }[]
          >`select hash, created_at from drizzle.__drizzle_migrations`
        : [];
      const pending = required.flatMap((migration, index) =>
        applied.some(
          (row) =>
            Number(row.created_at) === migration.folderMillis &&
            row.hash === migration.hash,
        )
          ? []
          : [journal.entries[index].tag],
      );
      if (pending.length) {
        throw new MigrationCheckError(
          `Database migrations missing or changed: ${pending.join(", ")}. Apply hosted migrations with bun run db:migrate:prod before deploying. No database changes were made.`,
        );
      }
    });
    console.info("Database migrations are up to date (read-only check).");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  // Connection errors can contain credentials/URLs; never dump raw exceptions.
  console.error(
    error instanceof MigrationCheckError
      ? error.message
      : "Migration check failed. Check database access and migration files; connection details are not logged.",
  );
  process.exitCode = 1;
});
