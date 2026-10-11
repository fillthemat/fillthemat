import { spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: unknown;
};
type Result = { status: number; stdout: string; stderr: string };
type Cli = (args: string[]) => CliResult;

const PROJECT = "prj_LMCslFWBFnxPN3ISKqidTBp3kIA7";
const SCOPE = "fillthemat";
const ROUTES = new Set([
  "/api/bookings",
  "/api/bookings/key",
  "/api/chat",
  "/api/leads",
  "/api/sessions",
  "/api/slots",
  "/api/cron/maintenance",
  "/api/cron/whatsapp",
  "/api/webhooks/resend",
  "/api/webhooks/whatsapp",
]);
const ERROR_CODES = new Set([
  "too_large",
  "invalid",
  "not_found",
  "verification_failed",
  "rate_limited",
  "acknowledged",
  "ineligible",
  "invalid_slot",
  "slot_unavailable",
  "school_not_public",
  "internal_error",
]);
const DB_CODES = new Set([
  "42703",
  "42P01",
  "23505",
  "23503",
  "23502",
  "42501",
  "40001",
  "40P01",
  "53300",
  "57014",
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PLATFORM_ID = /^(?:[a-z0-9]{3,12}-\d{13}-\d{12}|req_[A-Za-z0-9]{8,80})$/;
const HELP = `Usage: bun run logs:prod --since UTC_ISO --until UTC_ISO [options]
Read-only production runtime logs for ${SCOPE}/fillthemat (${PROJECT}).
Requires Bun, network access, and authorized Vercel CLI credentials (vercel login).
Uses bunx vercel@63.1.2; first use downloads the pinned CLI.

--since / --until    Required bounded UTC timestamps: YYYY-MM-DDTHH:mm:ss[.sss]Z
--request-id ID      Exact request ID filter (optional, combined with the window)
--request-id-kind    platform (default, native Vercel filter) or app (local structured filter)
--deployment ID      Optional dpl_ ID, still constrained to production in this project/team
--limit N            Fetch cap, 1–1000 (default 100); reaching it warns of incomplete results
--help               Show this help without fetching logs

Output: sanitized JSON Lines on stdout; empty/truncation notices on stderr.
Only allowlisted metadata/diagnostic codes are retained; raw messages and unknown fields
are omitted. No raw-output mode. Exit 0 includes valid empty results; 2 means bad arguments;
CLI failures propagate a nonzero exit. See docs/agents/production-logs.md for auth recovery.
`;

function utcDate(value: string | undefined): number {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    throw new Error(
      "Supply both --since and --until as explicit UTC ISO timestamps.",
    );
  }
  const time = Date.parse(value);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().replace(".000Z", "Z") !==
      value.replace(".000Z", "Z")
  ) {
    throw new Error("Invalid UTC date.");
  }
  return time;
}

function parseArgs(args: string[]) {
  const allowed = new Set([
    "--since",
    "--until",
    "--request-id",
    "--request-id-kind",
    "--deployment",
    "--limit",
  ]);
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (
      !allowed.has(key) ||
      values[key] !== undefined ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error("Unknown, duplicate, or missing argument.");
    }
    values[key] = value;
  }
  const since = utcDate(values["--since"]);
  const until = utcDate(values["--until"]);
  if (since >= until) throw new Error("--since must precede --until.");
  const limit = values["--limit"] ?? "100";
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 1000)
    throw new Error("--limit must be 1–1000.");
  const requestId = values["--request-id"];
  if (requestId && !/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
    throw new Error("Invalid request ID.");
  const kind = values["--request-id-kind"] ?? "platform";
  if (
    !["app", "platform"].includes(kind) ||
    (values["--request-id-kind"] && !requestId)
  )
    throw new Error(
      "Request ID kind requires an ID and must be app or platform.",
    );
  const deployment = values["--deployment"];
  if (deployment && !/^dpl_[A-Za-z0-9]+$/.test(deployment))
    throw new Error("--deployment requires a dpl_ ID, not a URL.");
  return { values, since, until, limit, requestId, kind, deployment };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sanitize(record: Record<string, unknown>, timestamp: number) {
  const appRequestIds = new Set<string>();
  const diagnosticCodes = new Set<string>();
  const errorCodes = new Set<string>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 10) return;
    const fields = object(value);
    if (!fields) return;
    if (typeof fields.requestId === "string" && UUID.test(fields.requestId))
      appRequestIds.add(fields.requestId);
    for (const [key, field] of Object.entries(fields)) {
      if (
        ["code", "databaseCode", "dbCode"].includes(key) &&
        typeof field === "string" &&
        DB_CODES.has(field)
      )
        diagnosticCodes.add(field);
      if (
        ["error", "errorCode"].includes(key) &&
        typeof field === "string" &&
        ERROR_CODES.has(field)
      )
        errorCodes.add(field);
      if (key === "message" && typeof field === "string") {
        // Legacy SQL errors are sensitive prose: classify explicit codes, never emit the message.
        for (const match of field.matchAll(
          /\bcode["']?\s*[:=]\s*["']?([A-Z0-9]{5})\b/g,
        )) {
          if (DB_CODES.has(match[1])) diagnosticCodes.add(match[1]);
        }
        try {
          visit(JSON.parse(field), depth + 1);
        } catch {
          /* Unstructured prose is omitted. */
        }
      } else if (Array.isArray(field)) {
        for (const item of field) visit(item, depth + 1);
      } else if (typeof field === "object") visit(field, depth + 1);
    }
  };
  // Inspect only log records/messages, not request headers, provider payloads, or arbitrary fields.
  visit({ message: record.message, logs: record.logs });
  const route =
    typeof record.requestPath === "string"
      ? record.requestPath.split("?")[0]
      : "";
  const output: Record<string, unknown> = {
    timestamp: new Date(timestamp).toISOString(),
  };
  if (typeof record.id === "string" && PLATFORM_ID.test(record.id))
    output.requestId = record.id;
  if (
    typeof record.requestMethod === "string" &&
    /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(record.requestMethod)
  )
    output.method = record.requestMethod;
  output.route = ROUTES.has(route) ? route : "[redacted]";
  if (
    Number.isInteger(record.responseStatusCode) &&
    Number(record.responseStatusCode) >= 100 &&
    Number(record.responseStatusCode) <= 599
  )
    output.status = record.responseStatusCode;
  if (["info", "warning", "error", "fatal"].includes(String(record.level)))
    output.level = record.level;
  if (appRequestIds.size) output.appRequestIds = [...appRequestIds];
  if (diagnosticCodes.size) output.diagnosticCodes = [...diagnosticCodes];
  if (errorCodes.size) output.errorCodes = [...errorCodes];
  output.redacted = true;
  return { output, appRequestIds };
}

