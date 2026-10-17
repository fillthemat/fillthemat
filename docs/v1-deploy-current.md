# Deploy current Fillthemat (current `main`, founder alpha)

How to put **today’s code** on Vercel. This is not the full pilot launch gate (see `docs/known-gaps.md`). It is “founder alpha, hosted”: one operator, real HTTPS, no claim of production-hardening.

The Vercel project already exists and is linked: `jakegoodmandev-3440s-projects/fillthemat`. Local `.vercel/` should stay uncommitted.

## What you are deploying

A Next.js 16 app on Bun 1.4 (`vercel.ts`). It needs:

| Dependency                               | Hosted equivalent                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Local Docker Postgres + Auth             | A **new** hosted Supabase project (not local, not a copy of some other product’s DB)    |
| `http://127.0.0.1:54321` Google callback | That project’s Google callback URL                                                      |
| `onboarding@resend.dev`                  | Same for first deploy if you only email yourself; otherwise a verified domain           |
| Turnstile test keys                      | Keep test keys until you want real visitors; switch to live keys before any public link |
| `VERCEL_OIDC_TOKEN`                      | Provided by Vercel at runtime; Gateway must allow the chosen model                      |

Do **not** point production at `127.0.0.1` database URLs.

## 1. Hosted Supabase

1. Create a dedicated Supabase project (empty). Prefer a second project later for preview; for this first deploy one production project is enough.
2. Disable exposing schema `app` in Data API settings (plan: browser uses Auth only).
3. Copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable/anon key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Transaction pooler URI (port **6543**, `?pgbouncer=true` or Supavisor transaction mode) → `DATABASE_URL`
   - Direct or session-pooler URI (port **5432**) → `DIRECT_URL`
4. Set `DIRECT_URL` in Vercel's **Production** environment. Production builds apply pending migrations automatically, never at app startup. `DIRECT_URL` and runtime `DATABASE_URL` must point to the same hosted project. Use the session pooler if the build cannot reach the direct IPv6 address.

For operator recovery only, put the hosted `DIRECT_URL` in gitignored `.env.production.local`, then:

```bash
bun run db:migrate:prod
bun run db:check:prod
```

Confirm `app.schools` exists. Revokes and `auth.users` FK are in `drizzle/0000_*.sql` and require the hosted `auth` schema (they do).

The manual check accepts `DIRECT_URL` when `DATABASE_URL` is absent. If both are set, it checks `DATABASE_URL`; both must point to the same hosted project.

5. Turn on Google in that project:
   - New (or additional) Google Web OAuth client **or** extra redirect URIs on the existing client.
   - Authorized JavaScript origins: the Vercel production origin, and `http://127.0.0.1:3000` if you still develop locally.
   - Redirects:
     - Hosted: `https://<project-ref>.supabase.co/auth/v1/callback`
     - Local: `http://127.0.0.1:54321/auth/v1/callback`
   - In Supabase Auth: Google enabled, Site URL = production `https://…`, additional redirects:
     - `https://<fillthemat-host>/auth/callback`
     - `https://<fillthemat-host>/**` (preview URLs if you use them)
     - keep local callback URLs if you still run `bun run dev`

## 2. Hostname and Vercel env

Pick a stable host. First deploy can use `fillthemat.vercel.app` (or the project’s `.vercel.app`). Set `NEXT_PUBLIC_SITE_URL` to that `https://` origin with no trailing slash.

Add **Production** (and Preview if you will use preview deploys) environment variables in the Vercel project. Do not upload local Docker URLs.

```
DATABASE_URL=
DIRECT_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=
RESEND_API_KEY=
RESEND_FROM=onboarding@resend.dev
RESEND_WEBHOOK_SECRET=
CRON_SECRET=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
BOOKING_AGENT_MODEL=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_SYSTEM_USER_TOKEN=
WHATSAPP_API_VERSION=
WHATSAPP_GRAPH_BASE=
```

Notes:

