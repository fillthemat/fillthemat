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
termination. Browser roles cannot call them. Resolution serializes token identity
across ended and active conversations; saved messages carry a generation fence so
an abandoned worker cannot save into a successor's turn. Generation claim/release
are conditional table updates, scoped to both school and conversation.

## Changes

1. Edit the table files and/or grouped functions.
2. Run `bun run db:migrate:gen`.
3. Review the generated SQL. Structural diffs do **not** move data automatically:
   add transactional backfills before removing or enforcing moved columns.
4. Run `bun run db:migrate:up` and `bun run db:typegen`.
5. Run the integration tests and generate again to confirm no remaining drift.
