# Local development

## Prerequisites

- **Bun 1.4.3 (matches `packageManager` in `package.json`).
- A **Docker Engine** reachable via `docker info` — OrbStack, Docker Desktop, or Colima.

## Quickstart

```bash
bun install
bun run setup      # start Supabase, write .env.local, migrate, seed
bun run dev        # http://127.0.0.1:3000 (see worktree contract below)
```

`bun quickstart` chains those three (`bun install && bun run setup && bun run dev`). If something fails, run `bun run doctor` for a read-only probe of Bun, Docker, Supabase, `.env.local`, and the signing origin.

Stop this checkout's frontend with `bun run dev:stop`. Never `pkill` Next/dev-local by name, and never `supabase stop` from this worktree — see the port contract below.

## Seed credentials

In `.env.local`-written local auth, email sign-in is the default path (Google is optional). Sign in at `/sign-in` with:

```
owner@local.test / local-dev-password
```

The seed creates an **approved but unpublished** school with slug `/s/demo` (plus a seeded offering, class-time window, and demo booking). After signing in, open `/dashboard`, then Preview → Publish to make `/s/demo` public. `ALLOW_SELF_APPROVAL` auto-approves other schools you create locally; leave it unset in production.

## Optional integrations

All optional. The app degrades cleanly without them.

| Capability | How | Without it |
| ---------- | --- | ---------- |
| Real email |

Set `RESEND_API_KEY` (+ `RESEND_FROM=onboarding@resend.dev` for owner-only test mail) in `.env.local` | Deliveries are recorded and logged instead of sent |
| Real assistant model | `bunx vercel env pull` (provides `VERCEL_OIDC_TOKEN`) or `AI_GATEWAY_API_KEY`, and a free-tier-allowed `BOOKING_AGENT_MODEL` | Web chat and WhatsApp run the assistant with a scripted local model: it calls the "list trial offerings" tool, then replies naming the active trial offerings. It never proposes a booking, so book with Book Trial |
| Continue with Google | Replace the placeholders in `supabase/.env` with a real Web client (callback `http://127.0.0.1:54321/auth/v1/callback`), then re-run `bun run setup` | Email sign-in still works; Google is disabled |
| Real WhatsApp sends | Set `WHATSAPP_SYSTEM_USER_TOKEN` (and optionally `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN`) | Webhook + worker use dev-stub values; outbound send is a no-op log |
| Langfuse traces of each turn | Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` (plus `LANGFUSE_BASE_URL` outside the EU region) for a Langfuse project of your own | Nothing is traced or exported |

`bun run build` / `bun run start` also load `.env.production.local`; if that file holds the production Langfuse keys, a local production server traces to production Langfuse.

## Checks

See CODING_STANDARDS.md, "Linting, formatting, and typechecks".

For the opt-in native Supabase declarative schema trial (without changing the
Drizzle runtime or resetting a local stack), see
[supabase/schemas/README.md](../supabase/schemas/README.md).

## Worktrees

Create and remove worktrees using `bun wt`. When working with worktrees in this project, it is true that:

- It has its own supabase stack
- It has its own port to run Next.js

Start the Next server with `bun dev`. Exit by killing that thread, or run `bun dev:stop`.
