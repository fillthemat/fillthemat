> Archived. Not current instructions. See docs/README.md.

# Local development onboarding

This is the plan and canonical local-setup reference. Phases 1–3 are implemented on this stack: `bun run setup`, local email auth + seed, and degradable Resend/chat.

**Do not freeze the current founder-alpha workflow.** It works for one operator who already has Google Cloud, Resend, Vercel, and Cloudflare accounts. It is too many external accounts, env files, and manual Studio steps for a new contributor.

Production topology (hosted Supabase + Vercel + Resend + Turnstile + AI Gateway) stays. Local should be a **thinner, scripted, degradable** version of that stack — not a different architecture.

---

## Goal

A new clone should reach a signed-in dashboard and a public `/s/<slug>` page with:

```bash
bun install
bun run setup
bun run dev
```

No Google Cloud project, no Studio SQL, no copying keys out of `supabase status`. Chat, real email, and Google OAuth are **optional upgrades**, not blockers.

---

## Current-state diagnosis

What exists today (README + repo, August 2025):

```bash
bun install
# copy .env.example → .env.local and fill 12 values by hand
# create supabase/.env with Google OAuth client id/secret
bun run supabase:start   # full Docker stack
bun run db:migrate
bun run dev
# Google sign-in, create a school, then SET approved_at in Studio
```

### Friction inventory

| #   | Friction                                 | Why it hurts contributors / agents                                                                                                                                                                                                                             |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Google OAuth is mandatory**            | `src/app/sign-in` only offers Google. Local Auth has `[auth.external.google] enabled = true` and `[auth.email] enable_signup = false`. Needs a Google Cloud web client whose callback is `http://127.0.0.1:54321/auth/v1/callback`. Agents cannot create that. |
| 2   | **Two (really three) env files**         | README says copy to `.env.local`. Founder secrets actually live in gitignored `.env`. Vercel CLI wrote `VERCEL_OIDC_TOKEN` into `.env.local`. Google lives in `supabase/.env`. Easy to follow the docs and still miss keys.                                    |
| 3   | **Manual Studio approval**               | Dashboard copy: “ask founder to approve in Studio”. Public pages, bookings, and email delivery all require `schools.approved_at`. There is no seed and no local approve action.                                                                                |
| 4   | **No seed**                              | `supabase/config.toml` points at `./seed.sql`, but that file does not exist. Empty `app` schema after migrate.                                                                                                                                                 |
| 5   | **Resend throws if unset**               | `getResend()` / `getFromAddress()` throw. Booking can succeed while confirmation mail crashes the worker. Founder-alpha `onboarding@resend.dev` only delivers to the Resend owner.                                                                             |
| 6   | **Turnstile is required for booking UI** | Site key is read in client components; missing secret makes `verifyTurnstile` return false. Cloudflare **always-pass test keys** exist and are public, but they are not in `.env.example`.                                                                     |
| 7   | **AI chat needs Vercel OIDC**            | `gateway(BOOKING_AGENT_MODEL)` plus `VERCEL_OIDC_TOKEN`. Default model `anthropic/claude-sonnet-4.6` is not on Gateway free tier (`docs/v1-plan-remaining.md`). Local chat is gated on `vercel login` + `vercel env pull` and a allowed model id.              |
| 8   | **Heavy local Supabase**                 | `config.toml` enables db, auth, studio, realtime, storage, edge runtime, vector, S3 protocol, local SMTP. Fillthemat only needs **Postgres + Auth** (Studio and Inbucket are nice-to-have). Slow start, high RAM, needs a running Docker Engine.               |
| 9   | **Bootstrap / doctor**                   | **Phase 1 landed:** `bun run setup` starts Supabase, writes `.env.local` from `supabase status`, fills Turnstile test keys + `CRON_SECRET`, migrates. `bun run doctor` probes Bun, `docker info`, status, and required keys.                                   |
| 10  | **Docs drift**                           | README, `docs/v1-plan.md`, and `docs/v1-deploy-current.md` overlap. Local vs hosted steps are mixed. No `CONTRIBUTING.md`. `AGENTS.md` does not mention how to run the app.                                                                                    |
| 11  | **One Supabase stack per machine**       | `project_id = "fillthemat"` and fixed API/DB ports (`54321`–`54324`, `54322` db). Git worktrees share Docker. Each worktree gets its own Next port (`3000 + n*10`) from `bun run setup`; do not start a second Supabase.                                       |
| 12  | **Tests do not prove the stack**         | Unit tests need no Docker. Integration config exists with **zero** `*.integration.test.ts` files. Playwright smoke needs `bun run dev` but not a seeded school. No CI.                                                                                         |

