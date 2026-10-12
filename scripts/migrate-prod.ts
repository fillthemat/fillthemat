import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationLockKey = 156_001;

// The CLI validates the target; the shared routine also supports a local rehearsal.
export async function migrateProduction(
  url: string,
  migrationsFolder = "drizzle",
) {
  const client = postgres(url, {
    prepare: false,
    max: 1,
    max_lifetime: 0, // Keep the advisory lock on one session throughout.
    connect_timeout: 10,
    onnotice: () => {},
  });
  try {
    await client`select pg_advisory_lock(${migrationLockKey})`;
    try {
      await client`set lock_timeout = '5s'`;
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client`select pg_advisory_unlock(${migrationLockKey})`;
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main() {
  const { DIRECT_URL: url, VERCEL, VERCEL_ENV } = process.env;
  if ((VERCEL || VERCEL_ENV) && VERCEL_ENV !== "production")
    throw new Error("Refusing migration outside Vercel Production");
  if (!url) throw new Error("Missing DIRECT_URL");
  const host = new URL(url).hostname;
  if (
    /^(localhost\.?$|.*\.localhost\.?$|127\.|\[?::1\]?$|\[::ffff:7f)/i.test(
      host,
    )
  )
    throw new Error("Refusing production migration against loopback");
  await migrateProduction(url);
  console.info("Production migrations completed.");
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  if (
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{2,40}$/.test(error.code)
  )
    return error.code;
  // Drizzle wraps SQL failures. Never log the query or raw connection error.
  if ("cause" in error) return errorCode(error.cause);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "production.migration.failed",
        code: errorCode(error),
        error:
          "Production migration failed. Check DIRECT_URL and migrations; connection details are not logged.",
      }),
    );
    process.exitCode = 1;
  });
}
