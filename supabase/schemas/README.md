# Side-by-side native declarative schema trial

These SQL files describe **copies in Supabase's default `public` schema** of the 19 tables and 10 enums managed by Drizzle in `app`. They are desired-state definitions, not migrations to run on an existing database. The runtime, `src/db/schema.ts`, all applied `drizzle/` history, setup and deployment continue to use **`app`**, unchanged. There is no runtime cutover, data copy, synchronization trigger or dual-write path.

All copy-owned tables, types, indexes, foreign keys, functions and triggers live in or reference `public`, never `app`. The one intentional external FK remains `public.users.id → auth.users.id`; Supabase still owns Auth. Two schemas sharing an Auth parent means deleting that parent would cascade to both if installed together. The preview does not install anything in your shared stack or production.

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

## Try it safely

Docker and the installed Supabase CLI are required. No local Supabase restart/reset or environment changes are needed.

```bash
bun run db:schema:check
bun run db:schema:diff
bun run test:integration scripts/declarative-schema.integration.test.ts
```

- `db:schema:check` starts a disposable PostgreSQL 17 container with no host ports, mounts or network. It replays unchanged Drizzle history and installs public declarations beside app in a second database, simulating permissive legacy default grants. It verifies the full app schema dump is unchanged, public objects do not reference app, all 19 tables have deny-by-default RLS and no client/service-role table or column privileges, the function has no public/client/service-role EXECUTE, and unrelated public access remains intact. Public schema ACLs and default privileges must also remain unchanged. Synthetic fixtures test the identity trigger, FK isolation, cascading deletes, owner writes and RLS denial even after temporary DML grants. Fixtures are rolled back.
- For structural comparison, the checker **renames schemas inside disposable databases** to the same comparison namespace using PostgreSQL's dependency tracking. It removes only the independently verified extra RLS flags, and compares schema dumps without ACLs, ownership or comments. Names, column order, defaults, checks, FK actions, indexes, enum labels and function/trigger definitions must match. ACLs and RLS are checked separately, not silently ignored. `auth.users` is a stub; this is not an end-to-end Auth/PostgREST test or a full application regression suite against public.
- `db:schema:diff` runs native `db schema declarative sync --no-apply --strict-coverage --schema public` in a temporary project. It stages the unchanged app migrations, then a **synthetic public comparison baseline derived from that history**, including explicit copy security. Only known namespace qualifiers are mapped; Auth references and function bodies are preserved. The baseline does not come from the edited desired-state files, so edits still produce real diffs. Nothing is written to repository migration history or applied to an application database. Supabase may cache disposable shadow infrastructure separately.
- The integration test edits the staged users table file to add a nullable column and verifies that native generation produces an additive public migration, not app changes or schema recreation.

Edit a table file and rerun the preview to see incremental generation. The parity check should fail for structural drift until Drizzle history describes the same structure; changes to the explicit public security contract must also be reviewed. Neither command copies application data. The side-by-side databases exist only during the disposable checker run and are removed afterward; there is no persistent Studio comparison installed by these commands.

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
