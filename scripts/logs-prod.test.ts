import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import projectPackage from "../package.json";
import jsonStringLog from "./fixtures/vercel-json-string-log.json";
import { runProductionLogs } from "./logs-prod";

const window = [
  "--since",
  "2026-10-11T17:59:00Z",
  "--until",
  "2026-10-11T18:02:00Z",
];
const emptyCli = () => ({ status: 0, stdout: "", stderr: "" });
const platformId = "gnktd-1791741629602-003823914326";
const appId = "550e8400-e29b-41d4-a716-446655440000";
const record = {
  id: platformId,
  timestamp: 1791741629602,
  projectId: "prj_LMCslFWBFnxPN3ISKqidTBp3kIA7",
  requestMethod: "POST",
  requestPath: "/api/bookings",
  responseStatusCode: 500,
  environment: "production",
  source: "serverless-middleware",
  level: "error",
  logs: [
    {
      level: "error",
      message:
        "Error: SQL select contact from bookings; params Jane Doe age 12 jane@example.test +44 7700 900123 192.0.2.1 authorization Bearer secret-token code: '42703'",
    },
  ],
};
const jsonCli = (records: unknown[]) => (_args?: string[]) => ({
  status: 0,
  stdout: records.map((r) => JSON.stringify(r)).join("\n"),
  stderr: "",
});

