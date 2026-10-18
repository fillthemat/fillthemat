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
  query(
    "postgres",
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE public_probe; CREATE DATABASE declarative;",
  );
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
  // Replay app beside public too, so accidental changes/dependencies are observable.
  query(
    "declarative",
    auth +
      drizzleHistory(process.cwd())
        .map(({ sql }) => sql)
        .join("\n"),
  );
  const dump = (database: string, schema: string, structural = false) =>
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
        `--schema=${schema}`,
        ...(structural ? ["--no-acl", "--no-comments"] : []),
      ]),
    );
  const originalApp = dump("declarative", "app");
  // Simulate legacy Supabase's permissive defaults, including BYPASSRLS service_role.
  // These settings exist only in this disposable database, never desired-state SQL.
  query(
    "declarative",
    `
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE TABLE public.unrelated (id integer);
   `,
  );
  const publicBoundary = () =>
    query(
      "declarative",
      `
    SELECT nspacl FROM pg_namespace WHERE nspname = 'public';
    SELECT defaclobjtype, defaclacl FROM pg_default_acl
      WHERE defaclnamespace = 'public'::regnamespace ORDER BY defaclobjtype;
  `,
    );
  const originalBoundary = publicBoundary();
  query("declarative", desired);
  if (publicBoundary() !== originalBoundary)
    throw new Error("Public copies changed schema-wide ACLs or default privileges.");
  if (dump("declarative", "app") !== originalApp)
    throw new Error("Applying public copies changed the Drizzle app schema.");
  if (/\bapp\./.test(dump("declarative", "public")))
    throw new Error("Public copies still reference app objects.");
  query("declarative", readFileSync("scripts/declarative-schema-security.sql", "utf8"));
  query("declarative", readFileSync("scripts/declarative-schema-behavior.sql", "utf8"));

  // Namespace normalization uses PostgreSQL dependency tracking, not text replacement:
  // references to auth and function bodies are not rewritten or hidden. Security is
  // tested above separately; only the deliberate RLS difference is removed here.
  query("postgres", "ALTER SCHEMA app RENAME TO comparison;");
  query(
    "declarative",
    `
    DROP TABLE public.unrelated;
    DO $$ DECLARE t record; BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.tablename);
      END LOOP;
    END $$;
    ALTER SCHEMA public RENAME TO comparison;
  `,
  );
  if (dump("postgres", "comparison", true) !== dump("declarative", "comparison", true))
    throw new Error("Public copy structure/behavior differs from replayed Drizzle history.");
  console.info(
    "PostgreSQL 17 parity: namespace-normalized structure matches; public security and side-by-side isolation pass.",
  );
} finally {
  if (started) docker(["rm", "--force", container]);
}
