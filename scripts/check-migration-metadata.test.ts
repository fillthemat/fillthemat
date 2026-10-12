import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scripts } from "../package.json";

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "migration-check-test-"));
  mkdirSync(join(fixture, "temporary"));
  mkdirSync(join(fixture, "src/db"), { recursive: true });
  cpSync("drizzle", join(fixture, "drizzle"), { recursive: true });
  cpSync("src/db/schema.ts", join(fixture, "src/db/schema.ts"));
  cpSync("drizzle.config.ts", join(fixture, "drizzle.config.ts"));
  symlinkSync(resolve("node_modules"), join(fixture, "node_modules"), "dir");
  symlinkSync(resolve("scripts"), join(fixture, "scripts"), "dir");
  writeFileSync(join(fixture, "package.json"), JSON.stringify({ scripts }));
});

afterEach(() => {
  try {
    expect(
      readdirSync(join(fixture, "temporary")).filter((name) =>
        name.startsWith("drizzle-consistency-"),
      ),
    ).toEqual([]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function check(command = "db:check:consistency") {
  return spawnSync("bun", ["run", command], {
    cwd: fixture,
    env: {
      ...process.env,
      DATABASE_URL: "",
      DIRECT_URL: "",
      TMPDIR: join(fixture, "temporary"),
    },
    encoding: "utf8",
    timeout: 45_000,
  });
}

function migrationFiles() {
  const directory = join(fixture, "drizzle");
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".json") || file.endsWith(".sql"))
    .sort()
    .map((file) => [file, readFileSync(join(directory, file), "utf8")]);
}

it("passes unchanged history without a database or leaving generated files behind", () => {
  const before = migrationFiles();
  const result = check();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("no schema drift");
  expect(result.stdout).toContain("Everything's fine");
  expect(migrationFiles()).toEqual(before);
});

it("rejects a journal entry with a missing snapshot without database credentials", () => {
  rmSync(join(fixture, "drizzle/meta/0013_snapshot.json"));
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Missing snapshot: meta/0013_snapshot.json");
});

it.each([
  ["drizzle/0013_public_logan.sql", "Missing SQL: 0013_public_logan.sql"],
  ["drizzle/orphan.sql", "Orphan SQL: orphan.sql"],
  ["drizzle/meta/9999_snapshot.json", "Orphan snapshot: 9999_snapshot.json"],
])("rejects missing or orphan migration files: %s", (path, message) => {
  const target = join(fixture, path);
  if (path.includes("0013_public_logan")) rmSync(target);
  else writeFileSync(target, "{}");
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
});

it("rejects a schema column added without generating a migration", () => {
  const path = join(fixture, "src/db/schema.ts");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      "const timestamps = {",
      'const timestamps = { guardrailProbe: text("guardrail_probe"),',
    ),
  );
  const before = migrationFiles();
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Schema drift detected");
  expect(migrationFiles()).toEqual(before);
});

it("fails closed when Drizzle catches a schema load error but exits zero", () => {
  writeFileSync(join(fixture, "src/db/schema.ts"), 'throw new Error("probe");');
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Schema drift check could not complete");
});

it("rejects journal entries whose tag prefix disagrees with their index", () => {
  const path = join(fixture, "drizzle/meta/_journal.json");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace('"idx": 13', '"idx": 12'),
  );
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Invalid journal entry");
});

it("runs Drizzle's history check to reject colliding snapshot parents", () => {
  const previous = JSON.parse(
    readFileSync(join(fixture, "drizzle/meta/0012_snapshot.json"), "utf8"),
  );
  const path = join(fixture, "drizzle/meta/0013_snapshot.json");
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  snapshot.prevId = previous.prevId;
  writeFileSync(path, JSON.stringify(snapshot));
  const result = check("db:check:history");
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("collision");
});
