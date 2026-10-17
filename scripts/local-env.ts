import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseEnv } from "node:util";
import { APP_PORTS, localSiteUrl } from "./local-ports";

export const LOCAL_SITE_URL = localSiteUrl(APP_PORTS[0]);

/** Cloudflare Turnstile always-pass dummy keys (public, safe for local). */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

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

export type SupabaseStatusEnv = {
  apiUrl: string;
  publishableKey: string;
  dbUrl: string;
  studioUrl?: string;
  inbucketUrl?: string;
  serviceRoleKey?: string;
};

/** Parse `supabase status -o env` (`API_URL`, `ANON_KEY`, `DB_URL`, …). */
export function parseSupabaseStatusEnv(text: string): SupabaseStatusEnv {
  const env = parseEnv(text);
  const apiUrl = env.API_URL;
  const publishableKey = env.ANON_KEY;
  const dbUrl = env.DB_URL;
  if (!apiUrl || !publishableKey || !dbUrl) {
    throw new Error(
      "Could not read API_URL/ANON_KEY/DB_URL from supabase status. Is the local stack running?",
    );
  }
  return {
    apiUrl,
    publishableKey,
    dbUrl,
    studioUrl: env.STUDIO_URL,
    inbucketUrl: env.INBUCKET_URL,
    serviceRoleKey: env.SERVICE_ROLE_KEY,
  };
}

export function mergeLocalEnv(
  existing: Record<string, string>,
  status: SupabaseStatusEnv,
  generatedSecret: string,
  siteUrl = LOCAL_SITE_URL,
): Record<string, string> {
  const { PORT: _droppedPort, ...kept } = existing;
  return {
    ...kept,
    DATABASE_URL: status.dbUrl,
    DIRECT_URL: status.dbUrl,
    NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
    NEXT_PUBLIC_SITE_URL: siteUrl,
    CRON_SECRET: existing.CRON_SECRET || generatedSecret,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      existing.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITE_KEY,
    TURNSTILE_SECRET_KEY: existing.TURNSTILE_SECRET_KEY || TURNSTILE_TEST_SECRET_KEY,
    ALLOW_SELF_APPROVAL: existing.ALLOW_SELF_APPROVAL || "true",
    NEXT_PUBLIC_DEV_AUTH: existing.NEXT_PUBLIC_DEV_AUTH || "true",
  };
}

export function missingRequiredKeys(env: Record<string, string>): string[] {
  return REQUIRED_LOCAL_KEYS.filter((key) => !env[key]);
}
