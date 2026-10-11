# Production runtime logs

Use `bun run logs:prod --help` for the command contract. This workflow is read-only: it queries Vercel request/runtime logs, not build logs, and never deploys, migrates, changes production settings, or sends production requests to reproduce a failure.

## 1. Verify identity and target

Requires Bun, network access, and an authorized Vercel account. The wrapper downloads/runs pinned Vercel CLI **63.1.2** with `bunx`; a global installation is unnecessary. Verify access using that same version:

```bash
bunx vercel@63.1.2 whoami
bunx vercel@63.1.2 teams ls
bunx vercel@63.1.2 project inspect fillthemat --scope fillthemat
bunx vercel@63.1.2 logs --help
```

Complete when identity is the intended authorized account, team `fillthemat` is accessible, and project inspection reports ID `prj_LMCslFWBFnxPN3ISKqidTBp3kIA7`. That project belongs to team ID `team_cMaH5LMAT9HrsFfyYEwZgYfh`. Unexpected identity/project: stop and resolve access, not the local link.

The script fixes project/team and Production, querying all deployments in the window from a private non-Git directory to avoid stale links/config and implicit branch filters. Optional `--deployment dpl_...` narrows that target; verify its Production membership in the dashboard first.

**Product Preview** (a school owner's unpublished page) is application behavior; it can run on the production deployment. It is not Vercel's `preview` deployment environment.

## 2. Retrieve a bounded window or request

Both `--since` and `--until` are required: explicit UTC ISO timestamps ending in `Z`, with optional three-digit milliseconds. Relative dates and indefinite tailing are intentionally unsupported.

```bash
# Incident window, even when historical application logs lack a request ID
bun run logs:prod --since 2026-10-11T17:59:00Z --until 2026-10-11T18:02:00Z

# Vercel platform Request Id for the failed POST /api/bookings
bun run logs:prod --since 2026-10-11T17:59:00Z --until 2026-10-11T18:02:00Z --request-id gnktd-1791741629602-003823914326

# Application support reference (illustrative UUID; replace with the actual reference)
bun run logs:prod --since 2026-10-11T17:59:00Z --until 2026-10-11T18:02:00Z --request-id 550e8400-e29b-41d4-a716-446655440000 --request-id-kind app
```

**Platform ID:** Vercel's runtime Request Id, exposed as `id` in this CLI's JSON record. The default uses native `vercel logs --request-id`, then checks ID/window locally. This is distinct from an application's support reference and from an `x-vercel-id` routing header; use the runtime Logs tab's Request Id, not an assumed header equivalent.

**Application ID:** a server-generated UUID support reference. Lookup depends on the app logging one JSON string per line with `console.error(JSON.stringify(record))`, where `record.requestId` holds the reference. `--request-id-kind app` fetches the bounded window and exactly matches that field in parsed messages, never Vercel's native platform filter or free-text substrings. Missing/unstructured historical IDs: use the incident window and correlate safe route/status metadata and the platform ID. A missing ID is not proof the request never happened.

Complete when sanitized records match the window, route/status and known reference, or the result is classified as empty, incomplete, or a failure below. Stdout is sanitized JSON Lines; stderr carries notices. Raw output, unknown fields, and arbitrary exception prose are never emitted. There is no raw-output switch.

## 3. Classify the result

- **Exit 0 with records:** sanitized results, not a completeness guarantee. The CLI retrieves runtime sources (serverless, edge function/middleware), excluding build logs and static traffic.
- **Exit 0, `No matching records`:** the query succeeded but returned no matching retained records. Check UTC window, ID kind, target, deployment, retention, and cap before concluding anything about the incident.
- **Incomplete warning:** default cap is 100 fetched records, adjustable with `--limit` up to 1000. The cap is checked **before** local application-ID filtering. Reaching it or a CLI truncation notice warns even when no app ID matches. This CLI has no documented cursor/pagination flag; split into smaller, overlapping windows and deduplicate by timestamp/platform ID. Do not claim exhaustive history from a single capped query. Upstream per-request truncation is not always detectable.
- **Exit 2:** the script's invalid/missing arguments, including a non-UUID application ID; use `--help`.
- **Other nonzero exit:** auth/query/process/format failure, not an empty result. Vercel CLI exit 2 maps to 1; other child codes propagate. Timeout/spawn/buffer/format failures return 1. Raw diagnostics and partial output are suppressed. Verify identity/access, CLI contract and window; narrow the window/cap for a 60-second timeout or 16 MiB buffer failure. If still failing, use this project's dashboard **Logs** tab with Production and the same UTC window (not the deployment build-log tile).

History and per-request truncation depend on the plan and current [Runtime Logs limits](https://vercel.com/docs/logs/runtime#limits). Check those limits without changing production settings; expired or discarded logs cannot be recovered by this script.

## Auth recovery / manual-auth handoff

The 2026-10-11 incident required re-authenticating the CLI before logs worked. Stale credentials can look like missing project access. When the wrapper reports auth failure, or identity/access checks fail:

Interactive browser/device approval is a **manual-auth handoff**: an unattended agent stops the live lookup and reports the blocker while completing offline work. Ask an authorized human to:

1. Run `bunx vercel@63.1.2 login`.
2. Run `bunx vercel@63.1.2 whoami` and verify the expected account.
3. Run `bunx vercel@63.1.2 teams ls` and verify team access.
4. Run `bunx vercel@63.1.2 project inspect fillthemat --scope fillthemat` and verify the project ID above.
5. Retry the exact bounded `bun run logs:prod` command. Record success/empty/failure and the UTC window, not credentials.

Never print/read auth tokens, credential files, or environment-secret values to troubleshoot. Do not automatically log out, delete/replace credentials, pull production environment files, relink the project, or change production configuration. If an existing environment token overrides interactive identity, ask the human to correct their credential context privately and re-verify access.

## Sharing and sensitive storage

The wrapper keeps raw CLI output in memory and recursively removes its private temporary directory after the child finishes. A cleanup failure warns without hiding the query result; ask a human to check private temporary storage. Output retains only allowlisted timestamps, IDs, static API routes, method/status, level, booking error codes and database codes. Routes outside the `/api/*` allowlist, including page routes, show as `[redacted]`. SQL prose is discarded after extracting an explicit allowlisted `code` (e.g. `42703`). New routes/codes need an allowlist change and tests.

Review even sanitized excerpts before sharing: never include names, ages, emails, phone/IP addresses, message/request bodies, SQL/parameters, provider payloads, cookies/authorization headers, bearer/resume/session/Turnstile tokens, idempotency keys, or secrets. Sanitization discards these fields/messages rather than promising a regex can scrub arbitrary prose. Share the smallest useful excerpt with its window and completeness caveat; never commit downloaded logs.

Human-only raw exports: use an approved private directory outside the repo (`0700`, files `0600`; `umask 077`). Keep them out of transcripts/issues/PRs and source control; delete the exact exports and directory after analysis and verify cleanup.

CLI interface verified against `bunx vercel@63.1.2 logs --help` and [Vercel CLI logs documentation](https://vercel.com/docs/cli/logs) on 2026-10-11. Branch filtering is avoided through the non-Git cwd, not a CLI flag. Before changing the pin, re-check help, JSON schema, branch/target behavior, and tests. Live incident evidence belongs in the PR as sanitized output, not a raw fixture.
