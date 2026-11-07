---
status: accepted
---

# Use table writes for enforced single-table changes; functions for atomic workflows

Use a supabase-js table write (`insert`, `update` or `delete`) when it touches one table and every rule is already enforced by grants, RLS, constraints or triggers. An optimistic-concurrency filter, such as a matching `updated_at`, is fine: the check and write happen in one statement. The offering edits and FAQ updates/deletes in `src/app/dashboard/settings/mutations.ts` are the reference.

Use a Postgres function via `.rpc()` when several statements must commit together, the work needs a row lock, advisory lock or `SKIP LOCKED` queue claim, a read-then-write decision could race, or database failures must map to domain codes such as `slot_unavailable`. Dashboard booking cancellation is the reference: `src/app/dashboard/bookings/actions.ts` calls `cancel_dashboard_booking` in `supabase/schemas/functions/bookings.sql`, which locks the booking before deciding and updating; triggers apply the cancellation side effects atomically.

supabase-js has no multi-statement transactions. Separate requests cannot make a cross-table workflow atomic, and a TypeScript read followed by a write cannot hold a database lock between them. Conversely, a function is unnecessary for a single-table write whose invariants the database already enforces. RPCs do not replace grants, RLS, constraints or triggers: direct writes must enforce the same rules.

## Function access and composition

- Every function is `SECURITY INVOKER`.
- Owner actions use the cookie client (`src/lib/supabase/server.ts`), so RLS applies.
- Platform workflows (public API routes, webhooks, crons and the WhatsApp worker) use the server-only secret client (`src/lib/supabase/admin.ts`), only after application-level access checks. Their functions are executable by `service_role` only, not browser roles. The secret bypasses RLS; invoker does not make it safe without those checks. Web chat's `src/lib/web-chat/conversation-store.ts` and `supabase/schemas/functions/conversations.sql` are the existing precedent.
- Compose atomic workflows by SQL functions calling SQL functions, never by passing transactions between TypeScript modules.

## Amendment to ADR 0005

This amends [ADR 0005](0005-core-boundary-behind-driver-seam-proof.md): the Turn, its domain effects and its outbound intents still commit or roll back together, now inside one Postgres function rather than a Drizzle transaction with an app-effect callback. Scope and control checks stay inside that atomic boundary. The conditional core boundary and driver-seam proof remain unchanged.
