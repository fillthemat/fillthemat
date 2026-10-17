/**
 * Upserts the local Supabase URL and publishable key into .env.local.
 *
 * Usage:
 *   bun scripts/env-upsert.ts
 */
export async function envUpsertVars(): Promise<Record<string, string>> {
  const LOCAL_ENV_FILE = ".env.local";
  const envFile = Bun.file(LOCAL_ENV_FILE);

  let lines = (await envFile.exists()) ? (await envFile.text()).split("\n") : [];
  const updated: Record<string, string> = {};

  // Set Supabase vars
  const SUPABASE_MAPPINGS = [
    ["DB_URL", "DATABASE_URL"],
    ["DB_URL", "DIRECT_URL"],
    ["API_URL", "NEXT_PUBLIC_SUPABASE_URL"],
    ["PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
  ] as const;
  const proc = Bun.spawn(["supabase", "status", "--env", "--output-format", "json"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const supabaseEnv = (await new Response(proc.stdout).json()) as Record<string, string>;
  console.log(`supabaseEnv: ${JSON.stringify(supabaseEnv)}`);

  for (const [sourceKey, targetKey] of SUPABASE_MAPPINGS) {
    const value = supabaseEnv[sourceKey];
    if (value === undefined) {
      console.warn(`Key "${sourceKey}" not found in input, skipping`);
      continue;
    }

    updated[targetKey] = String(value);
    const line = `${targetKey}=${JSON.stringify(String(value))}`;
    const index = lines.findIndex((l) => l.startsWith(`${targetKey}=`));
    if (index >= 0) lines[index] = line;
    else lines.splice(lines.at(-1) === "" ? -1 : lines.length, 0, line);
  }

  // Set other vars
  const LOCAL_SITE_URL = "http://127.0.0.1:3000";
  const generateSecret = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
  const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

  const MAPPINGS = [
    ["NEXT_PUBLIC_SITE_URL", LOCAL_SITE_URL],
    ["CRON_SECRET", generateSecret()],
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", TURNSTILE_TEST_SITE_KEY],
    ["TURNSTILE_SECRET_KEY", TURNSTILE_TEST_SECRET_KEY],
    ["ALLOW_SELF_APPROVAL", "true"],
    ["NEXT_PUBLIC_DEV_AUTH", "true"],
  ];

  for (const [key, value] of MAPPINGS) {
    updated[key] = String(value);
    const line = `${key}=${JSON.stringify(String(value))}`;
    const index = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (index >= 0) lines[index] = line;
    else lines.splice(lines.at(-1) === "" ? -1 : lines.length, 0, line);
  }

  await Bun.write(LOCAL_ENV_FILE, lines.join("\n").replace(/\n?$/, "\n"));
  return updated;
}
