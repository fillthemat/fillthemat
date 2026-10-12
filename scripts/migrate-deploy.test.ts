import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("fails the deploy migration without logging connection secrets", () => {
  const url = "postgres://private_user:private_password@127.0.0.1:1/private_db";
  const result = spawnSync("bun", ["run", "db:migrate:deploy"], {
    env: { ...process.env, VERCEL_ENV: "production", DIRECT_URL: url },
    encoding: "utf8",
    timeout: 15_000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Deployment migration failed");
  for (const secret of [url, "private_user", "private_password", "private_db"])
    expect(result.stderr).not.toContain(secret);
});

it.each(["preview", "development", ""])(
  "does not migrate when called directly in %s",
  (environment) => {
    const result = spawnSync("bun", ["run", "db:migrate:deploy"], {
      env: { ...process.env, VERCEL_ENV: environment, DIRECT_URL: "" },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Skipping deployment migrations");
  },
);

it("requires the configured Production DIRECT_URL rather than a local env file", () => {
  const result = spawnSync("bun", ["run", "db:migrate:deploy"], {
    env: { ...process.env, VERCEL_ENV: "production", DIRECT_URL: "" },
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Deployment migration failed");
});