describe("production logs command", () => {
  it("exposes the pinned CLI and documents only package-script commands", () => {
    expect(projectPackage.devDependencies.vercel).toBe("63.1.2");
    expect(projectPackage.scripts.vercel).toBe("vercel");
    const guide = readFileSync(
      fileURLToPath(
        new URL("../docs/agents/production-logs.md", import.meta.url),
      ),
      "utf8",
    );
    const help = runProductionLogs(["--help"], emptyCli).stdout;
    expect(guide).not.toMatch(/\bbunx\b|\bbun\s+(?:--\S+\s+)*scripts\//);
    expect(help).not.toMatch(/\bbunx\b|\bbun\s+(?:--\S+\s+)*scripts\//);
    for (const text of [guide, help]) {
      for (const match of text.matchAll(/\bbun run ([\w:-]+)/g)) {
        expect(projectPackage.scripts).toHaveProperty(match[1]);
      }
    }
  });

  it("documents prerequisites and target without invoking Vercel", () => {
    const cli = vi.fn(emptyCli);
    const result = runProductionLogs(["--help"], cli);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--request-id-kind");
    expect(result.stdout).toContain("bun run vercel login");
    expect(result.stdout).toContain("prj_LMCslFWBFnxPN3ISKqidTBp3kIA7");
    expect(cli).not.toHaveBeenCalled();
  });

  it.each(
    [
      [],
      ["--since", window[1]],
      ["--since", "yesterday", "--until", window[3]],
      ["--since", "2026-02-30T18:00:00Z", "--until", window[3]],
      ["--since", "2026-10-11T18:03:00Z", "--until", window[3]],
      ["--since", "2026-10-11T18:00:00+01:00", "--until", window[3]],
      [...window, "--follow"],
      [...window, "--project", "other"],
      [...window, "--limit", "0"],
      [...window, "--since", window[1]],
      [...window, "--request-id", "a@b.com"],
      [...window, "--request-id-kind", "app"],
      [...window, "--request-id", platformId, "--request-id-kind", "app"],
      [...window, "--request-id", "not-a-uuid", "--request-id-kind", "app"],
      [...window, "--deployment", "https://other.vercel.app"],
    ].map((args) => ({ args })),
  )("rejects invalid/unbounded arguments before fetching: %j", ({ args }) => {
    const cli = vi.fn(emptyCli);
    const result = runProductionLogs(args, cli);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("logs:prod --help");
    expect(cli).not.toHaveBeenCalled();
  });

  it("uses the explicit production target, bounded window, runtime sources and native platform ID", () => {
    const cli = vi.fn(emptyCli);
    const result = runProductionLogs(
      [
        ...window,
        "--request-id",
        "gnktd-1791741629602-003823914326",
        "--deployment",
        "dpl_example",
      ],
      cli,
    );
    expect(cli).toHaveBeenCalledWith([
      "logs",
      "--project",
      "prj_LMCslFWBFnxPN3ISKqidTBp3kIA7",
      "--scope",
      "fillthemat",
      "--environment",
      "production",
      "--json",
      "--non-interactive",
      "--no-color",
      "--source",
      "serverless",
      "--source",
      "edge-function",
      "--source",
      "edge-middleware",
      ...window,
      "--limit",
      "100",
      "--deployment",
      "dpl_example",
      "--request-id",
      "gnktd-1791741629602-003823914326",
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("No matching records");
  });

  it("retains safe incident metadata and a classified DB code, never raw PII/SQL/secrets", () => {
    const result = runProductionLogs(
      window,
      jsonCli([
        {
          ...record,
          email: "jane@example.test",
          headers: { cookie: "session-secret" },
          age: 12,
          name: "Jane Doe",
          payload: "provider secret",
        },
      ]),
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      timestamp: "2026-10-11T18:00:29.602Z",
      requestId: platformId,
      method: "POST",
      route: "/api/bookings",
      status: 500,
      level: "error",
      diagnosticCodes: ["42703"],
      redacted: true,
    });
    for (const forbidden of [
      "Jane",
      "jane@",
      "7700",
      "192.0.2.1",
      "Bearer",
      "secret",
      "select",
      "params",
      "provider",
    ]) {
      expect(result.stdout).not.toContain(forbidden);
    }
  });

  it("combines the window and exact platform ID, excluding other targets and out-of-window records", () => {
    const result = runProductionLogs(
      [...window, "--request-id", platformId],
      jsonCli([
        record,
        { ...record, timestamp: 1791741400000 },
        { ...record, timestamp: 1791742000000 },
        { ...record, id: "gnktd-1791741629602-000000000000" },
        { ...record, environment: "preview" },
        { ...record, projectId: "prj_other" },
      ]),
    );
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout).requestId).toBe(platformId);
  });

  it("matches the Vercel message shape of console.error(JSON.stringify(record)), not native platform search or raw substrings", () => {
    const cli = vi.fn(
      jsonCli([
        jsonStringLog,
        { ...record, logs: [{ message: `SQL params ${appId}` }] },
        {
          ...record,
          logs: [
            {
              message: JSON.stringify({
                requestId: "550e8400-e29b-41d4-a716-446655440001",
              }),
            },
          ],
        },
      ]),
    );
    const result = runProductionLogs(
      [...window, "--request-id", appId, "--request-id-kind", "app"],
      cli,
    );
    expect(cli.mock.calls[0][0]).not.toContain("--request-id");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      appRequestIds: [appId],
      errorCodes: ["internal_error"],
      diagnosticCodes: ["42703"],
    });
    expect(result.stdout).not.toContain("private");
  });

  it("drops unknown routes, IDs, method/level values and error codes rather than trusting their field names", () => {
    const result = runProductionLogs(
      window,
      jsonCli([
        {
          ...record,
          id: "secret-token",
          requestMethod: "jane@example.test",
          level: "Bearer secret",
          requestPath: "/s/Jane?token=secret",
          logs: [
            {
              message: JSON.stringify({
                requestId: "secret-token",
                error: "secret-token",
                code: "secret-token",
              }),
            },
          ],
        },
      ]),
    );
    expect(JSON.parse(result.stdout)).toEqual({
      timestamp: "2026-10-11T18:00:29.602Z",
      route: "[redacted]",
      status: 500,
      redacted: true,
    });
  });

  it("reports the fetch cap before local filtering, so zero matches are not called complete", () => {
    const result = runProductionLogs(
      [
        ...window,
        "--limit",
        "1",
        "--request-id",
        appId,
        "--request-id-kind",
        "app",
      ],
      jsonCli([record]),
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("No matching records");
    expect(result.stderr).toContain("incomplete");
  });

  it("rejects malformed JSON/schema without echoing raw output or returning partial success", () => {
    for (const stdout of [
      "secret-token",
      `${JSON.stringify(record)}\nsecret-token`,
      "null",
      JSON.stringify({ message: "secret-token" }),
    ]) {
      const result = runProductionLogs(window, () => ({
        status: 0,
        stdout,
        stderr: "",
      }));
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("format");
      expect(result.stderr).not.toContain("secret-token");
    }
  });

  it.each([
    "No existing credentials found. Please run bun run vercel login",
    "Your token is not valid",
    "401 Unauthorized",
    "Authentication failed",
  ])(
    "gives a manual auth recovery hint without disclosing credentials: %s",
    (message) => {
      const result = runProductionLogs(window, () => ({
        status: 1,
        stdout: JSON.stringify(record),
        stderr: `${message} Bearer secret-token user@example.test`,
      }));
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("bun run vercel login");
      expect(result.stderr).toContain("whoami");
      expect(result.stderr).toContain("teams ls");
      expect(result.stderr).toContain("Manual-auth handoff");
      for (const command of [
        "bun run vercel login",
        "bun run vercel whoami",
        "bun run vercel teams ls",
        "bun run vercel project inspect fillthemat --scope fillthemat",
      ]) {
        expect(result.stderr.split("\n")).toContain(command);
      }
      expect(result.stderr).not.toContain("secret-token");
      expect(result.stderr).not.toContain("user@");
    },
  );

  it("propagates query/access failures and distinguishes them from valid empty results", () => {
    const result = runProductionLogs(window, () => ({
      status: 7,
      stdout: "",
      stderr: "Project not found secret-token",
    }));
    expect(result.status).toBe(7);
    expect(result.stderr).toContain("project/team access");
    expect(result.stderr).not.toContain("No matching records");
    expect(result.stderr).not.toContain("secret-token");
  });

  it("reserves exit 2 for argument errors, mapping Vercel exit 2 to 1", () => {
    const result = runProductionLogs(window, () => ({
      status: 2,
      stdout: "",
      stderr: "Query failed",
    }));
    expect(result.status).toBe(1);
    expect(runProductionLogs(["--help"], emptyCli).stdout).toContain(
      "CLI exit 2 maps to 1",
    );
  });

  it("handles child process timeout, missing executable and thrown invocation without raw errors", () => {
    for (const cli of [
      () => ({
        status: null,
        stdout: "secret-token",
        stderr: "",
        error: new Error("ETIMEDOUT secret-token"),
      }),
      () => {
        throw new Error("ENOENT secret-token");
      },
    ]) {
      const result = runProductionLogs(window, cli);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Bun/network");
      expect(result.stderr).not.toContain("secret-token");
    }
  });

  it("reports CLI truncation warnings even below the cap, without echoing stderr", () => {
    const result = runProductionLogs(window, () => ({
      ...jsonCli([record])(),
      stderr: "results truncated secret-token",
    }));
    expect(result.stderr).toContain("incomplete");
    expect(result.stderr).not.toContain("secret-token");
  });

  it.each([
    { status: 0, blocked: false },
    { status: 7, blocked: false },
    { status: 0, blocked: true },
    { status: 7, blocked: true },
  ])(
    "recursively cleans CLI files without masking the result: %j",
    ({ status, blocked }) => {
      const folder = mkdtempSync(join(tmpdir(), "logs-prod-test-"));
      const marker = join(folder, "cwd");
      let cliCwd: string | undefined;
      try {
        mkdirSync(join(folder, "node_modules/.bin"), { recursive: true });
        mkdirSync(join(folder, "scripts"));
        copyFileSync(
          fileURLToPath(new URL("./logs-prod.ts", import.meta.url)),
          join(folder, "scripts/logs-prod.ts"),
        );
        writeFileSync(
          join(folder, "package.json"),
          JSON.stringify({
            scripts: { "logs:prod": projectPackage.scripts["logs:prod"] },
          }),
        );
        writeFileSync(join(folder, "vercel"), "#!/bin/sh\nexit 9\n", {
          mode: 0o700,
        });
        writeFileSync(
          join(folder, "node_modules/.bin/vercel"),
          `#!/bin/sh
mkdir cli-cache
printf 'raw-secret' > cli-cache/log
printf '%s' "$PWD" > "$CWD_RECORD"
if [ "$BLOCK_CLEANUP" = 1 ]; then chmod 500 cli-cache; fi
exit "$CLI_STATUS"
`,
          { mode: 0o700 },
        );
        const result = spawnSync("bun", ["run", "logs:prod", ...window], {
          cwd: folder,
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            PATH: `${folder}:${process.env.PATH}`,
            CWD_RECORD: marker,
            BLOCK_CLEANUP: blocked ? "1" : "0",
            CLI_STATUS: String(status),
          },
        });
        cliCwd = readFileSync(marker, "utf8");
        expect(result.status).toBe(status);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(
          status === 0 ? "No matching records" : "Vercel logs query failed",
        );
        expect(result.stderr).not.toContain("raw-secret");
        if (blocked) {
          expect(result.stderr).toContain(
            "Temporary log directory cleanup failed",
          );
          expect(result.stderr).not.toContain(cliCwd);
        } else {
          expect(existsSync(cliCwd)).toBe(false);
        }
      } finally {
        if (cliCwd && existsSync(cliCwd)) {
          if (existsSync(join(cliCwd, "cli-cache")))
            chmodSync(join(cliCwd, "cli-cache"), 0o700);
          rmSync(cliCwd, { recursive: true, force: true });
        }
        rmSync(folder, { recursive: true, force: true });
      }
    },
  );
});
