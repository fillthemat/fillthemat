import { expect, it } from "vitest";
import { buildArgs, needsLogin, redact } from "./logs-prod";

it("passes native filters through with a fixed read-only production target", () => {
  const filters = [
    "--since",
    "1h",
    "--until",
    "2026-10-11T18:02:00Z",
    "--request-id",
    "gnktd-1791741629602-003823914326",
    "--status-code",
    "5xx",
    "--query",
    "booking error",
    "--limit",
    "10",
  ];
  expect(buildArgs(filters)).toEqual([
    "logs",
    "--project",
    "prj_LMCslFWBFnxPN3ISKqidTBp3kIA7",
    "--scope",
    "fillthemat",
    "--environment",
    "production",
    "--non-interactive",
    "--no-color",
    ...filters,
  ]);
});

it.each([
  ["No existing credentials found. Please run vercel login", true],
  ["Not logged in", true],
  ["401 Unauthorized", true],
  ["Your token is not valid", true],
  ["Authentication failed", true],
  ["Project not found", false],
  ["Invalid time window", false],
  ["403 Forbidden: missing project permission", false],
  ["", false],
])("offers login recovery only for auth failures: %s", (output, expected) => {
  expect(needsLogin(output)).toBe(expected);
});

it.each([
  "jane@example.test",
  "jane%40example.com",
  "+44 7700 900123",
  "07700 900123",
  "020 7946 0958",
  "(415) 555-0123",
  "4155550123",
  "Bearer secret-token",
  "Authorization: Basic dXNlcjpwYXNz",
  "Basic dXNlcjpwYXNz",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
  "api_key=secret-value",
  '"apiKey":"secret-value"',
  "sk-proj-secret-value",
  "password=hunter2",
  "sb_secret_private-value",
  "whsec_private-value",
  "rk_live_private-value",
  "sk_live_private-value",
  "Cookie: session=secret; other=value",
  "Set-Cookie: session=secret; HttpOnly",
  '\\"cookie\\":\\"session=secret; other=value\\"',
])("redacts contact details and credentials: %s", (secret) => {
  expect(redact(`SQL error 42703 ${secret}`)).toBe(
    "SQL error 42703 [redacted]",
  );
});

it("keeps useful diagnostics, timestamps and request IDs", () => {
  const safe =
    "2026-10-11T18:00:29.602Z POST /api/bookings 500 gnktd-1791741629602-003823914326 code: 42703";
  expect(redact(safe)).toBe(safe);
});

it.each([
  ["--project", "other"],
  ["--scope", "other"],
  ["--environment", "preview"],
  ["deploy"],
  ["--follow"],
  ["--since=1h"],
  ["--query"],
  ["--query", "--environment"],
])("rejects target overrides and unsupported arguments: %j", (...args) => {
  expect(() => buildArgs(args)).toThrow();
});
