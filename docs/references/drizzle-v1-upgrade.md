# Drizzle v1 upgrade readiness

Researched **2026-10-12**. Scope: `drizzle-orm ^0.45.2`, `drizzle-kit ^0.31.10`, PostgreSQL on Supabase through postgres-js, and this repository's migration/deploy tooling. Sources are official Drizzle documentation, tagged source, npm registry metadata, and upstream issue reports. Issue reports below are reports, not proof that every project reproduces them. No upgrade or database rehearsal was performed.

## Decision

**Not a routine production dependency bump yet.** Drizzle v1 is still a release candidate, not npm `latest`. A rehearsal is reasonable, but this repo first needs changes to database construction, the read-only deploy migration gate, migration fixtures, and SQL-file consumers. Its 14 journal entries all have snapshots, which avoids the reported missing-snapshot trigger in #6166; its CHECK constraints and partial indexes do make the post-conversion diff report in #6020 relevant. ([Upgrade guide](https://orm.drizzle.team/docs/upgrade-v1), [#6166](https://github.com/drizzle-team/drizzle-orm/issues/6166), [#6020](https://github.com/drizzle-team/drizzle-orm/issues/6020).)

Prefer the stable patch line for a low-risk maintenance update. Evaluate v1 on an isolated branch with a disposable database holding the **old** migration ledger, not just a fresh empty database. Do not replace the existing deploy gate with `drizzle-kit check`: they check different things.

## 1. What is released?

Both requested commands were run:

```sh
npm view drizzle-orm dist-tags --json
npm view drizzle-kit dist-tags --json
```

