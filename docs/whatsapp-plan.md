# WhatsApp Channel — Decision-Ready Phased Plan

Status: **Phases 1–5 implemented.** Remaining work is **Phase 6** (human Meta production rollout).
Do not re-run the spike or Phase 5.

This file is the binding channel spec: §4 (A–L) plus the phase log below. Worker wake-up is `after()`
in the inbound webhook plus a Hobby-safe daily cron — see `docs/decisions/whatsapp-cron-after.md`.
The implemented retry policy in §1.6 supersedes older phase-era retry descriptions; decision record:
`docs/decisions/whatsapp-retry-limits-research.md` ([#79](https://github.com/fillthemat/fillthemat/issues/79)).

It began as a spike-and-plan (no code in that pass). Implementation landed in later PRs (Phases 1–4 on
`main`, Phase 5 assumed landed). Phase sections 1–5 are historical how-we-got-here, not open tasks.

---

## 1. Design summary

### 1.1 What stays shared (channel-agnostic, verified reusable)

| Layer | Where | Why it survives |
| --- | --- | --- |
| Assistant | `src/lib/ai/assistant.ts` — `ToolLoopAgent` + `stopWhen: isStepCount(8)` + tools `list_trial_offerings` / `list_trial_occurrences` / `prepare_booking` / `request_contact`; WhatsApp calls its `completedReply`. Model from `src/lib/ai/language-model.ts`: `gateway(BOOKING_AGENT_MODEL)`, or a scripted local model outside production without a Gateway token | Pure function of (school, school catalog, messages). No browser or stream dependency. |
| Immutable safety rules | `src/lib/ai/instructions.ts` (`PLATFORM_INSTRUCTIONS`) — the assistant never tells someone they are booked or will be contacted; booking and contact requests still need their confirmation through the platform. Tenant data is delimited and treated as untrusted (`assertTenantCannotOverride` test). Tool-specific requirements live in `src/lib/ai/tools/`. | Honesty and hostile-input invariants, channel-independent. |
| Slot math | `src/lib/schedule/occurrences.ts:77-145` (`listOpenSlots`, 14-day horizon, 120-min lead) + `slot-id.ts` encode/parse | Pure. |
| Booking write core | `src/lib/schedule/book-slot.ts` — single transaction, `(school_id, idempotency_key)` replay, `FOR UPDATE`, atomic `bookedCount < capacity` increment, contact/participant upsert, delivery enqueue, funnel event | The canonical write path; WhatsApp calls it with platform-minted keys. |
| Public gates | `getPublicSchoolBySlug` / `getSchoolForLandingAccess` (`src/lib/public.ts:29-66`) — approved+published | Same gate semantics apply to WhatsApp. |
| Persistence shape | `messages` rows hold `UIMessage` **parts** (`schema.ts:375-396`, `ai@7.0.84` idiom) | A text channel can reuse parts verbatim (text parts + tool parts). |
| Delivery state machine pattern | `email_deliveries`: `pending→claimed→sent→delivered\|bounced\|complained`, retryable `failed`, terminal `dead`, five started executions, minute-based backoff; `FOR UPDATE SKIP LOCKED` fresh/retry lanes, unique `providerIdempotencyKey`, `providerId` correlation | Shared policy in `src/lib/retry-policy.ts`; WhatsApp has seconds-based in-run retries (§1.6). |
| Webhook route pattern | `src/app/api/webhooks/resend/route.ts:7-49` — raw `request.text()`, size cap 64 KB → 413, signature verify, fast 200 ack, map to state enum | Copy for `/api/webhooks/whatsapp`. |
| Degradable dev pattern | `src/lib/dev-flags.ts` (`isLocalEmailNoop`) — non-prod + missing key → stub that **still advances the real state machine** (`deliveries.ts:96-110`) | Template for `isLocalWhatsAppNoop()`. |

### 1.2 What becomes a channel adapter (web-specific today)

| Concern | Web today | WhatsApp adapter |
| --- | --- | --- |
| Transport | `useChat` + `DefaultChatTransport` → POST `/api/chat`, SSE streaming (`booking-chat.tsx:47-57`) | Server-side driver: inbound webhook → load stored messages → `validateUIMessages` → run agent to completion → extract text parts → Graph API send. No SSE; needs a run-to-completion variant of the stream helpers. |
| Conversation identity | `resumeTokenHash` = SHA-256 of a per-slug **localStorage** token, **globally unique** (`schema.ts:349,356`), first-school-wins + 403 on cross-school reuse (`chat/route.ts:87-99`) | Key by **(school_id, wa_id)** (Meta-verified phone). New nullable/wa-specific key on `conversations`; `resumeTokenHash` stays for web. |
| Trust model | Turnstile + email/recipient quotas + client-minted idempotency UUID | Meta webhook signature (`X-Hub-Signature-256` over raw body with app secret), wa_id identity, wamid-based dedupe, per-wa_id quotas. |
| Booking/lead entry | Forms (`POST /api/bookings`, `/api/leads`) after agent `prepare_booking` | Agent collects; **platform writes** via `bookSlot` after explicit in-chat confirmation (product decision A). |
| History | GET `/api/chat` exists but client discards it (known gap, `docs/known-gaps.md`) | Server drives history directly from DB — no client gap. |

### 1.3 Data flow

```
INBOUND (prospect → Fillthemat)
  WhatsApp user message
    → Meta webhook POST https://<site>/api/webhooks/whatsapp
      (GET handshake: hub.mode/hub.verify_token/hub.challenge → 200 text/plain
       POST: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app_secret, rawBody)
       → verify timing-safe → size cap → fast 200 ack)
    → dedupe by wa_message_id (wamid) unique
    → resolve school via metadata.phone_number_id → schools.whatsapp_phone_number_id
    → find/create conversations keyed (school_id, wa_id)
    → persist inbound as UIMessage parts
    → claim generatingAt (single-flight, mirror chat/route.ts:111-122)
    → load history → validateUIMessages → assistant completedReply(...) (runs to completion)
    → render text from parts → enqueue whatsapp_deliveries (or send inline if in 24h window)
    → release generatingAt

OUTBOUND (Fillthemat → WhatsApp user)
  whatsapp_deliveries rows (provider idempotency key, recipient wa_id, phone_number_id, template refs)
    → claim via FOR UPDATE SKIP LOCKED (cron + inline-on-create)
    → if 24h customer-service window open (last inbound < 24h): free-form text
       POST https://graph.facebook.com/v23.0/<phone_number_id>/messages
       {messaging_product, recipient_type, to, type:"text", text:{body}}
    → explicit template delivery: template message (pre-approved, per language; window not required)
        {type:"template", template:{name, language:{code}, components}}
    → text/interactive with closed or missing window: dead (no generic template substitution)
    → store wamid in providerId; status webhook (sent|delivered|read|failed) updates state

WRITE PATHS (platform-created, after in-chat confirmation)
  lead → synthesize/map landing session (utm_source="whatsapp") → leads insert
  booking → bookSlot({school, offeringId, slotId, idempotencyKey: platform-minted, contact, participant})
    → same transaction, occupancy guard, emails (+ WhatsApp template confirmation if no email)
```

```
ASCII sequence (booking over WhatsApp):

User            Meta              /api/webhooks/whatsapp        Agent (server)        bookSlot        Graph API
 |  "Hi"           |                      |                          |                    |                |
 |--------------->|                      |                          |                    |                |
 |                |  webhook POST (signed)|                          |                    |                |
 |                |--------------------->| verify sig + dedupe      |                    |                |
 |                | 200                   | lock conversation       |                    |                |
 |                |                       | load history → agent    |                    |                |
 |                |                       |------------------------>| list_trial_occurrences |                |
 |                |                       |        slot list (text) |                    |                |
 |  "1" (slot)    |                       |-------------------------|                    |                |
 |<---------------| webhook (button/text) |  agent → prepare_booking|                    |                |
 |                |  "Confirm booking?"   |<--- outbound send ------|                    |                |
 |  "Yes"         |                       |  platform calls bookSlot|                    |                |
 |                |                       |-------------------------------  txn (idempotent, occupancy++) |
 |  confirmation  |                       |  bookSlot → wamid send  |                    |<--- POST msg --|
 +----------------------------------------+------------------------+--------------------+----------------+
```

### 1.4 Tables / schema changes (Drizzle-owned; each Phase lists its migration)

- `schools` **+** `whatsapp_phone_number_id`, `whatsapp_waba_id` (nullable, per-school tenancy).
- `contacts`: `email` becomes **nullable**; add unique `(school_id, phone)`; keep `(school_id, email)`
  unique for email-present rows. Migrates existing data untouched (email stays set for all current rows).
- `conversations`: add a WhatsApp channel key — recommended `wa_id_hash text` nullable + partial unique
  `(school_id, wa_id_hash)` (or a `channel` column; Phase 3 decides exact shape). `resumeTokenHash` stays.
- `whatsapp_deliveries` (parallel to `email_deliveries`): `state` (`pending|claimed|sent|delivered|read|failed|dead`),
  `recipientWaId`, `phoneNumberId`, `providerId` (wamid), `providerIdempotencyKey` unique, `templateName/params`,
  `windowExpiresAt`, `attempts`, `nextAttemptAt`, `claimedAt/claimedBy`, `lastError`, `failureReason`,
  `failureCode`, `terminalCause`.
- `whatsapp_jobs`: `state` (`pending|claimed|done|failed|dead`), inbound payload + unique `dedupeKey`,
  `attempts`, due/claim fields, `lastError`, `failureReason`, `terminalCause`.
- `leads.landingSessionId`: keep column but feed WhatsApp leads a synthesized session
  (`utm_source='whatsapp'`, wa-keyed) instead of relaxing the FK (least-surprise, keeps analytics).

### 1.5 Env / config (opt-in fidelity, NOT auto-filled by `bun run setup`)

```
WHATSAPP_APP_SECRET          # Meta App Secret — HMAC key for X-Hub-Signature-256
WHATSAPP_VERIFY_TOKEN        # developer-chosen string for GET handshake (NOT the app secret)
WHATSAPP_SYSTEM_USER_TOKEN   # permanent System User token (business_management, whatsapp_business_messaging, whatsapp_business_management)
WHATSAPP_API_VERSION         # default v23.0 (per provided Meta docs; parameterized everywhere)
WHATSAPP_GRAPH_BASE          # optional override, default https://graph.facebook.com
```
Local dev: no values needed — `isLocalWhatsAppNoop()` (non-prod + no token) logs + advances
`whatsapp_deliveries` to terminal states. `bun run setup` prints a hint and leaves them blank.
`bun run doctor` gains `WHATSAPP_*` report lines.

### 1.6 Bounded retries and failure notifications (implemented, #79)

Source: `src/lib/retry-policy.ts`, `src/lib/whatsapp/{jobs,deliveries,worker}.ts` and
`src/lib/email/deliveries.ts`.

- **Five started executions total**, not five retries, for inbound WhatsApp jobs and every WhatsApp/email
  delivery. The count is saved before side effects; accepted sends and crashed executions consume it.
  A fifth success is allowed. Failed status callbacks use the accepted send's count without incrementing
  it again. Single-flight deferrals do not consume an execution. WhatsApp delivery school/window preflight
  rejection does not invoke transport or consume an outbound execution.
- **`failed` is retryable; `dead` is terminal.** Shared policy stops known permanent failures immediately:
  unknown phone mapping, missing/unapproved school, closed window, missing credentials, and Meta's
  recipient, payload, template, auth/permission or policy/account failures. Rate limits, temporary service
  failures, network/HTTP/malformed responses and unknown/no-code failures get bounded retries. Classification
  uses machine reasons/codes/details, not human error prose. The code matrix is in the decision record.
  Email uses the same cap with its own request/auth/recipient vs transient provider classification.
- **Claims have two lanes**, ordered by `created_at, id` before the limit: jobs **8 fresh + 2 retry**,
  WhatsApp deliveries **20 + 5**, email deliveries **20 + 5**. Fresh means `attempts = 0`; retries include
  recovered pending rows with nonzero counts. Unused capacity refills from the other lane. Due gates and
  `SKIP LOCKED` remain; this is preference among available rows, not global or per-conversation FIFO.
- **WhatsApp retries in the same run:** initial job/delivery batches use those lanes, then the worker
  claims retries only (one row per queue per pass), sleeping for persisted due times at roughly
  **10/20/40/80 seconds** after executions 1–4. It stops when no retry is due before its deadline or
  **four minutes from run entry** have elapsed. It does not chase newly arriving fresh jobs. Started work
  is not forcibly cancelled; the deadline prevents starting further queued work and releases untouched
  claims. Both inbound webhook `after()` and daily cron run this worker. Status-only callbacks persist
  their decisions but do not wake it. The **05:00 UTC daily sweeper continues the same budget**, never
  resets it. Email retains **1/2/4/8-minute** due times and a single batch per send run, not a fast loop.
- **Callbacks/recovery:** duplicate or older failed callbacks cannot reschedule the same accepted send;
  `delivered`/`read` cannot regress to retries, and `dead` cannot revive. Stale claims keep execution
  counts and stop at the cap. Reservation/finalization are fenced by claim owner, timestamp, state and
  count, so an old worker cannot overwrite recovery. `dead` retains payload, keys, last error, structured
  reason/code (where present), count and cause (`permanent`, `attempts_exhausted`, `stale`); claims clear.
  No automatic replay exists. Bounded retries do not guarantee exactly-once delivery across network ambiguity.
- **Booking confirmation:** an unsent `booking_confirmation` delivery linked to a booking stops at/after
  class start with cause `stale`. Otherwise, terminal failure atomically enqueues one
  `owner_whatsapp_confirmation_failed` email per booking, telling the School Owner to contact the prospect.
  No owner email for stale confirmations, ordinary replies, or other templates, and none once the class
  starts. It is ordinary capped email work, sent by the email run/maintenance, not by the WhatsApp worker.
  Email death never enqueues another notification.
- **Prospect apology:** transient exhaustion of an inbound job atomically enqueues at most one fixed
  plain-text delivery keyed `job-fallback/<job.id>`: “Sorry, we're having trouble replying right now.
  Please message us again in a bit.” Only with an open window, recipient and matching school mapping;
  never on permanent failure. Tail exhaustion attempts this specific delivery inline within the remaining
  budget. Its own bounded failures cannot trigger another apology. This is **not** a closed-window
  template fallback. Today its deadline uses the latest original inbound **receipt time** for that
  school number/recipient +24h, not conversation expiry or retry processing time. Verified Meta message
  timestamps and other processing-time window calculations remain the **#78 pre-pilot gate**.
- **Visibility, not alerting:** one privacy-safe `queue.dead` log per successful terminal transition
  (row/school IDs, machine reason/code, cause, executions, run ID; no body, phone or raw provider ID).
  Worker results separate jobs `{claimed, done, retrying, dead, deferred}` and deliveries
  `{claimed, sent, retrying, dead, deferred}`. They count outcomes across executions, not unique rows;
  inline sends are separate from delivery sweep counters, and recovery deaths can exceed claimed counts.
  WhatsApp cron returns these counters and relies on logs; it does **not** write maintenance `cron_runs`.
  No operator configuration/credential alerts exist (accepted pilot gap). Minute-scale timed wakes outside
  active runs (Vercel Pro cron or Supabase `pg_cron`) are deferred; see `docs/known-gaps.md`.

---

## 2. Definition of "locally runnable & testable"

A contributor with **zero Meta credentials and no real phone number** can:

1. `bun install && bun run setup` (existing script; assigns the tree's own `127.0.0.1:30X0` origin, seeds
   `owner@local.test` / `/s/demo` approved+published). Succeeds with `WHATSAPP_*` absent.
2. `bun run dev` boots. `bun run doctor` reports `WHATSAPP_*` missing → "WhatsApp uses local stub".
3. **Outbound stub**: enqueuing a `whatsapp_deliveries` row with no token marks it `sent` locally and logs
   the would-be Graph payload (mirrors `isLocalEmailNoop` at `deliveries.ts:96-110`).
4. **Inbound replay**: `bun scripts/webhook-replay.ts whatsapp --fixture text-inbound.json` computes
   `X-Hub-Signature-256` with the local `WHATSAPP_APP_SECRET` (or a dev-stub secret) and POSTs to
   `<NEXT_PUBLIC_SITE_URL>/api/webhooks/whatsapp`. No tunnel needed.
5. **Integration tests**: vitest suite (`vitest.integration.config.ts`, `fileParallelism: false`) that signs +
   POSTs fixtures and asserts row state in `whatsapp_deliveries` / `messages` against the local Supabase.
6. **Fixture library** in `src/test/fixtures/whatsapp/` (+ `e2e/fixtures/whatsapp/` mirror):
   `text-inbound.json`, `status-delivered.json`, `status-read.json`, `status-failed.json`, `button-reply.json`.
7. **Optional real-path test**: opt-in `cloudflared`/`ngrok` tunnel doc — register the tunnel URL +
   verify token in Meta App Dashboard, then exercise against a real test phone number in the 24h window.

That is the acceptance bar for every phase below except the final production-rollout phase.

---

## 3. Phases

Ordered so the flow is locally runnable/testable as early as possible; each phase is independently
shippable and adds to the previous. **Phases 1–5 are done.** Only Phase 6 remains.

### Phase 1 — Schema + config foundation (local: runs green)

**Goal:** land every schema/config touchstone with no behavior change: WhatsApp tenancy columns, nullable
contact email, `whatsapp_deliveries`, stub dev flag, doctor lines.

**Concrete changes**
- Drizzle migration: `schools + whatsapp_phone_number_id + whatsapp_waba_id` (nullable);
  `contacts.email` → nullable + unique `(school_id, phone)` (existing `(school_id, email)` unchanged);
  new `whatsapp_deliveries` table (state machine + provider idempotency key unique + indexes on
  `state,next_attempt_at` for the claim query).
- `src/lib/dev-flags.ts` `+ isLocalWhatsAppNoop()` (non-prod + no `WHATSAPP_SYSTEM_USER_TOKEN`).
- `scripts/doctor-local.ts` `+` `WHATSAPP_*` present/absent lines.
- `.env.example` `+` the five `WHATSAPP_*` keys with comments.
- `src/lib/email/deliveries.ts` untouched (no email behavior change).

**Acceptance criteria**
- `bun run setup` + `bun run dev` succeed with no `WHATSAPP_*` values.
- `bun run test` green (unit); existing integration suite green.
- `bun run doctor` lists the stub state.

**Exact local test steps**: run the prerequisites; `grep WHATSAPP .env.example` shows keys; doctor shows
"missing → stub".

**Risks**: `contacts.email` nullability touches snapshot/confirmation code paths — keep nullable-only in
this phase, relax consumers in Phase 5 when the actual no-email path lands.

### Phase 2 — Webhook inbound contract (local: fully replayable)

**Goal:** a production-shaped `/api/webhooks/whatsapp` route: GET verify handshake, POST signature
verification over raw body, size cap, wa-message dedupe, fast 200 ack.

**Concrete changes**
- `src/app/api/webhooks/whatsapp/route.ts`:
  - GET: `hub.mode==="subscribe"` + `hub.verify_token===WHATSAPP_VERIFY_TOKEN` → 200 **text/plain**
    `hub.challenge`; mismatch → 403. Missing env → 500 `unconfigured` (Resend pattern).
  - POST: `request.text()` → cap (follow `MAX_BODY_BYTES` / `limits.ts:8`) → compute
    `sha256=` + HMAC-SHA256(app secret, rawBody) → `crypto.timingSafeEqual` on equal-length hex buffers
    (length mismatch → 401, never 500) → dedupe by wamid (`wa_message_id` unique) → parse iterating
    `entry[].changes[].value.messages[]` **defensively as an array** → persist inbound → ack 200 fast.
- `scripts/webhook-replay.ts whatsapp` CLI (sign + POST a fixture).
- `src/test/fixtures/whatsapp/*.json` + a vitest integration suite asserting signature pass/fail, 413, 401,
  dedupe, and row writes.

**Acceptance criteria**: fixture replay round-trips with correct state; wrong signature → 401; oversized →
413; duplicate wamid → single row.

**Resolved decisions at this phase**
- **D1 — env names.** `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` /
  `WHATSAPP_SYSTEM_USER_TOKEN` / `WHATSAPP_API_VERSION` / `WHATSAPP_GRAPH_BASE` (both infra spikes converge
  here). **RESOLVED (decision L): use these names.**

**Exact local test steps**: `bun run dev`; `bun scripts/webhook-replay.ts whatsapp --fixture
text-inbound.json`; observe 200 + row. Run the integration suite.

**Risks**: raw-body requirement — never `request.json()` before verifying; README-level warning in the
route comment. Concurrency: Meta retries — dedupe by wamid is the safety net, never blanket-200-then-write.

### Phase 3 — Conversation identity + persistence for WhatsApp (local: text channel works end-to-end)

**Goal:** a WhatsApp-keyed conversation that stores inbound/outbound messages as UIMessage parts, with the
same single-flight, message caps, and conversation lifecycle as web (ADR-0002).

**Concrete changes**
- `conversations` + `wa_id_hash` (nullable) + partial unique `(school_id, wa_id_hash)`; keep
  `resumeTokenHash` + global unique for web.
- Extend `/api/webhooks/whatsapp` to create/find the conversation from `metadata.phone_number_id` → school
  and `contacts[0].wa_id`, persist the inbound message, and claim/release `generatingAt` (mirror
  `chat/route.ts:111-122, 235-239`).
- Helper to load stored messages → `UIMessage[]` (mirror the POST `/api/chat` path; `validateUIMessages`
  server-side per ai docs `chatbot-message-persistence.mdx:93`).

**Acceptance criteria**: two sequential inbound messages from the same wa_id land in one conversation;
concurrent inbound on the same conversation is serialized. Per ADR-0002, a conversation ends after
30 days without a new message or at its message limit, and the next message starts a new one.
Ended conversations and their transcripts are kept; there is no transcript purge or retention deadline.

**Resolved decisions at this phase**
- **D2 — conversation message cap.** Web caps at 30 messages (429 `limit`); a long-lived WhatsApp thread
  would hit it abruptly. Options: keep 30 (simplest, symmetric), raise for WhatsApp, or window-reset.
  **RESOLVED (decision I): keep 30 for v1**; revisit with product when threads grow.

**Exact local test steps**: replay `text-inbound.json` twice; assert one conversation, two message rows,
`generatingAt` released. Unit-test the cap.

**Risks**: wa_id per (school, phone) identity means one user across two schools = two conversations
(correct); `wa_id_hash` must be nullable-only so existing web rows are untouched.

### Phase 4 — Agent loop + outbound (local: full conversation via stub)

**Goal:** inbound message drives the real agent and replies over WhatsApp: server-side run-to-completion,
outbound queue, 24h-window enforcement plus explicit utility templates, status webhook.

**Concrete changes**
- Server-side agent driver: load history → `validateUIMessages([...history, inbound])` →
  the assistant's `completedReply(...)`, run **to completion** (see D3) → extract text parts →
  enqueue reply.
- `whatsapp_deliveries` claim/send worker: inline-on-create attempt + cron `FOR UPDATE SKIP LOCKED` reuse
  (D4): explicit template rows send their registered template (D5); text/interactive rows require
  `windowExpiresAt > now`, otherwise stop `dead`. No generic template fallback.
- `src/lib/whatsapp/client.ts` (Graph transport): `WHATSAPP_SYSTEM_USER_TOKEN` + versioned base URL;
  `isLocalWhatsAppNoop()` logs + advances state when token absent.
- Extend webhook to accept status payloads (`statuses[].status` sent|delivered|read|failed, recipient_id,
  errors) → update `whatsapp_deliveries.state` by `providerId` (wamid), timestamp-guarded against
  out-of-order statuses.

**Acceptance criteria**: replay inbound → agent replies (stubbed "sent") → status fixture updates the row
state; no real Meta credentials anywhere; 24h-window logic unit-tested with synthetic `last_inbound_at`.

**Resolved decisions at this phase**
- **D3 — run-to-completion driver.** The existing helpers are SSE-oriented; plan a non-streaming
  "collect parts" wrapper around the agent (still `ToolLoopAgent`, same tools/rules). **RESOLVED: small
  internal helper, no public API change.**
- **D4 — send timing.** Daily 14:00 UTC cron is too slow for the 24h window. **RESOLVED (decision H): send
  inline on inbound-webhook completion** (the window is open by definition right after an inbound) plus the
  cron for retries/backoff.
- **D5 — template library.** Out-of-window sends need Meta-approved templates. **RESOLVED (decision G):
  Fillthemat-owned shared templates** (utility namespace, e.g. booking confirmation/reminder) in v1,
  per-school templates later.

**Exact local test steps**: replay inbound; verify a `whatsapp_deliveries` row advances
pending→claimed→sent (stub) and a synthetic `status-delivered.json` flips it to `delivered`.

**Risks**: Meta expects a fast webhook ack — the agent must not run synchronously inside the webhook
handler without a timeout strategy; prefer enqueue-then-ack with the worker doing the run, or bound the
agent run. Check the stored window before sending; Meta re-engagement error `131047` also stops the
row permanently. Only explicit utility-template deliveries can send outside the window.

### Phase 5 — WhatsApp-sourced leads and bookings (local: full funnel via replay)

**Goal:** platform-created lead + booking write paths over WhatsApp, replacing the browser+Turnstile trust
model with Meta signature + wa_id identity + per-wa_id quotas.

**Concrete changes**
- **Leads**: `POST /api/leads`-equivalent path driven by the webhook after the agent collects consent, or a
  shared `src/lib/leads/create-lead.ts`; synthesize a landing session `utm_source='whatsapp'` (D6);
  contact upsert keyed `(school_id, phone)` when no email (Phase 1 schema); owner-lead delivery stays
  email; funnel `lead_captured` with `{channel:'whatsapp'}`.
- **Bookings**: after `prepare_booking` + explicit in-chat confirmation, platform calls `bookSlot` with a
  **platform-minted** idempotency UUID (D7) and the conversation's stored pick; same transaction, occupancy
  guard, funnel `source:'chat'`; confirmation sent as WhatsApp template when contact has no email (D8).
- **Abuse controls**: per-wa_id daily caps (mirror `limits.ts` email/recipient quotas, keyed on wa_id) +
  shared WhatsApp send budget distinct from `MAX_OUTBOUND_RECIPIENTS_PER_DAY`; keep web Turnstile
  untouched.

**Acceptance criteria**: replay a full conversation to a confirmed booking → `bookings` row + occupancy +
1 and WhatsApp confirmation enqueued; replay duplicate wamid → idempotent, no double-book; per-wa_id cap
triggers 429-equivalent.

**Resolved decisions at this phase**
- **D6 — landing sessions on WhatsApp.** **RESOLVED (decision J): synthesize a pseudo session
  (`utm_source='whatsapp'`, keyed by wa conversation)** so `leads.landingSessionId NOT NULL` stays intact and
  funnel analytics keep working.
- **D7 — idempotency keys.** Meta `wamid` is not a UUID but `validation.ts:67` enforces
  `z.string().uuid()`. **RESOLVED (decision F): platform mints a UUID per confirmation** (stored on the
  inbound message), and the wamid is the **dedupe** key at the webhook layer — no schema relaxation needed.
- **D8 — confirmation medium when no email.** **RESOLVED (part of decision B): WhatsApp template (utility)
  for the prospect confirmation**; owner notifications stay email.
- **D9 — tenancy.** **RESOLVED (decision C): one shared Meta app + WABA owned by Fillthemat, per-school
  `phone_number_id`** (both infra spikes and the contract spike converged here). School mapping from webhook
  `metadata.phone_number_id`.

**Exact local test steps**: replay `button-reply.json`/text flow to confirmation; assert
booking/lead creation + delivery rows via integration suite; assert the occurrence `bookedCount`
increment and no double-write on replayed wamid.

**Risks**: email-less contact row needs the consumer tolerances (snapshot policy) to actually exist —
this is where Phase 1's nullable email is exercised for real. `cancelBooking` stays dashboard/email-only
(decision K) — no WhatsApp cancellation in v1.

### Phase 6 — Production rollout (real Meta, no longer locally testable alone)

**Goal:** go live with the real Meta stack, using the Phase 2–5 surface as the verification bed.

**Order of operations (see §5 checklist)**: Meta app → use case → WABA + phone number → System User +
permanent token → template submission → webhook HTTPS (Vercel URL) + verify/signing secrets → env on
Vercel → App Review if non-role users → pilot school → publish.

**Acceptance criteria**: real two-way message with a test phone in the 24h window; statuses flow;
template send outside the window; a real WhatsApp booking in staging then production.

**Resolved decisions at this phase**
- **D10 — ship order.** **RESOLVED (decision D): leads first, bookings second**, one pilot school approved +
  published, dashboard flag per school toggles WhatsApp active.
- **D11 — timed wake cadence in prod.** Active WhatsApp runs now retry within seconds (§1.6).
  Outside a run, the daily sweeper remains the safety net. Minute-scale timed wakes (Vercel Pro cron
  or Supabase `pg_cron`) remain **deferred for revisit**; no sub-daily Vercel cron on Hobby.

---

## 4. Resolved decisions (A–L) — operator-confirmed 2026-09-11

All spike-pass open questions are resolved exactly as confirmed below. These are binding for the
implementer; reversing one is a product decision, not an implementation detail. The inline phase blocks
(D1–D11) restate these at the point of impact.

| # | Decision | Resolution (confirmed 2026-09-11) | Binds at |
| --- | --- | --- | --- |
| A | Do bookings/leads get created over WhatsApp (platform writes) or deep-link to `/s/<slug>`? | **Platform writes** via `bookSlot` after in-chat confirmation (full funnel in WhatsApp); deep-link is a fallback for incomplete data | Phase 5 |
| B | WhatsApp contacts with no email? | `contacts.email` nullable + unique `(school_id, phone)`; WhatsApp-template confirmation when no email | Phase 1 schema, Phase 5 usage |
| C | Tenancy model | **Shared Meta app + WABA, per-school `phone_number_id`** | Phase 5 (D9) |
| D | Ship order | **Leads first, bookings second**, single pilot school, per-school toggle | Phase 6 (D10) |
| E | Conversation identity over WhatsApp | `(school_id, wa_id)` key; `resumeTokenHash` untouched for web | Phase 3 |
| F | Idempotency over WhatsApp | Platform-minted UUID per confirmation + wamid dedupe at webhook | Phase 5 (D7) |
| G | Template library | Fillthemat-owned shared utility templates v1 | Phase 4 (D5) |
| H | Send timing vs 24h window | inline send on inbound completion + existing cron for retries | Phase 4 (D4) |
| I | Message cap on long-lived threads | keep 30 for v1 | Phase 3 (D2) |
| J | Landing sessions for WhatsApp | synthesized pseudo-session `utm_source='whatsapp'` | Phase 5 (D6) |
| K | Cancellation over WhatsApp | none in v1 (email-only path stays) | Phase 5 |
| L | Webhook env names | `WHATSAPP_*` set above (converged across spikes) | Phase 2 (D1) |

---

## 5. Production readiness checklist

1. **Meta app**: register as Meta developer → `developers.facebook.com/apps/creation/` → name + contact
   email → **"Connect with customers through WhatsApp"** use case (use cases cannot be removed).
2. **Business portfolio**: connect a business portfolio (verify if required for the products used).
3. **WABA + phone number**: in API Setup, connect/create a WhatsApp Business Account; add the business
   phone number; record **WABA ID** and **`phone_number_id`** per school.
4. **System User + token**: Business Settings → System users → create admin system user → Assign Assets
   (app: Manage app, Full control; WhatsApp account: Manage WhatsApp Business accounts, Full control) →
   Generate token with `business_management`, `whatsapp_business_messaging`,
   `whatsapp_business_management` → store securely as `WHATSAPP_SYSTEM_USER_TOKEN`.
5. **Templates**: create + submit the shared utility templates (confirmation, reminder) per language;
   approvals gate out-of-window sends.
6. **Webhook**: Vercel HTTPS URL for `/api/webhooks/whatsapp`; GET verify with `WHATSAPP_VERIFY_TOKEN`;
   subscribe to `messages` + `message_template_status_update` fields; keep `WHATSAPP_APP_SECRET` (≠ verify
   token) as HMAC key.
7. **App Review**: required if used by people without a role on the app/business; budget time before
   public rollout.
8. **Env on Vercel**: the five `WHATSAPP_*` vars; keep `bun run setup`-managed local env separate.
9. **Monitoring/idempotency/retry**: inspect WhatsApp jobs/deliveries `failed` and `dead`, safe terminal
    logs and WhatsApp cron counters (not maintenance `cron_runs`); wamid dedupe, five-execution cap,
    fresh/retry lanes, in-run retry budget and per-wa_id caps. Closed-window text fails closed (`131047`),
    with no generic template fallback. Operator alerting is absent; #78 must land before the pilot.
10. **Rollout order**: staging pilot school → real test phone → leads → bookings → second school → publish.

---

## 6. Non-goals (explicit)

- **No email-auth changes in prod.** The web email/OAuth stack is untouched; WhatsApp is additive.
- **No vendor skill creation**; `skills-lock.json` stays the only skill source (spike workers already
  reverted incidental lockfile diffs).
- **No second Docker stack / parallel Postgres.** One shared local Supabase; no shadow DB in this pass.
- **No `cancelBooking` over WhatsApp in v1** (dashboard/email-only path remains).
- **No WhatsApp groups/calling APIs, no Embedded Signup onboarding, no per-school WABAs** in v1.
- **No production code was written during this spike pass** — this document + the three spike-note sets are
  the entire deliverable; implementation begins at Phase 1 under an implementer.

---

*Spike sources: `.worktrees/director-mtx2b4fb-{1,2,3}-*/docs/spike-{1,3}-notes.md`, `spike-{2,5}-notes.md`,
`spike-4-notes.md`. Grounding: `AGENTS.md`, `docs/local-development.md`, provided Meta docs (app creation +
WhatsApp Cloud API Get Started, v23.0 endpoints), `ai@7.0.84` docs, `next@16.3.3` docs.*

---

# Addendum — operator-approved revisions (2026-09-11, post-review)

Supersedes/augments the noted subsections above. Everything not mentioned here stands as written.

## D12 — Async inbound execution model (RESOLVED — closes the Phase 4 open risk)

**Decision: enqueue-then-ack.** The webhook never runs the agent. It verifies, normalizes, enqueues one
`whatsapp_jobs` row per inbound message (idempotent by `wamid`), and returns 200 immediately. A dedicated
worker claims jobs with `FOR UPDATE SKIP LOCKED` and runs the agent + outbound send. The subsequently
implemented wake decision uses inbound-webhook `after()` plus daily cron at 05:00 UTC
(`docs/decisions/whatsapp-cron-after.md`), with the bounded in-run retries in §1.6.

Rationale: an 8-step tool loop can exceed both Vercel's function timeout and Meta's webhook expectations.
This reuses the exact `claimDue*`/backoff machinery already proven in `src/lib/email/deliveries.ts`, and it
works identically in local dev.

Concrete changes (**Phase 4 scope**; relocate D4's "inline send" inside the worker):

- New table `whatsapp_jobs` (Drizzle `app` schema): `id` uuid pk; `school_id` nullable (unknown
  `phone_number_id` → `state=dead`, `failure_reason='unknown_phone_number'`); `phone_number_id` text not
  null; `dedupe_key` text not null **unique** (= inbound `wamid`); `kind` text not null default
  `'inbound_message'`; `payload` jsonb not null; `state` enum `whatsapp_job_state`
  (`pending|claimed|done|failed|dead`); `attempts` int default 0 (started executions); `next_attempt_at`;
  `claimed_at`; `claimed_by`; `last_error`; `failure_reason`; `terminal_cause`; timestamps;
  index `(state, next_attempt_at)`.
- `src/app/api/cron/whatsapp/route.ts` — `cronSecretMatches` gate → claim due jobs → process each → 200
  (mirror `src/app/api/cron/maintenance/route.ts`).
- `vercel.ts` — WhatsApp daily sweeper **`0 5 * * *`**, separate from maintenance; no minute cron on Hobby.
- `src/lib/whatsapp/worker.ts` — claim + process: resolve school via `phone_number_id` → find/create
  conversation keyed `(school_id, wa_id_hash)` → persist inbound as UIMessage parts with `messageId =
  wamid` (also gives retry idempotency via the existing `messages` unique) → claim `generatingAt`
  single-flight (mirror `chat/route.ts`; if already generating, reschedule the job shortly instead of
  failing) → `validateUIMessages([...history, inbound])` → the assistant's `completedReply(...)`, run to
  completion (D3) → persist assistant message → enqueue `whatsapp_deliveries` + attempt send (stub or Graph) →
  release `generatingAt` → mark `done`. On error: shared policy chooses retryable `failed` or terminal
  `dead` within five executions (§1.6), and always release the lock.
- `scripts/whatsapp-worker.ts --once` + `package.json` script `whatsapp:worker` — local one-shot drain;
  the replay CLI enqueues, the worker processes.

Normal inbound replies start in the same invocation via `after()`; there is no one-minute wake guarantee
for idle/recovered work. The daily sweeper is the safety net after an active run ends.

## Phase 5 additions — pending booking intent + structured capture (RESOLVED)

- **Intent storage.** New table `whatsapp_booking_intents`: `id` uuid pk; `school_id`; `conversation_id`;
  `offering_id`; `slot_id`; `participant_name`; `participant_age`; `state` enum
  `whatsapp_booking_intent_state` (`pending|confirmed|expired|superseded`); `expires_at`; timestamps;
  partial unique index on `conversation_id` `WHERE state = 'pending'` (one active intent per conversation).
- **Structured capture.** Extend `prepare_booking`'s `inputSchema` with optional `participantName` +
  `participantAge`. When its output is `ok`, the **platform** persists/refreshes the `pending` intent from
  the tool output (the agent still never writes).
- **Deterministic confirmation via reply buttons.** The confirmation prompt is sent as an interactive
  button message (`type:"interactive"`, reply `button` with `button_reply.id = "confirm_booking:<intentId>"`
  plus a "choose another time" button). The webhook recognizes `type:"interactive"`/`button` replies;
  `confirm_booking:<id>` short-circuits the agent and calls `bookSlot` directly with the stored intent and
  a platform-minted UUID idempotency key. Text fallback: pending intent + a short exact affirmative
  (`yes|confirm|yep|ok|sure`) routes to `bookSlot`; anything else routes to the agent. (Verify the exact
  interactive-message shape against the WhatsApp OpenAPI spec at implementation time.)

## Schema delta folded into Phase 1 (no-email bookings)

- `bookings.contact_email_snapshot` → **nullable** (in addition to `contacts.email` nullable already in
  §1.4), so a no-email WhatsApp booking stores null. Prospect confirmation medium = WhatsApp template when
  `contact.email IS NULL` (decisions B/D8); owner notifications stay email.
- `bookSlot` input accepts an optional email and passes `null` through to `contacts.email` and the snapshot.

## Errata (citation / copy fixes)

- `src/lib/public.ts:29-66` → **`src/lib/schools/public.ts`** (`getPublicSchoolBySlug` /
  `getSchoolForLandingAccess` live there).
- `src/lib/ai/instructions.ts` keeps the channel-independent honesty rule: booking and contact
  requests still need confirmation through the platform, without implying a web form or school follow-up.
- D4's "inline send" = inline **inside the worker** after the agent completes — never inside the webhook.
- Confirm `WHATSAPP_API_VERSION` (`v23.0`) is still a live Graph version at rollout (Meta EOLs versions).
- Phase 4: add **plain-text conversion + length split (>4096 chars)** for agent replies before enqueueing.
