import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { drizzleHistory, normalizeSchemaDump } from "./declarative-schema";

// A standalone, throwaway PostgreSQL 17 container, with no host ports or volumes.
// Never uses DATABASE_URL, Supabase status, or any running application's stack.
const container = `fillthemat-schema-parity-${crypto.randomUUID()}`;
const image = "public.ecr.aws/supabase/postgres:17.11.0.004";

function docker(args: string[], input?: string) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `Docker failed (${result.status}).`);
  return result.stdout;
}

function query(database: string, sql: string) {
  return docker(
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"],
    sql,
  );
}

let started = false;
try {
  docker([
    "run",
    "--detach",
    "--rm",
    "--network",
    "none",
    "--name",
    container,
    "--entrypoint",
    "bash",
    image,
    "-c",
    'install -d -o postgres -g postgres /tmp/schema-data && su postgres -c "initdb -D /tmp/schema-data --auth=trust" >/tmp/init.log && exec su postgres -c "postgres -D /tmp/schema-data"',
  ]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], {
      stdio: "ignore",
      timeout: 5_000,
    });
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await setTimeout(500);
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready.");
  query("postgres", "CREATE ROLE anon; CREATE ROLE authenticated; CREATE DATABASE declarative;");
  // Only the external FK target is stubbed; auth itself is owned by Supabase.
  const auth = "CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);\n";
  query(
    "postgres",
    auth +
      drizzleHistory(process.cwd())
        .map(({ sql }) => sql)
        .join("\n"),
  );
  const schemas = "supabase/schemas";
  const desired = readdirSync(schemas)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(schemas, file), "utf8"))
    .join("\n");
  query("declarative", auth + desired);
  const dump = (database: string) =>
    normalizeSchemaDump(
      docker([
        "exec",
        container,
        "pg_dump",
        "-U",
        "postgres",
        "-d",
        database,
        "--schema-only",
        "--no-owner",
        "--schema=app",
      ]),
    );
  if (dump("postgres") !== dump("declarative"))
    throw new Error("Declarative app schema differs from replayed Drizzle history.");
  console.info("Exact PostgreSQL 17 schema parity: Drizzle history and supabase/schemas match.");
} finally {
  if (started) docker(["rm", "--force", container]);
}