None of this is a reason to abandon local Supabase. The Auth JWTs, `auth.users` FK in `drizzle/0000_*.sql`, and “browser uses Auth only / server uses Drizzle” split are the product’s data model. Replacing that with a fake auth layer would create a second, lying environment.

---

## Recommendation

**Keep** local Supabase + Drizzle + Bun + Next.js 16.

**Add** a bootstrap layer so the default path does not depend on Google, Resend, Turnstile production widgets, or AI Gateway.

**Degrade** optional vendors in development instead of throwing.

**Do not** switch local Next.js to hosted/dev Supabase (shared data, secret distribution, no offline). **Do not** add a parallel docker-compose Postgres. **Do not** enable email/password in hosted production Auth.

### Target command sequence

```bash
# once per machine: Bun 1.4.x and a Docker Engine (OrbStack, Docker Desktop, Colima, …)
git clone <repo> && cd fillthemat
bun install
bun run setup          # start supabase, write .env.local, migrate, seed
bun run dev            # http://127.0.0.1:3000
```

Sign in with the seeded local owner (email, no Google). Open `/dashboard` (school already approved) and `/s/demo`.

Optional later:

```bash
bun run setup --with-google     # if supabase/.env has OAuth clients
bunx vercel env pull            # OIDC for real booking chat
# RESEND_API_KEY in .env.local  # real confirmation mail
```

### Target `.env.local` (generated, gitignored)

