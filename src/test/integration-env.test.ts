import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocalEnv } from "./integration-env";

describe("loadLocalEnv", () => {
  let dir = "";

  function writeEnvFile(lines: string[]): string {
    const file = join(dir, ".env.local");
    writeFileSync(file, lines.join("\n"));
    return file;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fillthemat-env-"));
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("VERCEL_OIDC_TOKEN", undefined);
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads .env.local without its AI Gateway credentials", () => {
    const envFile = writeEnvFile([
      "DATABASE_URL=postgres://from-env-file",
      "VERCEL_OIDC_TOKEN=from-env-file",
      "AI_GATEWAY_API_KEY=from-env-file",
    ]);

    loadLocalEnv(envFile);

    expect(process.env.DATABASE_URL).toBe("postgres://from-env-file");
    expect(process.env.VERCEL_OIDC_TOKEN).toBeUndefined();
    expect(process.env.AI_GATEWAY_API_KEY).toBeUndefined();
  });

  it("removes AI Gateway credentials exported in the shell", () => {
    const envFile = writeEnvFile(["DATABASE_URL=postgres://from-env-file"]);
    vi.stubEnv("VERCEL_OIDC_TOKEN", "from-shell");
    vi.stubEnv("AI_GATEWAY_API_KEY", "from-shell");

    loadLocalEnv(envFile);

    expect(process.env.VERCEL_OIDC_TOKEN).toBeUndefined();
    expect(process.env.AI_GATEWAY_API_KEY).toBeUndefined();
  });
});
