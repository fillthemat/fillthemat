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
After a new cancellation, the dashboard action schedules that booking's pending
deliveries with `after()`. Sending uses the secret client, outside the owner
transaction/response; failures are logged and recovered by the durable queue.

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
  update by provider ID and allowed source states: `sent → delivered`, and
  `sent/delivered → bounced/complained`. Bounced, complained and dead remain terminal;
  stale/replayed delivery events cannot regress them or update unsent rows.

Locks are never held during provider I/O. Recovery cannot unsend accepted mail;
Resend's stable idempotency key protects retries within its 24-hour window. Use
unique run IDs in production. Do not replace the full fence with an ID/run-ID-only
filter. WhatsApp should reuse this protocol with queue-specific functions and
death hooks, not a dynamic-SQL generic queue RPC. WhatsApp now follows that
protocol below; the unused legacy queue helper has been removed.

`enqueue_email_reminders` atomically inserts reminders using the same unique key
per booking, 36-hour minimum booking lead and 24-hour reminder window. Maintenance
uses this SQL function as the only definition of the reminder rule (no TS copy),
records its run in public.cron_runs; ending inactive conversations deliberately
still calls the legacy conversation store until #253.

During the integration-branch migration, legacy Lead callers
still enqueue into app.email_deliveries. Book Trial (including the current WhatsApp
booking caller) uses the service-only `book_trial` function and public outbox.
It locks the occurrence and owns counters, emails and events: booking triggers
only handle owner status updates, never INSERT. The dispatcher and reminder scheduler
read **public only**; those emails and reminders for legacy app bookings are
intentionally not sent until #251 migrates that workflow. WhatsApp delivery
death notices now enqueue public email directly through SQL.

## WhatsApp queues

`functions/whatsapp-jobs.sql` and `functions/whatsapp-deliveries.sql` reuse the
email claim protocol: four SKIP LOCKED lanes (80% fresh / 20% retry, with refill),
durable execution start, five-execution budget, and full
`(id, claimed, claimed_by, claimed_at, attempts)` fence. Claim timestamps remain
unmodified strings in TypeScript; deadlines alone become Dates. Retry-only and
school-number-scoped sweeps retain the existing worker budget behavior.
`enqueue_whatsapp_delivery` is composable from SQL, ready for the #253 Turn.
All functions, including trigger helpers, are empty-search-path invokers with
service-role-only execution. Finalizers use one fenced table update; provider
I/O never holds a lock. Dead transitions use the shared `queue.dead` logger.

Unlike email, Meta has no send idempotency key. Start durably sets `unknown`,
clears the previous provider ID/status, and increments attempts before I/O.
The callback token `delivery-id:attempt` plus school phone-number ID can reconcile
an unknown send without a provider ID. A successor start invalidates the previous
token. Recovery preserves unknown outcomes even at budget exhaustion; positive
proof for that exact attempt can rescue an unknown/dead row. Retrying without a
receipt still carries the existing duplicate-send risk.

### Status transitions

The verified webhook calls `apply_whatsapp_status`; a plain row lock serializes
receipts against start, recovery and other callbacks. Explicit timestamps must
strictly advance; timestamp-less replays are constrained by the same state rules.

| Current state/outcome                                | Accepted receipt        | Result                                                    |
| ---------------------------------------------------- | ----------------------- | --------------------------------------------------------- |
| sent                                                 | sent / delivered / read | same / delivered / read                                   |
| sent                                                 | failed                  | failed with backoff, or dead if permanent/exhausted/stale |
| delivered                                            | read                    | read                                                      |
| read                                                 | any                     | ignored                                                   |
| failed/pending/claimed, same known failed attempt    | delivered / read        | confirmed; cancel scheduled retry/claim                   |
| failed, known rejected/accepted failure              | sent / failed           | ignored                                                   |
| pending/claimed/failed/dead, unknown current attempt | sent / delivered / read | receipt state; retry/claim cleared                        |
| pending/claimed/failed, unknown current attempt      | failed                  | failed/dead; outcome becomes accepted                     |
| dead, known outcome                                  | any                     | ignored                                                   |

All other regressions/replays are ignored. In particular, delivered/read cannot
be failed. For the same attempt, delivered/read evidence can cancel a known
failure's retry; sent cannot. A new execution clears the old provider ID and
invalidates those receipts. Known dead rows remain terminal; only unknown dead
outcomes can be rescued.

AFTER UPDATE invoker hooks attach cross-outbox effects to the transition itself:
job exhaustion atomically queues a deduplicated apology within the latest inbound
receipt's 24-hour service window, resolving the school via private
`school_settings.whatsapp_phone_number_id`; confirmation death atomically calls
`enqueue_email_delivery` with the private notification address. Stale confirmations
do not notify. Delivered/read removes only pending/failed, zero-execution owner
notices; started/sent email cannot safely be recalled. Recovery uses the same hooks.

### Temporary Turn seam (#253)

The Turn, inbound school resolution, conversation store and booking intents still
use legacy Drizzle. **WhatsApp replies do not work end to end until #253 because
the Turn still resolves legacy schools.** Queue school identity is independently
resolved from private public school settings by the job/delivery phone-number ID,
never from the legacy Turn's school ID. Failed Turn processing consumes an execution;
per-job persistence failures are logged/deferred without aborting the batch.
The worker commits that Turn first and then enqueues its
public delivery intents. A crash/enqueue failure between these commits can lose
the reply after its inbound duplicate marker commits. This is the explicitly
accepted integration-branch non-atomic seam, not an atomic outbox guarantee.
The no-intent `handleConfirmation` path also saves the inbound message and queues
the notice separately, with the same gap. There is no dual-read/write queue.
Hooks intentionally use transaction `now()` for receipt-window/notification
eligibility on every path, including fenced table finalizers without `p_now`;
RPC `p_now` controls claim/recovery cutoffs and retry scheduling only.
Legacy `app` seeds are empty locally: full
assistant/confirmation Turns cannot run end-to-end until #253. Book Trial now
returns public booking IDs compatible with the public confirmation/death hooks;
the legacy Turn/intent/transcript path still prevents full WhatsApp confirmation.
Atomic booking plus confirmation transcript/reply writes remain #254; `booking.ts`
still uses legacy school/intent/message lookups and deliberately omits the legacy
conversation ID from `book_trial`. Queue identity does not bridge those Turn IDs.
Public queue mechanics and signed webhooks are verified
directly in `queues.integration.test.ts` in the meantime.

## Changes

1. Edit the table files and/or grouped functions.
2. Run `bun run db:migrate:gen`.
3. Review the generated SQL. Structural diffs do **not** move data automatically:
   add transactional backfills before removing or enforcing moved columns.
4. Run `bun run db:migrate:up` and `bun run db:typegen`.
5. Run the integration tests and generate again to confirm no remaining drift.
