// Drizzle was removed; only SUPABASE_DB_URL is still needed for test fixtures.
export const RETIRED_LOCAL_KEYS = ["DATABASE_URL", "DIRECT_URL"];

export function missingRequiredKeys(): string[] {
  const REQUIRED_LOCAL_KEYS = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "NEXT_PUBLIC_SITE_URL",
    "CRON_SECRET",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "TURNSTILE_SECRET_KEY",
  ];
  return REQUIRED_LOCAL_KEYS.filter((key) => !process.env[key]);
}

export async function getSupabaseEnv(): Promise<Record<string, string>> {
  const proc = Bun.spawn(["supabase", "status", "--env", "--output-format", "json"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const supabaseEnv = (await new Response(proc.stdout).json()) as Record<string, string>;
  return supabaseEnv;
}

export async function upsertEnv(
  env_file_name: string,
  updates: Record<string, string>,
): Promise<Record<string, string>> {
  const envFile = Bun.file(env_file_name);
  let lines = (await envFile.exists()) ? (await envFile.text()).split("\n") : [];
  const updated: Record<string, string> = {};

  const upsertLines = (key: string, value: string) => {
    updated[key] = value;
    const line = `${key}=${value}`;
    const index = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (index >= 0) lines[index] = line;
    else lines.splice(lines.at(-1) === "" ? -1 : lines.length, 0, line);
  };

  for (const [key, value] of Object.entries(updates)) {
    upsertLines(key, value);
  }

  await Bun.write(env_file_name, lines.join("\n").replace(/\n?$/, "\n"));
  return updated;
}

export async function removeEnv(env_file_name: string, keys: string[]): Promise<string[]> {
  const envFile = Bun.file(env_file_name);
  if (!(await envFile.exists())) return [];

  const contents = await envFile.text();
  const removed = new Set<string>();
  const lines = contents.split("\n").filter((line) => {
    const key = keys.find((key) => line.startsWith(`${key}=`));
    if (key === undefined) return true;
    removed.add(key);
    return false;
  });

  if (removed.size > 0) {
    const remaining = lines.join("\n");
    await Bun.write(env_file_name, remaining || (contents.endsWith("\n") ? "\n" : ""));
  }
  return [...removed];
}
