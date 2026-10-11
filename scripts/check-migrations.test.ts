import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("logs safe connection error identifiers, never the URL or credentials", () => {
  const url = "postgres://private_user:private_password@127.0.0.1:1/private_db";
  const result = spawnSync(
    "bun",
    ["--no-env-file", "scripts/check-migrations.ts"],
    {
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("code=ECONNREFUSED");
  expect(result.stderr).toContain("name=Error");
  for (const secret of [url, "private_user", "private_password", "private_db"])
    expect(result.stderr).not.toContain(secret);
});