| Variable                                                   | Local default                                               | Required to boot?                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL` / `DIRECT_URL`                              | `postgresql://postgres:postgres@127.0.0.1:54322/postgres`   | Yes — written by setup                                               |
| `NEXT_PUBLIC_SUPABASE_URL`                                 | `http://127.0.0.1:54321`                                    | Yes — written by setup                                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                     | from `supabase status -o env`                               | Yes — written by setup                                               |
| `NEXT_PUBLIC_SITE_URL`                                     | `http://127.0.0.1:3000` (or `:3010` … `:3090` per worktree) | Yes — written by setup. `bun run dev` parses the port from this URL. |
| `CRON_SECRET`                                              | generated UUID                                              | Yes (cron route rejects empty)                                       |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`  | Cloudflare always-pass test keys                            | Yes for booking forms; safe to commit as defaults in the generator   |
| `RESEND_API_KEY` / `RESEND_FROM` / `RESEND_WEBHOOK_SECRET` | unset                                                       | No — local mail adapter logs instead of sending                      |
| `BOOKING_AGENT_MODEL`                                      | a free-tier-allowed Gateway id, documented                  | Only if using real chat                                              |
| `VERCEL_OIDC_TOKEN`                                        | from `vercel env pull`                                      | Only if using real chat                                              |
| `ALLOW_SELF_APPROVAL`                                      | `true` in generated local env                               | Local only                                                           |

Unify on **`.env.local`**. Stop documenting `.env` for app secrets. Keep `supabase/.env` only for optional Google client credentials. Keep `.env.production.local` for `bun run db:migrate:prod` (already the hosted migrate path).

---

## Architectural changes (do these before treating current setup as the contract)

### 1. `bun run setup` (`scripts/setup-local.ts`)

Idempotent. Safe to re-run.

1. Assert `bun --version` matches `packageManager` (`bun@1.4.0` line).
2. Assert a Docker Engine is reachable (`docker info`). This is the right probe for OrbStack, Docker Desktop, and Colima — do not look for “Docker Desktop.app”.
3. `bunx supabase start` (reuse if already running).
4. `bunx supabase status -o env` → merge into `.env.local` without clobbering keys the human already set (`RESEND_*`, `VERCEL_OIDC_TOKEN`, `BOOKING_AGENT_MODEL`).
5. Fill remaining required locals (site URL, Turnstile test keys, `CRON_SECRET`, `ALLOW_SELF_APPROVAL=true`).
6. `bunx drizzle-kit migrate`.
7. Seed (see below).
8. Print Studio URL, Inbucket URL, sign-in recipe, and which optional vendors are missing.

Add `bun run doctor` for the same checks without mutating files (useful for agents mid-session).

### 2. Slim `supabase/config.toml`

Disable services the app does not use locally:

- `realtime.enabled = false`
- `storage.enabled = false` (and S3 / vector / analytics)
- `edge_runtime.enabled = false`

Keep:

- `[db]`, `[auth]`, `[studio]`, `[local_smtp]` (Inbucket on 54324)

This is the highest-leverage start-time/RAM win and does not change application code.

Leave `[auth.external.google]` enabled so a founder who already has `supabase/.env` keeps working. If those env vars are missing, `supabase start` may fail today — setup should either write placeholder-disabled Google or document that Google is toggled off unless credentials exist. Prefer: **Google enabled only when client id/secret are present**; otherwise disable it in the generated local config or a committed `config.toml` with `enabled = false` and a commented block. Hosted Auth is configured in the Supabase dashboard, not from this file.

### 3. Local-only email sign-in

Production product contract stays “owners sign in with Google.” Local Auth is a different project.

In `supabase/config.toml`:

- `[auth.email] enable_signup = true`
- keep `enable_confirmations = false` (already)
- Inbucket already captures auth mail if confirmations are turned on later

In the Next app, gate extra UI on development:

- Sign-in page: email + password (or magic link) **in addition to** Google, only when `process.env.NODE_ENV !== "production"` (or an explicit `DEV_EMAIL_AUTH=true`).
- Never ship that form to Vercel production builds. Prefer a `process.env.NEXT_PUBLIC_DEV_AUTH === "true"` that setup writes to `.env.local` and that production env must not set.

Seed a user (Supabase local seed can insert into `auth.users`) plus matching `app.users` / `app.schools` rows.

### 4. Seed a demo tenant

Add `supabase/seed.sql` **or** (better, because application tables are Drizzle-owned) `scripts/seed-local.ts` run after migrate.

Minimum rows:

- Auth user `owner@local.test` / known password
- `app.users` with the same UUID
- `app.schools`: slug `demo`, `approved_at` and enough location/contact fields to publish
- One active `trial_offerings` row and one `trial_windows` row

Idempotent (`ON CONFLICT`). Do **not** seed `published_at` if we want contributors to click Preview → Publish once; **do** seed `approved_at` so Studio is not required. For Playwright later, a second fully published school is useful.

### 5. Local school approval

`ALLOW_SELF_APPROVAL=true` (local `.env.local` only):

- Onboarding sets `approved_at = now()` when creating the school, **or**
- Dashboard shows an “Approve school (local)” action

Production must leave the variable unset so founder/pilot approval stays manual (Studio or a future operator UI).

### 6. Development adapters for Resend and the booking agent

Keep production code paths; add explicit dev branches.

**Email.** If `RESEND_API_KEY` is missing and `NODE_ENV !== "production"`, mark the delivery `sent` (or `skipped`) and log subject/recipient. Do not throw from `getResend()`. Production without a key still throws. Optionally write the body to a `tmp/` or Inbucket-like log. Tests should assert rows in `email_deliveries`, not HTTP to Resend (already the V1 plan).

**Chat.** If `VERCEL_OIDC_TOKEN` is missing in development, `/api/chat` returns a deterministic stub (offerings + “use Book Trial”) instead of calling Gateway. Real chat remains `vercel env pull` + a free-tier `BOOKING_AGENT_MODEL`. Do not default to Sonnet 4.6 locally.

**Turnstile.** Setup writes Cloudflare dummy keys:

- site `1x00000000000000000000AA` (always pass, visible)
- secret `1x0000000000000000000000000000000AA`

No code change required if keys are present.

### 7. Docs and agent entrypoints

| File                        | Role after this work                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `README.md`                 | Product one-liner + 4-line quickstart + link here. Hosted deploy stays in `docs/v1-deploy-current.md`.                 |
| `AGENTS.md`                 | Keep the Next.js generated block and skills-lock rules. Add: read this file before running or changing local setup.    |
| `docs/local-development.md` | This file: target state, current workaround, non-goals.                                                                |
| `docs/v1-plan.md`           | Architecture source of truth; do not duplicate setup commands.                                                         |
| Skill                       | **Not** a vendored skill. Setup is repo-specific and must stay in-tree so `skills-lock.json` remains third-party-only. |

### 8. Explicit non-goals for this onboarding pass

- Hosted preview Supabase, CI, or Playwright auth bypass (see `docs/e2e-testing-plan.md`)
- Replacing Drizzle migrations with `supabase db diff` / `db push`
- RLS on `app.*`
- Enabling email auth on the hosted project
- Devcontainers / Nix / `mise` (revisit only if Bun + a Docker Engine still fails for people)
- TesterArmy or extra SaaS for local boot

---

## Implementation phases

Ship in this order so each phase is usable alone.

### Phase 0 — Docs only (this PR)

- Add this file.
- Point `README.md` and `AGENTS.md` at it.
- Document the **current** commands accurately (including `.env` vs `.env.local` drift and Studio approval).

No behavior change. New people can follow the workaround below.

### Phase 1 — Bootstrap script + env unification — **landed (this PR)**

- `scripts/setup-local.ts`, `package.json` scripts `setup` and `doctor`.
- Generate `.env.local` from `supabase status` (preserves Resend / OIDC / model if already set).
- Writes Google placeholders into `supabase/.env` when missing so `supabase start` does not require a Cloud client.
- Cloudflare always-pass Turnstile keys and a generated `CRON_SECRET`.
- README quickstart is `bun quickstart`.

Sign-in still requires Google until Phase 2.

### Phase 2 — Local auth + seed + self-approval — **landed (this PR)**

- Email signup in local `config.toml` (hosted Auth unchanged).
- Dev-only sign-in UI when `NEXT_PUBLIC_DEV_AUTH=true`.
- Seed `owner@local.test` / `local-dev-password` + approved unpublished `/s/demo`.
- `ALLOW_SELF_APPROVAL` auto-approves schools created in development.
- Slim unused Supabase services (realtime, storage, edge, vector).

### Phase 3 — Degradable vendors — **landed (this PR)**

- Resend no-op in development when `RESEND_API_KEY` is unset (delivery marked `sent`, body logged).
- Chat stub without `VERCEL_OIDC_TOKEN` (points the prospect at Book Trial).
- Turnstile test keys in the generator (Phase 1).

### Phase 4 — Prove it

- `bun run doctor` in README “if something fails.”
- One integration test that setup (or a test harness) can run against local Postgres (booking occupancy is the highest-value first test from `docs/v1-plan-remaining.md`).
- Later: GitHub Action that runs `supabase start` + migrate + unit tests. Out of scope until Phase 2 is green on a laptop.

---

## How to run it today

Prerequisites: **Bun 1.4.x** (`package.json#packageManager`) and a **Docker Engine** whose CLI answers `docker info`. OrbStack (this repo’s founder setup), Docker Desktop, and Colima are all fine. The Supabase CLI talks to the Docker API, not to Docker Desktop specifically.

