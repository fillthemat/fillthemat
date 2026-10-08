<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Linting

After making changes, run `bun run lint` and fix all errors.

## Local development

Before running the app, changing env files, Supabase config, auth, or onboarding docs, read **`docs/local-development.md`**. That is the source of truth for running the stack (the landed `bun run setup` bootstrap, seed credentials, degradable vendors, and the worktree port contract). Do not add a vendored skill for this; keep third-party skills in `skills-lock.json` only.

### Worktree port contract

Each worktree shares the machine's one Supabase/Docker stack but owns the Next.js origin written by `bun run setup` (`NEXT_PUBLIC_SITE_URL`). Treat that assignment as a core assumption:

- Create worktrees at `.worktrees/<name>` from the repo root (`git worktree add .worktrees/<name> -b <branch>`). That directory is gitignored.
- Run `bun run setup` in the worktree and use the app origin it prints.
- Do not pass `--port` to `bun run dev` or manually edit `NEXT_PUBLIC_SITE_URL` in `.env.local`.
- Assume eligible origins (`http://127.0.0.1:3000`, `:3010`, … `:3090`) are reserved for this repo.
- If that port is occupied, stop and report the collision; do not silently choose another port.
- Stop this worktree's Next process with `bun run dev:stop`. Do not `pkill` Next/dev-local by name.
- Do not stop or recreate Supabase from a child worktree; other agents may be using it.
- When the worktree is finished: in that tree run `bun run dev:stop`, then from the repo root `git worktree remove .worktrees/<name>`. Do not delete `.git/fillthemat-ports/*` by hand — the next `bun run setup` reuses the port once the directory is gone. Delete the branch separately if you no longer need it (`git branch -d <branch>`).

## Agent skills

`skills-lock.json` is the only source of truth for project skills. Do not vendor skill files or commit generated skill directories (`.agents/skills/`, `.pi/skills/`).

At the start of a session:

1. Read `skills-lock.json`.
2. If those skills are missing locally, run `bun run skills:install`.
3. Load and follow every installed skill that applies to the current task.
4. If the task needs a running app or local Supabase, follow `docs/local-development.md`.

`bun run skills:install` restores every skill listed in the lockfile. Add or refresh skills with `bun run skills:update` or `bunx skills add <package> --skill <name> -y`.

### Issue tracker

Issues and specs live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout. See `docs/agents/domain.md`.