- `CRON_SECRET` must be a long random string. Cron calls `GET /api/cron/maintenance` with `Authorization: Bearer <CRON_SECRET>`. Empty secret must never authenticate (code already rejects that).
- `BOOKING_AGENT_MODEL` is required unless the team has paid Gateway access to `anthropic/claude-sonnet-4.6`. Locally a free-tier-allowed model was needed. Set the same model in Vercel.
- `DIRECT_URL` is required for the Production build's migrations, not the serverless runtime. Preview does not need migration credentials; keep this credential scoped to Production.
- Generate `RESEND_WEBHOOK_SECRET` from the Resend dashboard when you create the webhook, then paste it into Vercel.
- WhatsApp env vars are **optional until WhatsApp rolls out in production**. Leave them unset: the webhook/worker use dev-stub values only when `NODE_ENV !== "production"`; production fails closed when they are missing once the feature ships. `WHATSAPP_API_VERSION` defaults to `v23.0` and `WHATSAPP_GRAPH_BASE` to `https://graph.facebook.com`; set them only to override. Meta app/use-case setup belongs to the Phase 6 human rollout, not this deploy doc.

Pull is optional; do not overwrite `.env.local` OIDC token carelessly:

```bash
bun run vercel:env:pull
```

## 3. Resend and cron

**First hosted alpha (you are the only recipient):** keep `RESEND_FROM=onboarding@resend.dev`. Confirmation mail only reaches the Resend account owner inbox. Fine for proving the pipeline; **not** fine for real prospects.

**Before any external prospect:**

1. Verify a sending domain (e.g. `mail.fillthemat.com`).
2. Change production `RESEND_FROM` to that domain.
3. Create webhook `https://<host>/api/webhooks/resend` for delivered/bounced/complained; set `RESEND_WEBHOOK_SECRET`.

Vercel cron is already in `vercel.ts` (`0 14 * * *` UTC → `/api/cron/maintenance`). A second Hobby-safe cron (`0 5 * * *` → `/api/cron/whatsapp`) is the WhatsApp delivery sweeper; the fast path is `after()` in the inbound webhook. Both run daily because Hobby cron is daily-only. Confirm they appear on the project after the first production deploy. Hobby/cron timing matches founder-alpha “check the run daily,” not the pilot 5-minute schedule.

## 4. Turnstile

Test keys (always pass) are acceptable while the URL is private. For any shared link, create a production widget whose hostname matches `NEXT_PUBLIC_SITE_URL` and swap site/secret keys.

## 5. Deploy

From the repo (linked project), run local checks, then request a production deployment:

```bash
bun run check
bun run test
bun run build
bun run vercel:deploy:prod
```

First production deploy will use `vercel.ts` (`bunVersion: 1.4.x`, `framework: nextjs`, cron).

