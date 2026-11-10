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

**Production cutover follow-up (#241):** production still has the historical
`app` and `drizzle` schemas. After the public-schema app/data cutover is verified,
remove those schemas in a separately reviewed production operation (not a fresh
installation migration), and remove `DATABASE_URL` / `DIRECT_URL` from Vercel
Production and Preview environments. Local setup creates neither legacy schema.

1. Create a dedicated Supabase project (empty). Prefer a second project later for preview; for this first deploy one production project is enough.
2. Expose the application schema `public` in Data API settings; grants and RLS protect owner data.
3. Copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable/anon key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Server-only secret key → `SUPABASE_SECRET_KEY`
4. Configure the GitHub migration workflow using the human checklist in §5 before merging to `main`. Vercel builds and app startup never apply migrations. The app uses the Supabase Data API, not a direct database connection.

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
SUPABASE_SECRET_KEY=
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
- Migration credentials belong in GitHub's dedicated `production-migrations` environment secrets, not repository secrets or Vercel. Preview must never receive production migration credentials.
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
bun run verify:checks
bun run test
bun run build
bun run vercel:deploy:prod
```

First production deploy will use `vercel.ts` (`bunVersion: 1.4.x`, `framework: nextjs`, cron).

`bun run vercel:ignore-build` skips docs/agent-only Preview builds against `VERCEL_GIT_PREVIOUS_SHA`; Production, missing shallow-clone history, and errors build (ignored builds still count toward Vercel's daily deployment quota).

### Production migrations (human setup before merge)

The **Production migrations** GitHub Action runs on every push to `main`, or manually via Actions → Production migrations → Run workflow → `main`. It never runs on PRs; dispatches from other branches are skipped before joining the job's concurrency group. `supabase/setup-cli` resolves the exact CLI version from the root `bun.lock` (currently `3.0.0`, pinned in `package.json`), without a separate canary Bun setup. The job links the project, then runs `supabase db push --remote --yes --skip-vault`. CLI v3 requires explicit remote targeting and hosted-change consent. No seed, custom roles, Vault configuration or project config is pushed.

- [ ] In Supabase Dashboard, confirm the production project ref. The repo's read-only MCP currently targets `aopcockhbfvonhvxufob`; confirm this is still the intended project and matches Vercel's Supabase URL. Do not use the old personal project.
- [ ] In GitHub Settings → Environments, create **`production-migrations`** (not Vercel's `Production` environment). Set Deployment branches and tags → Selected branches and tags → **Branch: `main` only**, with no tag rule. Configure this restriction before adding credentials: the job's `if` alone does not protect secrets from workflows edited on another branch.
- [ ] Add **environment secrets** in `production-migrations`: `SUPABASE_PROJECT_REF` (confirmed ref), `SUPABASE_DB_PASSWORD` (that project's database password), and `SUPABASE_ACCESS_TOKEN` (a scoped personal access token limited to this production project). Do not store these as repository/organization secrets; remove any broader copies. Per the [current token permissions guide](https://supabase.com/docs/guides/platform/personal-access-tokens) and CLI help, grant `project_admin_read` (Project Settings), `projects_read` (Projects), `database_pooling_config_read` (Connection Pooling, for pooler fallback on IPv4-only runners), `api_gateway_keys_read` (API Keys), and `api_gateway_keys_secret_read` (API Key Secrets). These are Read scopes; database-password access itself is not limited by token scope.
- [ ] Ensure GitHub Actions is enabled and any database network restrictions permit the runner's connection. Standard GitHub-hosted runner IPs are not fixed: if restrictions are enabled, arrange an approved static-egress runner/network solution rather than allowlisting one observed IP or opening the database broadly. Subscribe to failed workflow notifications.
- [ ] Review every pending SQL migration and take an appropriate backup before the first run. After this workflow reaches `main`, inspect its first run and confirm all versions using the [read-only MCP guide](agents/supabase-mcp.md).

**First run and source of truth:** [Supabase documents](https://supabase.com/docs/reference/cli/supabase-db-push) that the first push creates `supabase_migrations.schema_migrations`, executes local migrations and records each successful timestamp; later pushes skip applied versions. With production's empty Supabase history, **all files in `supabase/migrations/` are pending**, even though `drizzle.__drizzle_migrations` has rows. Do not mark these as applied without executing them. This is SQL replay, not a schema diff or reset: the migrations target `public` and do not depend on, migrate data from, drop or alter legacy `app`/`drizzle`. Those schemas remain until a separate production cutover. If `public` already contains conflicting objects from manual work, stop and reconcile with an operator rather than blindly repairing the ledger.

**Ordering decision:** GitHub migrations and Vercel's production deployment both start independently on a push to `main`; neither gates the other. Vercel's `build:vercel` only builds. The constant concurrency group serializes migration runs and never cancels a running job (GitHub may replace an older pending run; the next push still includes its migrations). It does not serialize Vercel deployments.

**One-time #240 merge:** production has no real users, so accept a brief window where Vercel may deploy the new app before the initial Supabase migrations finish. An operator must watch the first migration run; if it fails, use **Vercel Instant Rollback** to restore the previous deployment while investigating, then retry migrations and redeploy after they succeed. This does not move legacy data or drop `app`/`drizzle`.

For later releases, use **expand → migrate → activate → contract across separate releases**. Migrations must work with the currently deployed app; new code must also tolerate the pre-migration schema until the migration succeeds. Do not activate a new schema-dependent path in the same push: merge the additive migration first, confirm the Action succeeded, then ship/enable dependent code in a later release. Drops, renames and stricter constraints require a separate compatibility rollout. Vercel Deployment Checks could gate production promotion in a future improvement; this workflow does not implement that gate.

**Failure, retry and rollback:** A failed link/push fails the Action visibly, but **does not stop Vercel**. Do not activate dependent code on a failed run. Inspect the error, fix credentials/network or add a corrective migration, then rerun the workflow on `main`. Successfully recorded migrations are skipped; never edit an applied migration or automatically repair history. A timeout/interruption requires checking history and schema before retrying. Roll back application code only to a schema-compatible deployment; schema changes are forward-only. Redeploying/promoting Vercel does not run migrations. Use the Action for recovery, not the removed Drizzle commands or laptop production pushes.

### Booking incident: 2026-10-11

At 18:00:29 UTC, `POST /api/bookings` returned 500 after Siteverify passed. The booking transaction failed while inserting its email outbox rows: Postgres `42703`, `column "failure_reason" of relation "email_deliveries" does not exist`. The hosted journal ended at `0009`; the deployed code required `0010`–`0013`, including `0011_youthful_grey_gargoyle`, which adds that column. The transaction rolled back, so no booking was saved. Redacted recipient: `<REDACTED>`.

Historical repair used the now-removed Drizzle production migrator/check. That ledger is no longer authoritative for new deployments. Follow the Supabase workflow above for current releases; do not replay legacy Drizzle migrations. Diagnosis made no production writes or deploys.

Preview deploy (`bun run vercel:deploy`) needs its own Supabase or you accept that preview shares production data. The plan says never share production data with preview; if you only have one hosted project, **only use `bun run vercel:deploy:prod`** until a second Supabase exists.

## 6. Post-deploy smoke (current product, not full plan)

1. Open the production origin, Continue with Google, land on onboarding or dashboard.
2. If the school already exists locally only, it will **not** appear on hosted Postgres. Create/configure again, or dump/restore (not recommended). Treat hosted as empty.
3. In hosted Studio, set `public.schools.approved_at` for your school.
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
