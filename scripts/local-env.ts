export function missingRequiredKeys(): string[] {
  const REQUIRED_LOCAL_KEYS = [
    "DATABASE_URL",
    "DIRECT_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
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