`bun run vercel:ignore-build` skips docs/agent-only Preview builds against `VERCEL_GIT_PREVIOUS_SHA`; Production, missing shallow-clone history, and errors build (ignored builds still count toward Vercel's daily deployment quota).

**Production build order**:
Vercel runs `bun run build:vercel`: migration → read-only check → build, only for Production; other builds skip migration. Both `bun run db:migrate:deploy` (Vercel env, no env file) and `bun run db:migrate:prod` (manual, `.env.production.local`) use `scripts/migrate-prod.ts`; it refuses loopback targets and non-Production Vercel runs.
Set Production `DIRECT_URL` **before merging**: a DDL-capable direct or session-pooler URI (5432), never the transaction pooler (6543), targeting the same database as `DATABASE_URL`. Both migration paths hold one session-level advisory lock, so concurrent runs serialise and pending migrations run once.
Promoting Preview to Production or redeploying Production re-runs the build; this is harmless when no migrations are pending.

**Failure and retry**:
A migration failure stops the check and build. A check failure stops the build. The previous deployment keeps serving. Fix the connection or migration problem and retry; already-applied migrations are not reapplied. The read-only check remains a backstop for missing migrations and changed hashes. A changed hash or missing migration older than the latest applied timestamp needs manual repair, not a retry. The check reads the journal, not live columns; connections time out after 10 seconds and journal statements after 5 seconds. Migration SQL may take longer.
Migrations give up after five seconds waiting on a live-table lock (SQLSTATE `55P03`); retry the deploy if it fails on lock timeout.

**Backward compatibility**:
Every migration must remain backward-compatible with the currently live code. A build that fails after migrating leaves the schema ahead of the live app. We accept this for additive changes, such as new tables or optional columns. Do not drop or rename columns, remove values, or add constraints that break live reads or writes in the same release. Roll out those changes in separate compatible steps.

**Operator checks and rollback**:
`bun run db:check` uses the supplied environment and checks runtime `DATABASE_URL` first, falling back to `DIRECT_URL`. `bun run db:check:prod` loads `.env.production.local`, like the recovery command `bun run db:migrate:prod`. Prebuilt deployments and deployment rollbacks skip automatic migration and checking; an operator must run `bun run db:check:prod` before using them.

**Safe rehearsal**:
`bun run test:integration scripts/migrate-prod.integration.test.ts` rehearses the shared migrator in a temporary local database: pending → applied, retry no-op, SQL failure rejected. The CLI's loopback guard stays intact; no hosted data is touched.

### Booking incident: 2026-10-11

At 18:00:29 UTC, `POST /api/bookings` returned 500 after Siteverify passed. The booking transaction failed while inserting its email outbox rows: Postgres `42703`, `column "failure_reason" of relation "email_deliveries" does not exist`. The hosted journal ended at `0009`; the deployed code required `0010`–`0013`, including `0011_youthful_grey_gargoyle`, which adds that column. The transaction rolled back, so no booking was saved. Redacted recipient: `<REDACTED>`.

Operator repair: run `bun run db:migrate:prod` with the hosted session-pooler `DIRECT_URL`, then `bun run db:check:prod`. These commands must use the same hosted project as the runtime `DATABASE_URL`. Do not bypass the outbox transaction or add a duplicate migration: the required migrations already exist. The deployment gate prevents a repeat; it cannot repair an already-serving deployment. Diagnosis made no production writes or deploys.

Local regression/replay (isolated database on the running local stack, no changes to the shared application schema):

```bash
bun run test:integration src/app/api/bookings/schema.integration.test.ts
```

Preview deploy (`bun run vercel:deploy`) needs its own Supabase or you accept that preview shares production data. The plan says never share production data with preview; if you only have one hosted project, **only use `bun run vercel:deploy:prod`** until a second Supabase exists.

## 6. Post-deploy smoke (current product, not full plan)

1. Open the production origin, Continue with Google, land on onboarding or dashboard.
2. If the school already exists locally only, it will **not** appear on hosted Postgres. Create/configure again, or dump/restore (not recommended). Treat hosted as empty.
3. In hosted Studio, set `app.schools.approved_at` for your school.
4. Preview, publish, open `/s/<slug>` signed out.
5. Confirm a qualified session row, chat reply, and one booking.
6. Confirm `email_deliveries` rows; if From is `onboarding@resend.dev`, check the owner inbox only.
7. Hit cron once:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/maintenance
```

8. Signed-out `/dashboard` should redirect to sign-in. Unknown slug 404.

## 7. Explicitly skip on this deploy

Leave these until you resume V1 remaining work:

- Vercel WAF rules
- Verified sending domain (unless real prospects)
- Isolated preview Supabase
- PITR restore drill
- Playwright/CI against hosted
- shadcn / Elements
- Integration test suite
- Custom domain / tenant domains
- Pilot monitoring and spend-ceiling process beyond the existing $25/month Gateway budget

## 8. Rollback / data

Hosted DB is durable. There is no automated backup drill yet. Before inviting anyone else: enable Supabase backups/PITR and snapshot once after migrate.

To roll back the app, redeploy a previous Vercel deployment. Schema is forward-only; do not `push` from the laptop onto hosted.
