# Declarative database schema

`supabase/config.toml` points pg-delta at this entire directory. Table definitions,
constraints, grants, policies and trigger attachments live in the per-table SQL
files. Function bodies and their execution grants live in `functions/`, grouped
by their primary table. pg-delta resolves dependencies recursively; filename order
is not a supported way to replay the source tree. Apply the generated migrations.

## Public and private school data

- `schools`: public identity and publication state. Anonymous readers see only
  approved, published schools. Owners can also read their own drafts.
- `school_profiles`: public school facts, with the same visibility boundary.
- `school_settings`: private ownership, notification address, owner instructions,
  preview state and WhatsApp identifiers. Only the owner can read it. Ownership
  and provider identifiers are platform-managed, not owner-editable.
- Catalog tables: anonymous readers see active data belonging to a published,
  approved school; owners can also read their own inactive and draft data.
- Conversations, contacts, bookings, outboxes and analytics remain owner-only.

All application routines use `SECURITY INVOKER`. Access comes from RLS and explicit
column grants, not elevated function ownership. Keep ownership predicates based
on the private settings row; it checks `auth.uid()` directly and avoids policy
recursion through public schools.

## Mutation invariants

RPCs are conveniences, not authorization boundaries. Direct owner writes must
enforce the same rules: triggers protect published identity, FAQ limits, capacity
propagation, booking status transitions and cancellation side effects.

Occurrence counters, cancellation email inserts and attendance/cancellation events
have trigger-only owner policies. Those policies require trigger execution in a
session without a temporary schema. This blocks both direct writes and attempts
to fabricate trigger depth using a temporary table. API roles cannot install
permanent routines or triggers. Do not grant them schema creation, table ownership,
or `TRIGGER` privileges; cover changes here with adversarial integration tests.

The privileged platform booking/delivery workflows retain their existing database
boundary. Owner booking triggers apply to the authenticated Data API role, so
platform workflows do not enqueue the same side effects twice.

Web chat uses a server-only Supabase secret client (no browser cookies or session
storage). Anonymous visitors call `/api/chat`, not database write endpoints. The
application checks public/preview school access before using the secret client;
conversation lookups also require the school and hashed resume token. Messages
are saved only by server-controlled user acceptance and assistant completion.
The secret bypasses RLS: do not use it for public catalog or dashboard queries.

`functions/conversations.sql` contains service-role-only invoker RPCs for atomic
conversation resolution, message append/deadline extension and message-limit
termination. Browser roles cannot call them. Resolution serializes each school/token
pair, returning only the conversation ID. Tokens are scoped to schools: using the
same token at another school creates an independent conversation, never access to
the original transcript. Expired conversations are retained as history; resolving
a web conversation does not touch WhatsApp booking intents. The advisory lock
settles concurrent first creation; a row lock coordinates expiry with message
saves and deadline extensions. Saved messages carry a generation fence so
an abandoned worker cannot save into a successor's turn. Generation claim/release
are conditional table updates, scoped to both school and conversation.

School provisioning is also platform-managed: onboarding calls the service-role-only
`create_onboarding_school` invoker RPC through the secret client after `requireUser()`.
Browser roles have no INSERT access to `users`, `schools` or `school_settings`, so
initial identity and ownership creation is an exception to cookie-client owner actions.

## Email queue claim pattern (reference for WhatsApp)

`functions/email-deliveries.sql` is the platform queue reference. All RPCs are
invoker, empty-search-path, executable only by `service_role`. Server libraries
call them with `src/lib/supabase/admin.ts` after the route's authorization check;
owners only cancel through the cookie client/RLS and the existing booking trigger.

- **Enqueue:** platform SQL workflows call `enqueue_email_delivery` inside their
  own transaction. Its unique provider key makes replay a no-op (returns null),
  not an update of an already queued/sent payload. Owner cancellation triggers
  insert directly under their narrowly scoped trigger-only policy.
- **Claim:** `pending/failed → claimed`. `claim_email_deliveries` locks due rows
  with `FOR UPDATE SKIP LOCKED`, reserves `floor(limit/5)` slots for retries,
  fills the rest with fresh rows, then refills either spare lane. It returns
  fresh-first, oldest-first snapshots. Claims do not spend an execution.
- **Start:** `start_email_delivery` conditionally increments attempts before I/O.
  The fence is **(id, state=claimed, claimed_by, claimed_at, attempts)**. Even two
  starts from the same snapshot cannot send twice. Keep timestamps as returned
  strings: converting a database microsecond timestamp to JS Date loses precision.
- **Finish/fail:** the TypeScript worker renders typed public-school/booking/lead
  data and calls Resend (or the local log), then uses a single conditional table
  update with the full fence: `claimed → sent/failed/dead`, clearing the claim.
  This needs no RPC: the predicate and update are atomic, service_role has table
  access and bypasses RLS, and browser roles have no UPDATE grant. Retry-policy.ts
  still determines permanent failures and exponential backoff (1, 2, 4, 8 minutes).
- **Recover:** `recover_email_deliveries` locks stale claims with SKIP LOCKED and
  clears their fence: `claimed → pending`, or `dead` at five started executions.
  This budget matches `MAX_EXECUTIONS` in retry-policy.ts; change both together.
  Death preserves prior diagnostics or uses `worker_crashed`, with terminal cause
  `attempts_exhausted`. The caller logs changed dead rows with `queue.dead`.
- **Provider events:** the signature-verified webhook uses a conditional table
  update by provider ID to delivered/bounced/complained, never changing dead rows.
  This preserves the existing replay/order semantics, not a new event-order model.

Locks are never held during provider I/O. Recovery cannot unsend accepted mail;
Resend's stable idempotency key protects retries within its 24-hour window. Use
unique run IDs in production. Do not replace the full fence with an ID/run-ID-only
filter. WhatsApp should reuse this protocol with queue-specific functions and
death hooks, not a dynamic-SQL generic queue RPC. Its legacy queue-claims.ts stays
unchanged until that migration.

`enqueue_email_reminders` atomically inserts reminders using the same unique key
per booking, 36-hour minimum booking lead and 24-hour reminder window. Maintenance
records its run in public.cron_runs; ending inactive conversations deliberately
still calls the legacy conversation store until #253.

During the integration-branch migration, legacy Book Trial/Lead/WhatsApp callers
still enqueue into app.email_deliveries. The dispatcher reads **public only**;
those legacy rows are intentionally not sent until their workflow tickets land.

## Changes

1. Edit the table files and/or grouped functions.
2. Run `bun run db:migrate:gen`.
3. Review the generated SQL. Structural diffs do **not** move data automatically:
   add transactional backfills before removing or enforcing moved columns.
4. Run `bun run db:migrate:up` and `bun run db:typegen`.
5. Run the integration tests and generate again to confirm no remaining drift.
