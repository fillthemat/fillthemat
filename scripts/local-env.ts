import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseEnv } from "node:util";

export const REQUIRED_LOCAL_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "CRON_SECRET",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
] as const;

export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const parsed = parseEnv(readFileSync(path, "utf8"));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function writeEnvFile(path: string, vars: Record<string, string>) {
  mkdirSync(dirname(path) || ".", { recursive: true });
  const body = Object.entries(vars)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
  writeFileSync(path, `# Generated/merged by bun run setup. Do not commit.\n\n${body}\n`);
}

export function missingRequiredKeys(env: Record<string, string>): string[] {
  return REQUIRED_LOCAL_KEYS.filter((key) => !env[key]);
}