export function runProductionLogs(args: string[], cli: Cli): Result {
  if (args.length === 1 && args[0] === "--help")
    return { status: 0, stdout: HELP, stderr: "" };
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs(args);
  } catch (error) {
    return {
      status: 2,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : "Invalid arguments."} Run bun run logs:prod --help.\n`,
    };
  }
  const command = [
    "logs",
    "--project",
    PROJECT,
    "--scope",
    SCOPE,
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
    "--since",
    options.values["--since"],
    "--until",
    options.values["--until"],
    "--limit",
    options.limit,
  ];
  if (options.deployment) command.push("--deployment", options.deployment);
  if (options.requestId && options.kind === "platform")
    command.push("--request-id", options.requestId);
  let result: CliResult;
  try {
    result = cli(command);
  } catch {
    return {
      status: 1,
      stdout: "",
      stderr:
        "Could not run Vercel CLI. Check Bun/network availability; see docs/agents/production-logs.md. Raw errors suppressed.\n",
    };
  }
  if (result.error || result.status === null)
    return {
      status: 1,
      stdout: "",
      stderr:
        "Vercel CLI did not complete (spawn/timeout/buffer failure). Check Bun/network; narrow the window or limit. Raw errors suppressed.\n",
    };
  if (result.status !== 0) {
    const auth =
      /no existing credentials|not logged|unauthori[sz]ed|\b401\b|authentication|token.*(?:invalid|not valid|expired)|credentials.*(?:invalid|expired)/i.test(
        result.stderr + result.stdout,
      );
    const hint = auth
      ? "Vercel authentication failed. Manual-auth handoff: ask an authorized human to run bunx vercel@63.1.2 login (vercel login), then whoami, teams ls and project inspect fillthemat --scope fillthemat; retry this command. Never print tokens."
      : "Vercel logs query failed. Verify project/team access, time window, deployment and retention; check whoami and teams ls. If credentials are stale, ask a human to run vercel login and retry.";
    return {
      status: result.status,
      stdout: "",
      stderr: `${hint} CLI diagnostics suppressed; see docs/agents/production-logs.md.\n`,
    };
  }
  const lines = result.stdout.split("\n").filter((line) => line.trim());
  const output: string[] = [];
  try {
    for (const line of lines) {
      const record = object(JSON.parse(line));
      if (
        !record ||
        typeof record.timestamp !== "number" ||
        !Number.isFinite(record.timestamp) ||
        Math.abs(record.timestamp) > 8.64e15 ||
        typeof record.environment !== "string" ||
        typeof record.projectId !== "string"
      )
        throw new Error("format");
      if (
        record.environment !== "production" ||
        record.projectId !== PROJECT ||
        record.timestamp < options.since ||
        record.timestamp > options.until
      )
        continue;
      if (options.deployment && record.deploymentId !== options.deployment)
        continue;
      if (
        options.requestId &&
        options.kind === "platform" &&
        record.id !== options.requestId
      )
        continue;
      const safe = sanitize(record, record.timestamp);
      if (
        options.requestId &&
        options.kind === "app" &&
        !safe.appRequestIds.has(options.requestId)
      )
        continue;
      output.push(JSON.stringify(safe.output));
    }
  } catch {
    return {
      status: 1,
      stdout: "",
      stderr:
        "Unexpected Vercel JSON log format; raw output suppressed. Verify the pinned CLI and guide.\n",
    };
  }
  let stderr = output.length
    ? `Returned ${output.length} sanitized record(s); raw messages omitted.\n`
    : "No matching records returned in this window (not proof of no incident).\n";
  if (
    lines.length >= Number(options.limit) ||
    /truncat|more results|limit reached/i.test(result.stderr)
  )
    stderr +=
      "Results may be incomplete: fetch cap/truncation reached. Narrow the time window; see the guide.\n";
  return {
    status: 0,
    stdout: output.length ? `${output.join("\n")}\n` : "",
    stderr,
  };
}

function invokeVercel(args: string[]): CliResult {
  // An empty, private cwd prevents stale links, local config and implicit worktree branch filters.
  const cwd = mkdtempSync(join(tmpdir(), "fillthemat-logs-"));
  try {
    return spawnSync("bunx", ["vercel@63.1.2", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } finally {
    rmdirSync(cwd);
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const result = runProductionLogs(process.argv.slice(2), invokeVercel);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status;
}
