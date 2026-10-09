# Local development

This is the current, scripted way to run the Fillthemat stack on your machine. The historical diagnosis and implementation phases that used to live here were moved to `docs/archive/local-dev-onboarding-plan.md`.

## Prerequisites

- **Bun 1.4.x** (matches `packageManager` in `package.json`).
- A **Docker Engine** reachable via `docker info` — OrbStack, Docker Desktop, or Colima. The Supabase CLI talks to the Docker API; the specific Docker product does not matter.

No Google Cloud project, Studio SQL, or hand-copied keys are required to boot and sign in.

## Quickstart

```bash
bun install
bun run setup      # start Supabase, write .env.local, migrate, seed
bun run dev        # http://127.0.0.1:3000 (see worktree contract below)
```

`bun quickstart` chains those three (`bun install && bun run setup && bun run dev`). If something fails, run `bun run doctor` for a read-only probe of Bun, Docker, Supabase, `.env.local`, and the signing origin.

Stop this checkout's frontend with `bun run dev:stop`. Never `pkill` Next/dev-local by name, and never `supabase stop` from this worktree — see the port contract below.

## What `bun run setup` does

1. Asserts Bun and a reachable Docker Engine.
2. Writes `supabase/.env` Google placeholders if absent, so `supabase start` boots without a Cloud client.
3. Starts local Supabase (no-op if already running).
4. Reads `supabase status -o env` and merges it into `.env.local`, **preserving** any keys you already set (`RESEND_*`, `VERCEL_OIDC_TOKEN`, `BOOKING_AGENT_MODEL`, `WHATSAPP_*`, …).
5. Claims this checkout's Next port and writes `NEXT_PUBLIC_SITE_URL` (see below).
6. Fills Turnstile always-pass test keys, `CRON_SECRET`, and `ALLOW_SELF_APPROVAL`.
7. Runs `bunx drizzle-kit migrate` and seeds the demo tenant.

It is idempotent and safe to re-run.

## Seed credentials

In `.env.local`-written local auth, email sign-in is the default path (Google is optional). Sign in at `/sign-in` with:

```
owner@local.test / local-dev-password
```

The seed creates an **approved but unpublished** school with slug `/s/demo` (plus a seeded offering, class-time window, and demo booking). After signing in, open `/dashboard`, then Preview → Publish to make `/s/demo` public. `ALLOW_SELF_APPROVAL` auto-approves other schools you create locally; leave it unset in production.

## Optional integrations

All optional. The app degrades cleanly without them.

| Capability | How | Without it |
| --- | --- | --- |
| Real email | Set `RESEND_API_KEY` (+ `RESEND_FROM=onboarding@resend.dev` for owner-only test mail) in `.env.local` | Deliveries are recorded and logged instead of sent |
| Real booking chat | `bunx vercel env pull` (provides `VERCEL_OIDC_TOKEN`) and a free-tier-allowed `BOOKING_AGENT_MODEL` | `/api/chat` returns a deterministic stub; WhatsApp turns run the assistant with a scripted local model that names the active trial offerings |
| Continue with Google | Replace the placeholders in `supabase/.env` with a real Web client (callback `http://127.0.0.1:54321/auth/v1/callback`), then re-run `bun run setup` | Email sign-in still works; Google is disabled |
| Real WhatsApp sends | Set `WHATSAPP_SYSTEM_USER_TOKEN` (and optionally `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN`) | Webhook + worker use dev-stub values; outbound send is a no-op log |

## Checks

```bash
bun run check            # Biome
bun run test             # unit tests
bun run test:integration # requires the running local stack (bun run setup)
```

CI runs unit tests, integration tests, and Playwright on pull requests (`.github/workflows/test.yml` and `playwright.yml`). Do not run `bun run db:migrate:prod` unless you intend to migrate hosted data (`docs/v1-deploy-current.md`).

## Worktree port contract

Each worktree shares the machine's single Supabase/Docker stack but owns the Next.js origin written by `bun run setup` (`NEXT_PUBLIC_SITE_URL`). This assignment is a core assumption — the app's Auth allow-list depends on it.

- Create worktrees at `.worktrees/<name>` from the repo root: `git worktree add .worktrees/<name> -b <branch>`. That directory is gitignored.
- Run `bun run setup` in the worktree and use the origin it prints.
- Do **not** pass `--port` to `bun run dev` or manually edit `NEXT_PUBLIC_SITE_URL`; `bun run dev` binds the port parsed from that URL.
- Eligible origins are `http://127.0.0.1:3000`, `:3010`, … `:3090`, reserved for this repo. One file per port under `.git/fillthemat-ports/` records the owning worktree.
- If a port is occupied or `doctor` reports an ineligible site URL, stop and report the collision — do not choose another port.
- Stop **this** tree's Next with `bun run dev:stop`. Do not stop or recreate Supabase from a child worktree — other agents may be using it.
- When done: in the tree run `bun run dev:stop`, then from the repo root `git worktree remove .worktrees/<name>`. Do not hand-delete `.git/fillthemat-ports/*`; setup reclaims a port once its worktree path is gone.

## Non-goals (local)

- No parallel docker-compose Postgres and no switching local Next to hosted Supabase.
- Email/password auth stays disabled on the hosted project — the product contract is Google sign-in for owners.
- No devcontainers, Nix, or `mise` (revisit only if Bun + a Docker Engine still fails for someone).

Related: `docs/v1-deploy-current.md` (hosted deploy), `docs/known-gaps.md` (remaining work), `docs/archive/local-dev-onboarding-plan.md` (history).
