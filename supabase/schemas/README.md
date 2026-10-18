# Side-by-side native declarative schema trial

These SQL files describe **copies in Supabase's default `public` schema** of the 19 tables and 10 enums managed by Drizzle in `app`. They are desired-state definitions, not migrations to run on an existing database. The runtime, `src/db/schema.ts`, all applied `drizzle/` history, setup and deployment continue to use **`app`**, unchanged. There is no runtime cutover, data copy, synchronization trigger or dual-write path.

All copy-owned tables, types, indexes, foreign keys, functions and triggers live in or reference `public`, never `app`. The one intentional external FK remains `public.users.id → auth.users.id`; Supabase still owns Auth. Two schemas sharing an Auth parent means deleting that parent would cascade to both if installed together. These declarations have not been installed in your shared stack or production.

## File layout

- `00-public.sql` declares the shared enum types and uses `CREATE SCHEMA IF NOT EXISTS public` because Supabase already provides the schema.
- `10-users.sql`–`28-cron-runs.sql` each define one table with its foreign keys, indexes, RLS flag and object-level revokes. The schools file also owns its identity function/trigger and function EXECUTE revoke.
- Table files are parent-first. No current dependency cycle needs a separate relations file. Keep table-specific behavior and security beside the table; only introduce shared dependency files when genuinely necessary.

## Security differences from `app`

`public` is exposed by the Data API, unlike the existing private `app` schema. This is a **server-only comparison**, not a new client API:

- Every copied table explicitly enables RLS with **no policies**, so non-owner/non-BYPASSRLS roles cannot see or modify rows even if DML grants are accidentally restored.
- Each table revokes all privileges from `PUBLIC`, `anon`, `authenticated` and `service_role`. Revoking `service_role` matters because it bypasses RLS and older Supabase projects automatically grant it access to new public tables. No broad grants are introduced. Owners/superusers retain administrative access; RLS is not forced on the owner.
- The invoker identity-trigger function keeps its original body and security mode, but explicitly revokes EXECUTE from those same roles because functions in `public` are otherwise callable through RPC. Its table trigger still works for the owner.
- Do **not** copy the private schema's schema-wide/default-privilege revokes to `public`: they could break unrelated public objects. All hardening here is object-scoped. Public schema ownership, USAGE, CREATE and creator defaults are not changed; unrelated objects and future tables retain their existing settings. New copied tables must include their own RLS/revokes.

The original `app` ACLs, lack of RLS policies and runtime access model are untouched. Namespace, RLS and object ACL differences are intentional; this is not literal ACL parity. Custom role memberships, platform-specific grants and other existing public objects require separate review before any real installation. If these object names already exist in public, stop: this trial must not overwrite them.

## Existing helpers are app-specific

The public-schema follow-up changes declarations and documentation only. Script and test changes from that follow-up were undone; the earlier helpers remain unchanged and **must not be used to validate or generate migrations for these public copies**:

- `db:schema:check` still compares `app` dumps, does not normalize namespaces, and does not create the `service_role` required by these public declarations. It cannot validate public parity or security.
- `db:schema:diff` still stages only Drizzle's app history and selects `--schema app`. With desired state now in public, it may propose dropping app objects in its disposable preview. **Do not use or apply its output for this trial.** It remains preview-only, with no application database connection or migration application.
- The declarative unit/integration tests still assume app declarations and an app-only native baseline. They are not public-copy verification; the layout test in `bun run verify` now fails on that intentional mismatch. Do not interpret this as a passing automated public workflow.

There is no supported automated public comparison workflow in this change. A future comparison must use a separately provisioned, disposable database, replay unchanged app history, apply these public copies without real user data, and explicitly account for namespace/RLS/ACL differences. Do not run setup, reset or apply commands against the shared stack or production for this experiment. No persistent Studio comparison is installed by these declarations.

Before the script updates were withdrawn, disposable PostgreSQL checks passed structural parity, side-by-side isolation and public security checks. That is historical evidence only: those public-specific checks and fixtures are not retained, and the existing helpers cannot reproduce them. Auth/PostgREST and custom production roles were not verified.

## Native configuration and future installation

`config.toml` enables `[experimental.pgdelta]` with `declarative_schema_path = "./schemas"`. pg-delta discovers all per-table files and resolves dependencies automatically; the legacy `[db.migrations].schema_paths` setting is deliberately absent. Numeric prefixes also support sequential execution in an empty disposable database with Supabase roles and `auth.users` present. API schema configuration is unchanged.

**There is deliberately no committed `supabase/migrations` baseline.** Direct native sync in this checkout would generate a full public-copy creation migration, not an incremental update of app. Never apply preview SQL to production or a shared stack, run native push/reset as an adoption shortcut, or use live `db diff` for this desired-state preview.

A persistent side-by-side installation needs a separate reviewed migration, collision check, public security/role audit and disposable rehearsal. Keep app history/runtime intact; copying real data and deciding how Auth deletion should work are separate decisions. Adopting native migrations for production app tables is a different cutover again: reconcile actual database state and migration tracking and switch setup/deployment checks together, without recreating objects or rewriting applied history.

## Preserved details and limitations

- Column order and names reflect PostgreSQL 17 replay of `drizzle/0000`–`0014`, not just TypeScript declaration order. The schools PK remains `schools_school_id_unique`; no speculative redundant `schools_pkey` is added.
- SQL-only Auth FK and identity function/trigger remain. `contact_email_snapshot` is nullable; active-conversation uniqueness is partial; `messages.purge_at` is absent; the ended-conversation counter keeps its replacement definition.
- Drizzle's `$onUpdate` and JSON `$type`/TypeScript unions remain application-side behavior, not new triggers/checks. Historical DML/backfills stay in migrations, not desired-state DDL. No data is copied from app.
- Seed data, platform-managed schemas/roles/extensions and the Drizzle ledger are not copy declarations. pg-delta is experimental: review every generated migration, destructive statement, privilege and coverage warning. This trial neither inspects production drift nor runs production security advisors.

References: [declarative schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas), [Data API security](https://supabase.com/docs/guides/api/securing-your-api), [diff engines](https://supabase.com/docs/guides/local-development/diff-engines).
