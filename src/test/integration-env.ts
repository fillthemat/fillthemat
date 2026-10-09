import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import postgres from "postgres";

// Integration tests must never call the paid AI Gateway. A credential can come
// from .env.local (the main checkout's has a real VERCEL_OIDC_TOKEN) or from the
// shell; without one the assistant uses its scripted local model.
const AI_GATEWAY_CREDENTIALS = ["VERCEL_OIDC_TOKEN", "AI_GATEWAY_API_KEY"];

export function loadLocalEnv(envFile = ".env.local") {
  if (!existsSync(envFile)) {
    throw new Error(
      `Missing ${envFile}. Run bun run setup in this worktree first.`,
    );
  }
  const parsed = parseEnv(readFileSync(envFile, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined && !process.env[key]) process.env[key] = value;
  }
  for (const key of AI_GATEWAY_CREDENTIALS) delete process.env[key];
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set after loading .env.local.");
  }
}

export function authSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, { prepare: false, max: 1 });
}

export async function insertAuthUser(
  sql: ReturnType<typeof postgres>,
  id: string,
  email: string,
) {
  await sql`
    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new,
      raw_app_meta_data,
      raw_user_meta_data
    )
    values (
      ${id}::uuid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      ${email},
      '',
      now(),
      now(),
      now(),
      '',
      '',
      '',
      '',
      '{}'::jsonb,
      '{}'::jsonb
    )
  `;
}

export async function deleteAuthUser(
  sql: ReturnType<typeof postgres>,
  id: string,
) {
  await sql`delete from auth.users where id = ${id}::uuid`;
}

export function requireRow<T>(row: T | undefined | null, label: string): T {
  if (row == null) throw new Error(`missing ${label}`);
  return row;
}
