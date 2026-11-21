import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_TOKEN_ENV_VARS } from "@/lib/ai/gateway-token";
import { loadLocalEnv, localDatabaseUrl } from "./integration-env";

describe("loadLocalEnv", () => {
  let dir = "";

  function writeEnvFile(lines: string[]): string {
    const file = join(dir, ".env.local");
    writeFileSync(file, lines.join("\n"));
    return file;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fillthemat-env-"));
    vi.stubEnv("SUPABASE_DB_URL", undefined);
    for (const name of GATEWAY_TOKEN_ENV_VARS) vi.stubEnv(name, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads .env.local without its AI Gateway credentials", () => {
    const envFile = writeEnvFile([
      "SUPABASE_DB_URL=postgres://from-env-file",
      "VERCEL_OIDC_TOKEN=from-env-file",
      "AI_GATEWAY_API_KEY=from-env-file",
    ]);

    loadLocalEnv(envFile);

    expect(process.env.SUPABASE_DB_URL).toBe("postgres://from-env-file");
    expect(process.env.VERCEL_OIDC_TOKEN).toBeUndefined();
    expect(process.env.AI_GATEWAY_API_KEY).toBeUndefined();
  });

  it("names the env file it loaded when SUPABASE_DB_URL is still missing", () => {
    const envFile = writeEnvFile(["RESEND_FROM=onboarding@resend.dev"]);

    expect(() => loadLocalEnv(envFile)).toThrow(
      `SUPABASE_DB_URL is not set after loading ${envFile}.`,
    );
  });

  it("removes AI Gateway credentials exported in the shell", () => {
    const envFile = writeEnvFile(["SUPABASE_DB_URL=postgres://from-env-file"]);
    vi.stubEnv("VERCEL_OIDC_TOKEN", "from-shell");
    vi.stubEnv("AI_GATEWAY_API_KEY", "from-shell");

    loadLocalEnv(envFile);

    expect(process.env.VERCEL_OIDC_TOKEN).toBeUndefined();
    expect(process.env.AI_GATEWAY_API_KEY).toBeUndefined();
  });
});

describe("localDatabaseUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["localhost", "127.0.0.1", "[::1]"])("accepts %s", (host) => {
    const url = `postgres://postgres:postgres@${host}:54322/postgres`;
    vi.stubEnv("SUPABASE_DB_URL", url);
    expect(localDatabaseUrl()).toBe(url);
  });

  it("rejects remote fixture connections", () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://postgres@db.example.com/postgres");
    expect(() => localDatabaseUrl()).toThrow("Integration fixtures require a local database");
  });

  it("rejects missing fixture credentials", () => {
    vi.stubEnv("SUPABASE_DB_URL", undefined);
    expect(() => localDatabaseUrl()).toThrow("SUPABASE_DB_URL is not set");
  });
});
