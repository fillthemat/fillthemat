import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { GATEWAY_TOKEN_ENV_VARS } from "@/lib/ai/gateway-token";

/**
 * Copies the keys of `envFile` that are not set yet into `process.env`, then
 * deletes every AI Gateway token, whether it came from the file or the shell.
 * Integration tests must never call the paid AI Gateway (the main checkout's
 * .env.local has a real VERCEL_OIDC_TOKEN); without a token the assistant
 * uses its scripted local model.
 */
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
  for (const name of GATEWAY_TOKEN_ENV_VARS) delete process.env[name];
  if (!process.env.DATABASE_URL) {
    throw new Error(`DATABASE_URL is not set after loading ${envFile}.`);
  }
}

export function authSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, { prepare: false, max: 1 });
}

/**
 * Runs `work` while the database runs `statement` (PL/pgSQL) before saving
 * each of the conversation's messages with `role`, e.g. to make saving slow
 * or fail.
 */
export async function whileSavingMessages(
  sql: ReturnType<typeof postgres>,
  {
    conversationId,
    role,
    statement,
  }: {
    conversationId: string;
    role: "user" | "assistant";
    statement: string;
  },
  work: () => Promise<void>,
) {
  const name = `test_message_save_${randomUUID().replaceAll("-", "")}`;
  await sql.unsafe(
    `create function public.${name}() returns trigger language plpgsql as $$ begin ${statement}; return new; end $$`,
  );
  await sql.unsafe(
    `create trigger ${name} before insert on app.messages for each row when (new.conversation_id = '${conversationId}' and new.role = '${role}') execute function public.${name}()`,
  );
  try {
    await work();
  } finally {
    await sql.unsafe(`drop trigger ${name} on app.messages`);
    await sql.unsafe(`drop function public.${name}()`);
  }
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
