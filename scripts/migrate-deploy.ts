import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationLockKey = 156_001;

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.info("Skipping deployment migrations outside Vercel Production.");
    return;
  }
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("Missing DIRECT_URL");
  const client = postgres(url, {
    prepare: false,
    max: 1,
    // Keep the advisory lock on the same session for the entire migration.
    max_lifetime: 0,
    connect_timeout: 10,
    onnotice: () => {},
  });
  try {
    await client`select pg_advisory_lock(${migrationLockKey})`;
    try {
      await client`set lock_timeout = '5s'`;
      await migrate(drizzle(client), { migrationsFolder: "drizzle" });
      console.info("Deployment migrations completed.");
    } finally {
      await client`select pg_advisory_unlock(${migrationLockKey})`;
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  if (
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{2,40}$/.test(error.code)
  )
    return error.code;
  // Drizzle wraps SQL failures; retain only the underlying safe identifier.
  if ("cause" in error) return errorCode(error.cause);
}

main().catch((error: unknown) => {
  // SQL/connection errors may contain credentials or user data.
  console.error(
    JSON.stringify({
      event: "deployment.migration.failed",
      code: errorCode(error),
      error:
        "Deployment migration failed. Check Production DIRECT_URL and migration files; connection details are not logged.",
    }),
  );
  process.exitCode = 1;
});
