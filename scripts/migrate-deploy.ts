import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

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
    connect_timeout: 10,
    onnotice: () => {},
  });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    console.info("Deployment migrations completed.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch(() => {
  // SQL/connection errors may contain credentials or user data.
  console.error(
    JSON.stringify({
      event: "deployment.migration.failed",
      error:
        "Deployment migration failed. Check Production DIRECT_URL and migration files; connection details are not logged.",
    }),
  );
  process.exitCode = 1;
});
