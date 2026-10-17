import { spawnSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { scripts } from "../package.json";
import { migrateProduction } from "./migrate-prod";

const transport = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  migrate: vi.fn(),
}));
vi.mock("postgres", () => ({
  default: () => Object.assign(transport.query, { end: transport.end }),
}));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/postgres-js/migrator", () => ({
  migrate: transport.migrate,
}));

it("shares the production script, refuses unsafe targets and redacts failures", () => {
  expect(scripts["db:migrate:deploy"]).toBe("bun --no-env-file scripts/migrate-prod.ts");
  expect(scripts["db:migrate:prod"]).toContain(
    "--env-file=.env.production.local scripts/migrate-prod.ts",
  );
  for (const [environment, host, vercel = ""] of [
    ["development", "host.invalid"],
    ["", "localhost"],
    ["production", "127.0.0.2"],
    ["production", "[::1]"],
    ["production", ""],
    ["", "host.invalid", "1"],
    ["", "host.invalid"],
    ["production", "host.invalid:6543"],
  ]) {
    const result = spawnSync("bun", ["run", "db:migrate:deploy"], {
      env: {
        ...process.env,
        VERCEL: vercel,
        VERCEL_ENV: environment,
        DIRECT_URL: host ? `postgres://private_user:private_password@${host}/private_db` : "",
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("Production migration failed");
    if (!vercel && environment === "" && host === "host.invalid")
      expect(
        JSON.parse(result.stderr.split("\n").find((line) => line.startsWith("{")) ?? "{}").code,
      ).toBeTypeOf("string");
    if (host.endsWith(":6543")) {
      expect(result.stderr).toContain('"code":"TRANSACTION_POOLER"');
      expect(result.stderr).toContain("Use a direct or session-pooler URL, not port 6543");
    }
    for (const secret of ["private_user", "private_password", "private_db", host].filter(Boolean))
      expect(result.stderr).not.toContain(secret);
  }
});

it("preserves the migration error when unlock or disconnect also fail", async () => {
  const original = Object.assign(new Error("SQL failed"), { code: "42P01" });
  for (const cleanup of ["unlock", "end", "both"]) {
    transport.query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    if (cleanup !== "end") transport.query.mockRejectedValueOnce(new Error("unlock failed"));
    else transport.query.mockResolvedValueOnce([]);
    transport.end.mockReset();
    if (cleanup !== "unlock") transport.end.mockRejectedValueOnce(new Error("disconnect failed"));
    transport.migrate.mockRejectedValue(original);
    await expect(migrateProduction("postgres://host.invalid/db")).rejects.toBe(original);
  }
});
