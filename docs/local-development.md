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

### SQL seed lifecycle

Fixtures live in native [Supabase seed files](https://supabase.com/docs/guides/local-development/seeding-your-database), with no schema DDL:

- `supabase/seeds/00-auth.sql` creates a confirmed email/password owner and email identity. It is the only configured native startup seed (`db.seed.sql_paths`): Supabase first start/reset runs before this project's Drizzle migrations, so it must not reference `app`.
- `supabase/seeds/10-app.sql` creates the demo in **`app`**, where runtime queries still run. The declarative **`public`** comparison copies are deliberately not seeded.
- `bun run setup` starts Supabase, applies Drizzle migrations, then invokes the small `scripts/seed-local.ts` SQL runner. `bun run db:seed` reapplies both SQL files in one transaction after setup. It uses only the running local CLI's loopback `DB_URL`, not `DATABASE_URL`/`DIRECT_URL` or production credentials, closes its connection, and serializes concurrent reseeds.

Reseeding preserves an existing owner's UUID/password and school edits (including publication, slug and timezone). The listed password is for a freshly seeded account; a password you changed stays changed. A conflicting `demo` slug owned by somebody else fails atomically instead of adding data to their school. Existing offerings/class times are reused. Any upcoming booked trial prevents another demo booking; once none remains, the seed creates a new trial roughly seven days ahead, preserving old bookings and using a fresh idempotency key. Booking snapshots, ICS UID and occurrence count are populated together. Like the previous seed, that synthetic date need not match the weekly class-time label.

Native first start alone seeds Auth, **not** the dashboard. A native reset would likewise need Drizzle migrations and the post-migration seed; reset is not a reseeding shortcut and must not be used against the shared stack. Never apply these demo seed files to production (including via a remote push with seeds enabled). This change does not adopt Supabase migrations for runtime tables or modify existing migration history.

For isolated PostgreSQL + real Auth login/reseed checks (Docker required), run `bun run test:integration scripts/seed-local.integration.test.ts`. It creates disposable containers/network and removes them afterward, without using the running app stack. Full browser/dashboard behavior is not covered by that test.

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
