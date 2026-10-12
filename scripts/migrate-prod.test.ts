import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { scripts } from "../package.json";

it("shares the production script, refuses unsafe targets and redacts failures", () => {
  expect(scripts["db:migrate:deploy"]).toBe(
    "bun --no-env-file scripts/migrate-prod.ts",
  );
  expect(scripts["db:migrate:prod"]).toContain(
    "--env-file=.env.production.local scripts/migrate-prod.ts",
  );
  const preview = spawnSync(
    "sh",
    ["-c", `bun() { echo "$*"; }; ${scripts["build:vercel"]}`],
    {
      env: { ...process.env, VERCEL_ENV: "preview" },
      encoding: "utf8",
    },
  );
  expect(preview.status).toBe(0);
  expect(preview.stdout.trim()).toBe("run build");
  for (const [environment, host, vercel = ""] of [
    ["development", "host.invalid"],
    ["", "localhost"],
    ["production", "127.0.0.2"],
    ["production", "[::1]"],
    ["production", ""],
    ["", "host.invalid", "1"],
    ["", "host.invalid"],
  ]) {
    const result = spawnSync("bun", ["run", "db:migrate:deploy"], {
      env: {
        ...process.env,
        VERCEL: vercel,
        VERCEL_ENV: environment,
        DIRECT_URL: host
          ? `postgres://private_user:private_password@${host}/private_db`
          : "",
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("Production migration failed");
    if (!vercel && environment === "" && host === "host.invalid")
      expect(result.stderr).toContain('"code":"ENOTFOUND"');
    for (const secret of [
      "private_user",
      "private_password",
      "private_db",
      host,
    ].filter(Boolean))
      expect(result.stderr).not.toContain(secret);
  }
});
