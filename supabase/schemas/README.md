# Native declarative schema trial

These SQL files describe the **current `app` schema**, converted from `src/db/schema.ts` and the complete `drizzle/0000`–`0014` history. They are desired-state definitions, not migrations to execute on an existing database.

Drizzle still provides runtime queries, inferred types, local setup migrations, production migrations and deployment checks. This is an opt-in native schema experiment, **not a production migration-runner cutover**. Keep both schema representations in sync while trialling it; do not deploy SQL-only edits through the unchanged Drizzle pipeline.

## File layout

- `00-app.sql` creates the private schema and shared enums.
- `10-users.sql`–`28-cron-runs.sql` each define one table, followed by its foreign keys and indexes. The schools file also owns its identity function and trigger. Table files are ordered parent-first, so all current foreign keys can stay beside their owning table; there are no cyclic dependencies requiring a shared relations file.
- `99-access.sql` keeps the schema-wide and default-privilege revokes together, after every table exists. Existing history has no RLS policies to distribute.

Keep table-specific constraints, indexes, triggers and any future RLS policies in that table's file where dependencies permit. Preserve physical column order and constraint names from migration replay, not just the latest TypeScript snapshot. Shared types belong in `00-app.sql`; introduce a separate ordered dependency file only if a future cycle genuinely requires it.

## Try it safely

Docker and the installed Supabase CLI are required. No local Supabase restart or reset is needed.

```bash
bun run db:schema:check
bun run db:schema:diff
```

- `db:schema:check` starts a disposable PostgreSQL 17 container with no host ports, mounts or network. It replays every Drizzle migration into one database and applies the declarative SQL to another. It compares full `app` schema dumps (including names, column order, defaults, checks, foreign keys, indexes, trigger/function definitions, privileges and RLS), ignoring only randomized dump safety tokens. It removes only its own container. Supabase's `auth.users` FK target is stubbed; this is schema parity, not an end-to-end Auth test.
- `db:schema:diff` runs the native `db schema declarative sync` command with `--no-apply --strict-coverage --schema app` in a temporary project. It stages unchanged copies of the existing Drizzle migrations as the baseline, with synthetic Supabase versions **only in that temporary project**. It prints the incremental SQL (or reports no changes), then removes the temporary project. It never writes repository migrations, repairs migration history or connects to the application's database. Supabase may cache disposable shadow-database infrastructure separately.

Edit the SQL files and rerun `db:schema:diff` to see native migration generation. For example, append a nullable column to a table: the preview should contain an `ALTER TABLE ... ADD COLUMN`, not a schema recreation. The parity check should then fail until the corresponding Drizzle history describes the same change; this is intentional. Preview SQL is not automatically deployed or applied.

## Native configuration and eventual cutover

`config.toml` already enables `[experimental.pgdelta]`; `declarative_schema_path = "./schemas"` makes the location explicit. Current pg-delta resolves dependencies automatically and does not use the legacy `[db.migrations].schema_paths` list. Numeric prefixes also make the files executable in sequence against an empty database with Supabase roles and `auth.users` present.

The native workflow is: edit desired-state SQL → generate a migration with `db schema declarative sync --no-apply` → review → apply the reviewed migration. Do not use legacy `db diff` for this pg-delta declarative workflow. `sync` compares against **Supabase migration files**, not live database state or Drizzle's journal.

**There is deliberately no committed `supabase/migrations` baseline yet.** A direct native sync in this checkout would generate a full schema-creation migration because Drizzle history is not Supabase history. Never apply that to the existing app database or run native `db push` as an adoption shortcut. Never reset a shared or populated stack to make histories agree. The safe preview above supplies history only to disposable shadows.

Before adopting native migrations on a real environment, make a separate, reviewed cutover: establish a baseline matching the actual database and reconcile native migration tracking without recreating existing objects; switch setup, production migration execution and deploy checks together; rehearse from empty and populated disposable databases. Keep applied Drizzle SQL, snapshots and journal intact. Supabase's live-schema export/pull is an option during that explicitly planned cutover, not something this conversion runs against production.

## Preserved details and limitations

- All 19 tables and 10 enums remain in the private `app` schema. `api.schemas` is unchanged. The original schema/table/default-privilege revokes for `PUBLIC`, `anon` and `authenticated` remain. There were no RLS policies or enabled RLS flags in the migration history, so none were invented. Do not expose `app` to the Data API without a separate access-control design.
- The SQL-only `users_id_auth_users_fk`, `prevent_published_school_identity_change()` invoker function and `schools_identity_immutable` trigger are retained. The function's original body and security/search-path behavior are unchanged; this is not a security redesign.
- Actual PostgreSQL 17 replay names the schools primary key `schools_school_id_unique`; it does not leave a separate redundant `schools_pkey` plus same-column unique constraint as the TypeScript definition might suggest. The declarative SQL preserves replayed catalog state. Verify older/live environments before cutover rather than renaming constraints speculatively.
- Columns retain migration-replay order (which differs from TypeScript declaration order). `contact_email_snapshot` is nullable after `0006`; active conversation uniqueness is partial after `0007`; `messages.purge_at` and its index are gone; `ended_conversation_count` has the replacement definition from `0009`.
- Drizzle's `$onUpdate` is application-side behavior, not a PostgreSQL trigger. No `updated_at` trigger was added. JSON `$type` and TypeScript unions (including `terminal_cause`) are not database constraints, so none were invented.
- Data backfills (including `0012`'s attempts correction) stay in historical migrations, not desired-state DDL. Seed data, Supabase-owned schemas/roles/extensions and the Drizzle migration ledger are not application schema declarations.
- pg-delta remains experimental. Review destructive statements, privileges and coverage warnings in every generated migration. DML requires versioned migrations/seeds; unsupported object kinds require explicit handling. This trial does not inspect production for drift or run security advisors against it.

Current references: [declarative schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas), [diff engines](https://supabase.com/docs/guides/local-development/diff-engines).
