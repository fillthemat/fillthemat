import { readMigrationFiles } from "drizzle-orm/migrator";
import { readFileSync } from "node:fs";
import postgres from "postgres";

class MigrationCheckError extends Error {}

async function main() {
  // Prefer the runtime target; operator recovery may only provide DIRECT_URL.
  const url = process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!url)
    throw new MigrationCheckError(
      "DATABASE_URL or DIRECT_URL is required for the migration check.",
    );
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const required = readMigrationFiles({ migrationsFolder: "drizzle" });
  const client = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    // No DDL or migration execution: this gate must remain read-only, including
    // on an empty database. The deploy migrator is a separate preceding step.
    await client.begin("READ ONLY", async (tx) => {
      // Transaction-local works through the runtime transaction pooler too.
      await tx`set local statement_timeout = '5s'`;
      const [table] = await tx`select to_regclass('drizzle.__drizzle_migrations') as name`;
      const applied = table?.name
        ? await tx<
            { hash: string; created_at: string }[]
          >`select hash, created_at from drizzle.__drizzle_migrations`
        : [];
      const pending: string[] = [];
      // Drizzle migrate only applies timestamps newer than this watermark.
      const newestApplied = Math.max(0, ...applied.map((row) => Number(row.created_at)));
      for (const [index, migration] of required.entries()) {
        const tag = journal.entries[index].tag;
        const rows = applied.filter((row) => Number(row.created_at) === migration.folderMillis);
        if (rows.some((row) => row.hash !== migration.hash)) {
          throw new MigrationCheckError(
            `applied migration ${tag} hash differs — needs manual repair; db:migrate:prod will not fix this. No database changes were made.`,
          );
        }
        if (!rows.length) {
          if (migration.folderMillis <= newestApplied) {
            throw new MigrationCheckError(
              `applied migration ${tag} out-of-order — needs manual repair; db:migrate:prod will not fix this. No database changes were made.`,
            );
          }
          pending.push(tag);
        }
      }
      if (pending.length) {
        throw new MigrationCheckError(
          `Database migrations missing: ${pending.join(", ")}. Apply hosted migrations with bun run db:migrate:prod before deploying. No database changes were made.`,
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
  const identifiers: string[] = [];
  if (error && typeof error === "object") {
    if ("code" in error && typeof error.code === "string" && /^[A-Z0-9_]{2,40}$/.test(error.code))
      identifiers.push(`code=${error.code}`);
    if (
      "name" in error &&
      typeof error.name === "string" &&
      /^(?:[A-Za-z]{1,32})?Error$/.test(error.name)
    )
      identifiers.push(`name=${error.name}`);
  }
  console.error(
    error instanceof MigrationCheckError
      ? error.message
      : `Migration check failed${identifiers.length ? ` (${identifiers.join(", ")})` : ""}. Check database access and migration files; connection details are not logged.`,
  );
  process.exitCode = 1;
});
