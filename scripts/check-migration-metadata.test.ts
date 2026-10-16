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
import { entries } from "../drizzle/meta/_journal.json";
import { scripts } from "../package.json";

const latestEntry = entries[entries.length - 1];
const latestSnapshot = `${String(latestEntry.idx).padStart(4, "0")}_snapshot.json`;

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

function check() {
  return spawnSync("bun", ["run", "db:check:migrations"], {
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
  rmSync(join(fixture, "drizzle/meta", latestSnapshot));
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Missing snapshot: meta/${latestSnapshot}`);
});

it("rejects a journal entry with missing SQL", () => {
  rmSync(join(fixture, "drizzle", `${latestEntry.tag}.sql`));
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Missing SQL: ${latestEntry.tag}.sql`);
});

it.each([
  ["drizzle/orphan.sql", "Orphan SQL: orphan.sql"],
  ["drizzle/meta/9999_snapshot.json", "Orphan snapshot: 9999_snapshot.json"],
])("rejects orphan migration files: %s", (path, message) => {
  writeFileSync(join(fixture, path), "{}");
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
  const diagnostic = result.stderr
    .split("\n")
    .find((line) => line.startsWith("{"));
  expect(diagnostic).toBeDefined();
  expect(
    JSON.parse(diagnostic ?? "{}").message.split("\n").length,
  ).toBeLessThanOrEqual(5);
});

it("reports schema drift when a rename needs an interactive answer", () => {
  const path = join(fixture, "src/db/schema.ts");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      'timestamp("created_at",',
      'timestamp("guardrail_renamed_created_at",',
    ),
  );
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Schema drift detected (rename needs an interactive answer): run bun run db:generate.",
  );
});

it("rejects journal entries whose tag prefix disagrees with their index", () => {
  const path = join(fixture, "drizzle/meta/_journal.json");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      `"idx": ${latestEntry.idx}`,
      `"idx": ${latestEntry.idx - 1}`,
    ),
  );
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Invalid journal entry");
});

it("rejects colliding snapshot parents", () => {
  const previousEntry = entries[entries.length - 2];
  const previousSnapshot = `${String(previousEntry.idx).padStart(4, "0")}_snapshot.json`;
  const previous = JSON.parse(
    readFileSync(join(fixture, "drizzle/meta", previousSnapshot), "utf8"),
  );
  const path = join(fixture, "drizzle/meta", latestSnapshot);
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  snapshot.prevId = previous.prevId;
  writeFileSync(path, JSON.stringify(snapshot));
  const result = check();
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain("collision");
});