The registry returned these tags and publication times (UTC). Publication dates are npm dates, not inferred from GitHub release ordering. ([ORM registry](https://registry.npmjs.org/drizzle-orm), [Kit registry](https://registry.npmjs.org/drizzle-kit).)

| Channel | drizzle-orm | Published | drizzle-kit | Published |
| --- | --- | --- | --- | --- |
| `latest` (stable) | `0.45.4` | 2026-10-08 10:50:41.953Z | `0.31.11` | 2026-09-21 10:06:58.727Z |
| `rc` | `1.0.0-rc.4` | 2026-06-27 16:10:10.709Z | `1.0.0-rc.4` | 2026-06-27 16:10:11.337Z |
| `beta` | `1.0.0-beta.22` | 2026-04-16 10:22:48.535Z | `1.0.0-beta.22` | 2026-04-16 10:22:43.765Z |
| `rc5` (commit-suffixed preview) | `1.0.0-rc.5-5935859` | 2026-09-09 10:25:53.776Z | `1.0.0-rc.5-5935859` | 2026-09-09 10:28:46.058Z |

**There is no stable 1.0 on `latest`.** The official upgrade instructions explicitly install `@rc`; GitHub labels [v1.0.0-rc.4](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.4) a prerelease (published 2026-06-27 16:10:26Z). The `rc5` tag is newer, but is not the documented `rc` release or a stable `1.0.0`. Ordinary updates within the repo's existing caret ranges stay on 0.x. ([Upgrade guide](https://orm.drizzle.team/docs/upgrade-v1), [stable ORM release](https://github.com/drizzle-team/drizzle-orm/releases/tag/0.45.4), [stable Kit release](https://github.com/drizzle-team/drizzle-orm/releases/tag/drizzle-kit%400.31.11).)

The implementation details below are pinned to **`v1.0.0-rc.4`**, the current documented upgrade target. Do not assume moving `rc5` snapshots have exactly the same behavior.

## 2. Migration folder v3 and the database ledger

### On-disk format

Current layout:

```text
drizzle/
  0000_<name>.sql
  0001_<name>.sql
  meta/
    _journal.json
    0000_snapshot.json
    0001_snapshot.json
```

v3 layout:

```text
drizzle/
  YYYYMMDDHHmmss_<name>/
    migration.sql
    snapshot.json
  YYYYMMDDHHmmss_<another_name>/
    migration.sql
    snapshot.json
```

The folder prefix is a 14-digit timestamp, intended as UTC, followed by the migration-name suffix. There is no central journal or `meta/` directory after successful conversion. The runtime reads immediate child folders containing `migration.sql`, sorts by full folder name, splits SQL on `--> statement-breakpoint`, derives `folderMillis` from the first 14 characters, hashes the complete SQL file with SHA-256, and returns the full folder name as `MigrationMeta.name`. Runtime application does **not** read `snapshot.json`; Kit needs snapshots for generation/checking. ([v0→v1 changes](https://orm.drizzle.team/docs/v0-v1-changes), [rc.4 migration reader](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/migrator.ts), [timestamp parser](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/migrator.utils.ts).)

Folder format **v3**, PostgreSQL snapshot format **8**, and database migration-table format **1** are different version numbers. Converted PostgreSQL snapshots use `id`, `prevIds` (an array, allowing multiple parents), `version: "8"`, `dialect: "postgres"`, `ddl`, and `renames`, rather than the old database-shaped snapshot. ([Snapshot converter](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/dialects/postgres/versions.ts).)

### What `drizzle-kit up` actually does

For PostgreSQL, rc.4 `up`:

1. Reads `meta/_journal.json`.
2. For each journal entry, gets the timestamp from `entry.when`, strips the numeric prefix from `entry.tag`, and looks up `meta/<tag-prefix>_snapshot.json` and `<tag>.sql`.
3. Creates the new per-migration folder, copies the snapshot and SQL bytes, and deletes the old SQL file.
4. Removes `meta/` after the loop succeeds.
5. Converts old snapshots to PostgreSQL snapshot v8 / DDL representation.

It is a **filesystem conversion**, not application of schema SQL. There is no built-in downgrade, backup, or atomic rollback; restoration of a separately saved old folder/dependencies is required to return to the old tooling. A mid-loop failure can leave a mixed layout. ([Folder converter](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/utils.ts), [PostgreSQL up handler](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/up-postgres.ts), [up docs](https://orm.drizzle.team/docs/drizzle-kit-up), [#6166](https://github.com/drizzle-team/drizzle-orm/issues/6166).)

**Documentation/implementation discrepancy:** [v0→v1 changes](https://orm.drizzle.team/docs/v0-v1-changes#updates-to-the-migration-table) says the database migration table upgrades when running `drizzle-kit up`. In the tagged rc.4 implementation, `upPgHandler` only changes files; the **runtime migrator** calls `upgradeIfNeeded` against the database. Do not assume running `up` on a developer machine has upgraded production's ledger. ([Runtime migrate](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/pg-core/async/session.ts), [database upgrade](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/up-migrations/pg.ts).)

### `__drizzle_migrations` does change

Default location remains **`drizzle.__drizzle_migrations`**, independently of this repo's application schema `app`. Configurable migration schema/table options remain available. rc.4 creates this shape on a new database:

| Column | Type / behavior |
| --- | --- |
| `id` | `serial primary key` |
| `hash` | `text not null` |
| `created_at` | `bigint`; migration-generation timestamp, not execution time |
| `name` | `text`; full migration folder name |
| `applied_at` | `timestamp with time zone default now()` |

For an existing 0.x table, the migrator adds `name` and `applied_at`, backfills names, and sets pre-existing rows' `applied_at` to `NULL` (historical execution times are unknown). It leaves old `created_at` and `hash` values intact. For postgres-js, the ALTERs/backfill run in a transaction; pending application migrations then run in a separate transaction. ([Core migrate](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/pg-core/async/session.ts), [upgrade source](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/up-migrations/pg.ts).)

The one-time backfill matches each old database row to local migration files as follows:

- Truncate stored milliseconds to whole seconds and find migrations with that `folderMillis`.
- One timestamp candidate: use it **without checking its hash**.
- Multiple candidates in that second: choose the candidate with the same hash.
- No timestamp candidates: fall back to hash alone.
- Any unmatched database row: **throw**, identifying its database id; there is no implemented serial-id fallback. Multiple identical SQL hashes can also be ambiguous in the hash-only fallback, which uses a map holding one migration per hash.

These qualifications matter: automatic backfill is not a historical SQL-integrity audit. ([Exact matching implementation](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/up-migrations/pg.ts).)

After upgrading, applied/pending selection is **full-name membership**, not hash equality or a `MAX(created_at)` watermark. Every local folder name absent from the database is pending, including a migration older than the newest applied timestamp. SQL hashes are still recorded, but changing SQL inside an already-applied same-name folder does not cause reapplication or a hash-mismatch error. Renaming an applied folder can make it look pending. ([Selection helper](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/migrator.utils.ts), [v0→v1 changes](https://orm.drizzle.team/docs/v0-v1-changes#migrator-applies-all-missing-migrations).)

### Can v1 migrate a database previously migrated by 0.x?

**Yes, on the supported happy path, without hand-written ledger SQL.** First convert the local files with `up`; the v1 postgres-js migrator then recognizes and upgrades the old database ledger automatically. The same `drizzle-orm/postgres-js/migrator` import remains. All old applied rows must match the supplied local history, and the migration role needs the privileges for the ledger ALTER/backfill. Old files alone are **not** accepted: v1 `readMigrationFiles` throws if `meta/_journal.json` still exists. ([Driver migrator](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/postgres-js/migrator.ts), [migration reader](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/migrator.ts), [upgrade source](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/up-migrations/pg.ts).)

A manually repaired, incomplete, or inconsistent ledger may need investigation before it can upgrade. Converting files is reversible from a backup; a full production rollback after new migrations have been applied is a separate schema/data operation, not an `up` downgrade.

## 3. Commutativity checks and CI

**The command is still `drizzle-kit check`.** v1 extends it to inspect whether migrations from different branches can be combined safely. It builds a DAG from snapshot ids and `prevIds`, finds forks, computes the parent-to-branch-leaf DDL differences, and compares footprints of statement types and affected objects. Examples include two branches changing the same column, or one renaming a table another changes. This is static snapshot/DDL analysis, not running each possible SQL order against a real database. ([Changes](https://orm.drizzle.team/docs/v0-v1-changes#drizzle-kit-check--commutativity-check), [check implementation](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/check.ts), [discussion #5005](https://github.com/drizzle-team/drizzle-orm/discussions/5005).)

Recommended additional CI step after installing the pinned v1 dependencies:

```sh
bun run db:check:history --config=drizzle.config.ts --output=json
```

Alternatively, avoiding config loading entirely:

```sh
bun run db:check:history --dialect=postgresql --out=./drizzle --output=json
```

It needs local migration snapshots and a dialect, not database credentials. rc.4 emits an `ok` JSON envelope / exit 0 on success and `check_error` / exit 1 for snapshot problems or non-commutative branches. Run against the PR's merged migration history so both branches' snapshots are present; checking a single isolated branch cannot detect an unseen competing branch. ([check docs](https://orm.drizzle.team/docs/drizzle-kit-check), [rc.4 JSON contract](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/JSON_CONTRACT.md#check).)

`generate` also checks branch conflicts before generating the next migration. New merged snapshots can preserve multiple leaf ids in `prevIds`. `--ignore-conflicts` bypasses conflict rejection; do not make it a default CI flag. It does not disable snapshot-format validation or prove SQL is safe. ([Changes](https://orm.drizzle.team/docs/v0-v1-changes), [rc.2 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.2), [check source](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/check.ts).)

### What `check` validates — and does not

rc.4 parses discovered `snapshot.json` files, checks dialect-specific structure and supported/latest internal snapshot version (PostgreSQL v8), then runs supported commutativity analysis. Errors distinguish malformed, unsupported, non-latest, and conflicting snapshots. **It does not connect to production, compare the applied database ledger, validate applied SQL hashes, execute custom data backfills, or prove arbitrary SQL/data migrations commute.** Its snapshot discovery also does not constitute an audit that every SQL folder has a corresponding snapshot. Keep a separate read-only deployment ledger gate and integration rehearsal. ([Handler](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/check.ts), [snapshot discovery/validator](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/utils/utils-node.ts), [JSON contract](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/JSON_CONTRACT.md#check).)

## 4. Runtime and API breaks this repo must consider

| Change | Impact here |
| --- | --- |
| **postgres-js construction** | rc.4 accepts a URL or a config object (`drizzle({ client })`), **not** the old positional `drizzle(client, config)` overload. Update `src/db/index.ts`, `src/db/migrate.ts`, and `scripts/migrate-prod.ts`; the first also passes removed `schema` config. |
| **RQB v1 removed; `relations` → `defineRelations`** | v2 uses one relations object passed as `{ relations }`; `fields`/`references` become `from`/`to`, `relationName` becomes `alias`, and relational `where`/`orderBy` use object syntax. No `relations()` definitions or `db.query` calls were found in current `src/`, so this repo need not invent relations just to retain ordinary select/insert/update/delete queries. Remove the unused old relational schema config, or introduce `defineRelations(schema)` only if using RQB. |
| **Driver import paths** | `drizzle-orm/postgres-js` and `drizzle-orm/postgres-js/migrator` remain. There is no required move to node-postgres or a Supabase-specific Drizzle driver. Internal PG database/session/transaction types move to async/effect-specific classes/paths; PG array helpers move to `pg-core/array`. |
| **Types** | Database/transaction/migrator generics now describe `AnyRelations`, not the old full table schema. Inferred `Database`/`Transaction` aliases in `src/db/index.ts` reduce manual type edits, but must be typechecked. rc.4 also preserves nullability through typed `sql<T>.mapWith(...)`, which can change inferred result types. |
| **postgres-js execution/mapping** | v1 refactors sessions and introduces driver-aware codecs and new mappers. Rehearse JSONB, dates/timestamps, arrays, raw `execute`, and transaction/savepoint behavior. Preserve this repo's `prepare: false` runtime setup; explicit `.prepare(...)` is a distinct preparation path in rc.4, so do not assume the client option disables deliberate prepared queries. |
| **Casing** | Database-level `casing` is replaced by table/view/schema-level `snakeCase`/`camelCase` APIs. No instance-level casing configuration was found here; existing explicit SQL column names do not need a naming rewrite. |
| **Column/table helpers** | Multidimensional `.array().array()` chaining is removed (use `.array('[][]')`); `.generatedAlwaysAs()` only accepts SQL or a SQL-returning callback. `.enableRLS()` and `getTableColumns` are **deprecated**, not described as removed; replacements are `pgTable.withRLS()` and `getColumns`. These usages were not found in the current schema/runtime scan. |
| **Removed relational/internal APIs** | Old `relations`, `Relations`, `extractTablesRelationalConfig`, `normalizeRelation`, `createOne`/`createMany`, and related RQB-v1 helper types are removed/replaced. PG RQB-v1 `db._query` is gone by rc.1. rc.4 removes `PreparedQuery.mapResult` and PG/SQLite raw-query `mapResult`/`mapBatchResult`; not found in this repo. |
| **Validators** | New validation work moves into `drizzle-orm/zod`, `/valibot`, `/typebox`, etc. Standalone validation packages are not all immediately removed: the docs explicitly say they can still be used. This is not a reason to rewrite unrelated Zod schemas. |
| **Kit `schemaFilter`** | `push`/`pull` now target all schemas by default and support globs. Keep this repo's explicit `schemaFilter: ["app"]`; do not broaden it to Supabase-managed schemas. |
| **Removed Kit commands/flags** | `drop` is removed; discard/fix unapplied migration folders directly with care. `push --strict` is removed and data-loss confirmation becomes default. These are tooling breaks, not ORM query API breaks. |

Sources: [postgres-js driver signatures](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/postgres-js/driver.ts), [PG config](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/pg-core/utils.ts), [postgres-js session](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-orm/src/postgres-js/session.ts), [relations migration guide](https://orm.drizzle.team/docs/relations-v1-v2), [v0→v1 changes](https://orm.drizzle.team/docs/v0-v1-changes), [rc.1 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.1), [rc.4 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.4), [official Supabase integration](https://orm.drizzle.team/docs/connect-supabase).

## 5. Known migration problems as of 2026-10-12

| Upstream issue | Status observed | Meaning for this upgrade |
| --- | --- | --- |
| [#6166](https://github.com/drizzle-team/drizzle-orm/issues/6166): `up` half-converts when a journal entry lacks a snapshot | **Open**, filed 2026-08-22 against rc.4 | Old SQL files can be deleted before failure; retry is not a recovery strategy. Preflight every journal entry's tag-prefix snapshot and SQL file, and save the entire folder. This repo currently has 14 entries and no missing snapshots. The reporter's [control](https://github.com/drizzle-team/drizzle-orm/issues/6166#issuecomment-5380421962) says custom migrations with snapshots convert successfully; custom SQL is not itself the trigger. |
| [#6020](https://github.com/drizzle-team/drizzle-orm/issues/6020): PostgreSQL unchanged schema generates a large diff after `up` | **Open**, filed 2026-07-16 against rc.4 | Textual differences in timestamp precision, CHECKs, partial indexes, and views can produce unnecessary DDL. This schema has CHECKs and partial indexes. Inspect the first post-upgrade generated diff; do not accept it just because it was generated. |
| [#6455](https://github.com/drizzle-team/drizzle-orm/issues/6455): folder timestamp depends on timezone around New Year | **Open**, filed 2026-10-06 against rc.4 | Folder formatter uses local `getFullYear()` with UTC month/day/time. The same formatter is used by `up`, so historical New-Year entries can be affected too. Use `TZ=UTC` during conversion/generation as a defensive rehearsal measure. [Tagged formatter](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/generate-common.ts). |
| [#5952](https://github.com/drizzle-team/drizzle-orm/issues/5952), [#5995](https://github.com/drizzle-team/drizzle-orm/issues/5995): ledger upgrade/migration failure on D1 HTTP | **Open** | Reported rc.4 migrator row-shape/version-detection failures. These concern SQLite proxy/D1, **not this repo's postgres-js path**; do not present them as a confirmed PostgreSQL failure. |
| [#5769](https://github.com/drizzle-team/drizzle-orm/issues/5769): timestamp-watermark silently skips pending migrations | **Open** | Describes the 0.x algorithm relevant to this repo's existing deploy gate. rc.4's name-membership algorithm removes that specific watermark selection problem; the open issue is not evidence v1 still uses the old predicate. |
| [#6281](https://github.com/drizzle-team/drizzle-orm/issues/6281): read-only pending-migration API | **Open feature request**, not a migrator bug | There is no documented public read-only pending-ledger command replacing this repo's custom gate. Calling `migrate()` to check status is not read-only: it can create/upgrade the ledger and apply migrations. |

The official release history also documents **fixed** branch-check bugs: beta.19 addressed ignoring earlier branch migrations (#5504), beta.21 changed enum commutativity/merging, and beta.22 fixed unrelated-table index false positives (#5639) and preservation of all parents under `--ignore-conflicts`. Those are historical fixes, not current open blockers. ([beta.19](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-beta.19), [beta.21](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-beta.21), [beta.22](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-beta.22).)

No confirmed open **postgres-js-specific** v1 runtime migrator defect was established in the inspected reports. That is not a guarantee: ledger matching limitations above are visible directly in rc.4 source, and conversion/generation bugs are sufficient reason to rehearse carefully.

## 6. Repo work required before adopting v1

These are observations of current repository files, not changes made by this research:

- **`src/db/index.ts`**: replace `drizzle(client, { schema })` with the supported client-config form; remove old `schema` config if not using RQB. Preserve the pooler-safe postgres client options.
- **`src/db/migrate.ts` and `scripts/migrate-prod.ts`**: replace `drizzle(client)` with `drizzle({ client })`. Keep the production advisory lock, direct/session connection requirement, and sanitized errors.
- **`scripts/check-migrations.ts`**: remove direct `_journal.json` dependency; use `MigrationMeta.name`. Read the full names from the v1 ledger and compare name membership. Keep an additional **hash-integrity check**: v1's runtime migrator does not supply it. Remove the old high-watermark/out-of-order rule. The gate must remain read-only, including an empty or not-yet-upgraded ledger; explicitly detect/report legacy ledger state rather than invoking the mutating migrator.
- **`scripts/migrate-prod.integration.test.ts`**: its synthetic journal plus root-level SQL fixtures are rejected by v1. Convert ordinary fixtures to timestamp-named v3 folders, and add a deliberate old-ledger-to-new-ledger rehearsal rather than accidentally losing compatibility coverage.
- **`src/app/api/bookings/schema.integration.test.ts`**: currently creates the old three-column ledger and manually inserts only hash/timestamp. Keep a targeted legacy upgrade test, but update v1 deployment-gate fixtures to include migration names. Tests for edited SQL must retain independent hash detection; tests for old missing migrations must reflect that v1 now applies absent names regardless of timestamp.
- **`src/db/conversation-data-migration.integration.test.ts`**: directly reads `drizzle/${name}.sql`; update paths after conversion.
- **Operational references**: active docs pointing at flat SQL files or `_journal.json` need review when the upgrade lands, including `docs/agents/supabase-mcp.md`. Historical archived references need not all be rewritten.

### Acceptance gates for a future upgrade branch

1. Pin matching ORM/Kit prerelease versions, preflight all historical files, save a pristine folder copy, then run Kit's `up` through a package script with `TZ=UTC`. Compare old/new SQL hashes; the conversion should preserve SQL bytes. ([Converter](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/src/cli/commands/utils.ts).)
2. Update runtime construction and the migration consumers above; typecheck the inferred database/transaction types.
3. Run `check`, then generate against an unchanged schema and review every unexpected statement. Block unexplained CHECK/index/type churn rather than applying it. ([#6020](https://github.com/drizzle-team/drizzle-orm/issues/6020).)
4. Rehearse both entry points used here: Kit locally and the postgres-js runtime migrator used by production. Against a database already migrated with 0.x, confirm existing SQL is not replayed, ledger names are backfilled, a new migration applies exactly once, an older missing migration is handled as intended, failed SQL rolls back, and repeated execution is a no-op. Also test a clean database.
5. Verify the read-only deploy gate rejects missing migrations and hash drift **without DDL**, including before the ledger upgrade. Run the full repo verification/integration suite under the documented local-development workflow before any production proposal.

**Bottom line:** v1 offers useful journal-free branching and name-based migration selection, but this repo is not ready to adopt it unchanged. The happy-path database upgrade is automatic; the application/tooling migration and safety verification are not.
