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
a web conversation expires pending intents through the shared end trigger. The advisory lock
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
records its run in public.cron_runs and calls `end_inactive_conversations` on public.

Lead Request uses the service-only `create_lead` invoker function for contact
upsert, school-scoped landing-session attachment, lead, owner email and funnel event.
It requires a published, approved school. Web submissions reuse a token-hashed
session; WhatsApp supplies the stable wa-hashed pseudo-session key. Every submission
creates a new lead, preserving the existing no-replay-key semantics; each lead gets
one owner email with a unique provider key unless the trimmed notification address
is blank. SQL callers can compose it in an outer
transaction. Application access, CAPTCHA and recipient limits stay before the RPC;
the route attempts delivery only after the RPC commits.

WhatsApp composes `create_lead` inside `commit_whatsapp_turn`, so the inbound
replay marker, lead, owner email, event, assistant message and WhatsApp reply
outbox commit together. No legacy adapter or public/legacy identity bridge remains.

During the integration-branch migration, Book Trial (including the current WhatsApp
booking caller) uses the service-only `book_trial` function and public outbox.
It locks the occurrence and owns counters, emails and events: booking triggers
only handle owner status updates, never INSERT. The dispatcher and reminder scheduler
read **public only**. WhatsApp delivery
death notices now enqueue public email directly through SQL.

## WhatsApp queues

`functions/whatsapp-jobs.sql` and `functions/whatsapp-deliveries.sql` reuse the
email claim protocol: four SKIP LOCKED lanes (80% fresh / 20% retry, with refill),
durable execution start, five-execution budget, and full
`(id, claimed, claimed_by, claimed_at, attempts)` fence. Claim timestamps remain
unmodified strings in TypeScript; deadlines alone become Dates. Retry-only and
school-number-scoped sweeps retain the existing worker budget behavior.
`commit_whatsapp_turn` composes `enqueue_whatsapp_delivery` inside its transaction.
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

### WhatsApp Turn contract

`functions/whatsapp-turns.sql` owns `commit_whatsapp_turn`, an empty-search-path
SECURITY INVOKER function executable only by service_role (plus its SQL owner).
The application prepares assistant output; the function commits it. Inputs:

- Public school/conversation IDs, generation timestamp string, raw recipient and
  school phone-number ID. SQL checks publication, routing, identity and generation.
- Inbound row UUID, provider wamid and text; assistant row UUID, UI message ID,
  text and pre-split text chunks; timestamp for lifecycle deadlines.
- One typed prepared effect: `reply`, `booking_intent` (offering, encoded slot,
  participant name/age), `lead_request` (offering, participant details, contact name,
  stated need).

Effects in order: inbound append/deadline extension; pending intent supersession
and replacement OR `create_lead` (including contact, email and event); assistant
append; reply enqueue. For a Booking Intent, the interactive confirmation notice
is the reply delivery, not a duplicate text send. SQL builds buttons from the new
intent ID. Lead contact attachment is school-scoped. SQL validates slot
window/offering scope; confirmation must recheck availability. No booking is created.

Return: explicit `already_committed` flag, assistant row ID, optional lead ID,
queued delivery IDs. Inbound replay across active or ended conversations returns
`already_committed: true` with no writes or queued deliveries. Empty model output
saves the user message and an empty assistant message, queues no reply, and
completes the job without retry. The worker rejects missing or unpublished/unapproved
schools permanently before conversation creation, with no apology. Stale generation
or mismatched scope raises `generation_or_scope_lost`; malformed effects/chunks,
cross-tenant references and constraint/append/outbox failures raise and roll back
**all** writes. Email and WhatsApp sends happen only after commit; durable outboxes
recover crashes between commit and send. Trace creation/export stays outside SQL
and unchanged (ADR 0001).

### Conversation identity and maintenance

WhatsApp resolves by `(school_id, hashWaId(wa_id))`, using the existing partial
unique index for one open conversation and a per-identity advisory lock for first
creation. Each WhatsApp row gets a random, unshared SHA-256 resume-token hash to
satisfy the shared NOT NULL column; it is never used for WhatsApp routing. Web chat
still resolves by its real resume-token hash. Both share generation claim/release,
fenced append/deadline extension, transcript reads and message-limit termination.
Atomic Turns use `clock_timestamp()` for message creation so inbound precedes reply
even when both inserts share the transaction timestamp.

Maintenance ends expired public conversations on **both** channels, retains every
message, and skips live generation claims (ten-minute abandonment threshold).
Every end transition expires pending intents through an invoker trigger;
maintenance also expires 30-minute intents on conversations that remain open.
Web-chat lazy expiry is preserved, with proactive maintenance now reaching public
web-chat rows too. An expired WhatsApp conversation with a live worker is not replaced.

### WhatsApp booking confirmation

`functions/whatsapp-booking-intents.sql` owns `confirm_whatsapp_booking`, a
service-role-only, empty-search-path SECURITY INVOKER boundary. It locks and checks
the public conversation's school, recipient, routing and generation before locking
the intent in the same conversation. An inbound replay returns `already_committed`
with no effects, even across conversation replacement. Missing, expired, superseded
or confirmed intents return the existing expired-option notice without booking.

A live pending intent passes the public-school recipient booking quota (six per
24 hours, serialized per identity) and concrete-age check. SQL calls `book_trial`
with the public conversation ID, then marks the intent confirmed. The inbound,
assistant confirmation and WhatsApp template outbox commit with the booking,
capacity, owner email and event. The inbound append extends the generation's
deadline before booking, and `clock_timestamp()` preserves user-before-assistant
ordering. Expected Book Trial failures queue existing notices; unexpected errors
roll back everything. Failure notices retain the inbound-only transcript policy.
Sending happens after commit; replay suppresses sends, email attempts and answer
tracing. The existing template/booking linkage retains confirmation-death owner
notices and delivered/read cleanup hooks. No Drizzle or multi-request confirmation
write path remains.

Hooks intentionally use transaction `now()` for receipt-window/notification
eligibility; queue RPC `p_now` controls claim/recovery scheduling only.

## Changes

1. Edit the table files and/or grouped functions.
2. Run `bun run db:migrate:gen`.
3. Review the generated SQL. Structural diffs do **not** move data automatically:
   add transactional backfills before removing or enforcing moved columns.
4. Run `bun run db:migrate:up` and `bun run db:typegen`.
5. Run the integration tests and generate again to confirm no remaining drift.