1. `bun install`
2. Agents: `bun run skills:install` (see `AGENTS.md` / `skills-lock.json`).
3. `bun run setup` — starts Supabase, writes `.env.local`, migrates. If something fails: `bun run doctor`.
4. `bun run dev` → the origin setup printed (`http://127.0.0.1:30X0` on the main checkout, 1 <= X <= 9). Worktrees: from the repo root, `git worktree add .worktrees/<name> -b <branch>`, then `bun quickstart` in that tree (new app port, same Docker). Do not `supabase stop` from a child tree.
5. Sign in at `/sign-in` with `owner@local.test` / `local-dev-password`. Preview then publish `/s/demo` from the dashboard (school is pre-approved).
6. Optional Google: Web client callback `http://127.0.0.1:54321/auth/v1/callback`, real values in `supabase/.env`, then `bun run supabase:stop && bun run setup`.
7. Optional full fidelity: `bunx vercel env pull` for real chat; Resend test key + `RESEND_FROM=onboarding@resend.dev` for real mail (owner inbox only). Without them, chat stubs and email rows still complete.

Checks: `bun run check`, `bun run test`. Do not run `bun run db:migrate:prod` unless you intend to migrate hosted data (`docs/v1-deploy-current.md`).

### Worktree frontend ports

Worktrees reuse the already-running Supabase on fixed ports; do not start or stop a second stack. Each tree gets its own Next origin from `bun run setup`. Auth `additional_redirect_urls` allow `http://127.0.0.1:3000` … `:3090`; restart Supabase once after pulling that config change.

