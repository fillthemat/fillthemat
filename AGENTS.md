<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Coding standards

Code review MUST read and apply [CODING_STANDARDS.md](CODING_STANDARDS.md).

## Verification

Before opening a PR, run `bun run verify`.

## Local development

See [docs/local-development.md](docs/local-development.md).

## Agent skills

Install with `bun skills:install`.

### Issue tracker

Issues and specs live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use the two contexts listed in `GLOSSARY-MAP.md`. See `docs/agents/domain.md`.

### Production logs

Production incidents, runtime logs, or Vercel auth recovery: read `docs/agents/production-logs.md` before retrieving or sharing logs.