Put every extra checkout at **`.worktrees/<name>`** (gitignored) from the repo root:

```bash
git worktree add .worktrees/<name> -b <branch>
cd .worktrees/<name>
bun quickstart
```

**How a port is claimed** (`scripts/local-ports.ts`):

1. `bun run setup` asks git for `--git-common-dir` (the main repo `.git`, shared by every linked worktree) and `--show-toplevel` (this checkout’s path).
2. It writes a **claim file** under that shared git dir:

   ```
   .git/fillthemat-ports/3000  →  /absolute/path/to/main/checkout
   .git/fillthemat-ports/3010  →  /absolute/path/to/.worktrees/feat-x
   ```

   One file per port. One line: the worktree that owns it. Creating the file with exclusive `wx` is the only lock — if two setups race on `:3000`, one wins and the other takes `:3010`.

3. If the path in a claim file no longer exists (worktree removed), the next setup treats that port as free.
4. Setup then writes `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:<port>` into **this** worktree’s `.env.local`. That URL is the source of truth for `bun run dev` and `bun run dev:stop` (they parse the port; there is no `PORT=` env).
5. Re-running setup in the same tree keeps that URL. A first run with no URL picks the lowest free port in `3000, 3010, … 3090`.

These files live inside `.git`, so they are not committed. Do not put them in a worktree-local `.git` (linked worktrees would not see each other).

The setup-owned origin is a **core assumption** of the multi-worktree workflow:

- Use the origin printed by `bun run setup` and then start the frontend with plain `bun run dev`.
- Do not pass `--port` or manually edit `NEXT_PUBLIC_SITE_URL`. `bun run dev` binds the port parsed from that URL.
- Reserve eligible ports `3000`, `3010`, … `3090` for Fillthemat worktrees.
- If Next reports `EADDRINUSE`, or `bun run doctor` reports an ineligible site URL, stop and report the collision. Do not pick an arbitrary port; that bypasses the Auth allow-list.
- Stop this worktree's frontend with `bun run dev:stop`. It SIGTERMs listeners on the origin in `.env.local` and does not touch Supabase or other worktrees.
- A worktree keeps its assignment across reruns. Removing the worktree directory allows a later setup to reclaim its port.

**When the worktree is done** (from the worktree, then the repo root):

```bash
cd .worktrees/<name>
bun run dev:stop          # only this tree's Next; leaves Supabase alone
cd ../..
git worktree remove .worktrees/<name>
# git branch -d <branch>   # optional, if you created a throwaway branch
```

Do not `supabase stop` from the child tree. Do not hand-delete `.git/fillthemat-ports/<port>` — setup treats the port as free once the worktree path is gone. Use `git worktree remove --force` only if git refuses because of leftover files.

---

## Decision log

| Option                                     | Verdict                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Document current Google + Studio flow only | Rejected as the end state. Acceptable as Phase 0.                                                           |
| Point `bun run dev` at hosted Supabase     | Rejected. Secrets in chat, shared data, Docker still needed for some people, worse agent story.             |
| Fake auth / skip Supabase locally          | Rejected. Breaks `auth.users` FK and cookie/JWT behavior.                                                   |
| Project skill under `.agents/skills`       | Rejected. `AGENTS.md` forbids vendoring skills; lockfile is third-party-only. In-tree doc is the interface. |
| Devcontainer as the default                | Deferred. Optimize the native Bun + Docker Engine path first (OrbStack included).                           |
| Email auth in production                   | Rejected. Product contract is Google for owners; prospects never have accounts.                             |
