# Phase 6 — WhatsApp production rollout (human-only)

**Do not paste this into a Director implementation session.** Phases 1–5 are the code. Phase 6 is
Meta + Vercel + one pilot school. A Director sub-agent cannot register a Meta app, submit templates,
or complete App Review.

After [PR #38](https://github.com/jakegoodmandev/fillthemat/pull/38) (Phase 5) is merged and migrated,
the product path is live in stub mode. This document is the operator runbook.

Source of truth: `docs/whatsapp-plan.md` §3 Phase 6, §5 production checklist, decisions **C / D / G /
D10 / D11** and §1.6 (implemented bounded retries), plus `docs/decisions/whatsapp-cron-after.md`
(Hobby-safe daily cron; do not add a sub-daily Vercel cron on Hobby) and
`docs/decisions/whatsapp-retry-limits-research.md` (#79 shipped policy).

---

## 0. What is already shipped (do not re-derive)

| Phase | In tree |
| --- | --- |
| 1 | `whatsapp_deliveries`, nullable `contacts.email` + unique `(school_id, phone)`, `schools.whatsapp_phone_number_id` / `whatsapp_waba_id`, `isLocalWhatsAppNoop()` |
| 2 | `/api/webhooks/whatsapp` GET verify + POST `X-Hub-Signature-256`, wamid dedupe, replay CLI |
| 3 | `conversations.wa_id_hash`, inbound UIMessage parts, `generatingAt` |
| 4 | `whatsapp_jobs` worker, Graph client + noop, 24h window enforced for text/interactive; explicit utility templates only, `after()` wake, typing indicator, daily cron `0 5 * * *` |
| 5 | intents + confirmation buttons, shared `create-lead`, `bookSlot` no-email + WA template confirmation, per-`wa_id` caps |
| #79 | terminal `dead`, five-execution cap for WhatsApp jobs and WhatsApp/email sends, fresh/retry claim lanes, bounded in-run WhatsApp retries, stale-confirmation cutoff, owner email and one in-window prospect apology |

**Toggle today:** a school is WhatsApp-routable iff `schools.whatsapp_phone_number_id` is set (unique
when non-null). Local seed uses `LOCAL_WHATSAPP_PHONE_NUMBER_ID`. There is **no dashboard UI** for
these columns and **no extra boolean flag**. D10's "per-school toggle" is: set or clear
`whatsapp_phone_number_id` (and `whatsapp_waba_id`) on the pilot row. If you want an owner-facing
settings form, that is a **separate, optional, small Director task** — not Phase 6.

---

## 1. Preconditions (code)

1. Merge Phase 5 and #79. Apply all committed Drizzle migrations on staging then production (including
   job/WhatsApp/email `dead` enums, failure metadata, legacy accepted-send backfill, and new owner email kind).
2. Confirm production/staging has the Hobby-safe cron only: `vercel.ts` → `/api/cron/whatsapp` at `0 5 * * *`.
   D11: do **not** add a 1-minute / 5-minute cron unless you are on Pro **and** the pilot proves need.
3. Confirm `WHATSAPP_API_VERSION` default (`src/lib/whatsapp/config.ts`, currently `v26.0`) is still a
   live Graph version. Meta EOLs versions. If it is dead, bump the default **and** the Vercel env together.
4. Template **names and body variable counts** in `src/lib/whatsapp/templates.ts` must match Meta
   exactly (`en_US`):

   | name | body params (order) |
   | --- | --- |
   | `booking_confirmation` | school, participant, offering, when |
   | `booking_reminder` | school, participant, when |
   | `lead_confirmation` | school |

   Local render strings in that file are **not** what Meta stores. You submit real copy in Business
   Manager; Graph send only passes the name + ordered body params.

5. Optional deploy-time check (not required locally): `after()` / `waitUntil` actually runs on the
    Vercel runtime you ship. Daily cron is the safety net if it does not.
6. **Pre-pilot correctness gate: [#78](https://github.com/fillthemat/fillthemat/issues/78).** Customer-service
   windows must use the verified customer's message time, not processing time. #79 does not fix that bug;
   its apology uses original inbound receipt time, which still is not the verified Meta timestamp.

---

## 2. Env (Vercel — never `bun run setup`)

Five keys (`.env.example`). Local stays blank → stub.

```
WHATSAPP_APP_SECRET            # Meta App Secret; HMAC for X-Hub-Signature-256. NOT the verify token.
WHATSAPP_VERIFY_TOKEN          # you invent this string; Meta GET handshake must match.
WHATSAPP_SYSTEM_USER_TOKEN     # permanent System User token (see §3.4)
WHATSAPP_API_VERSION           # e.g. v26.0 if still live; else the current Graph version
WHATSAPP_GRAPH_BASE            # optional; default https://graph.facebook.com
```

Set them on the **staging** Vercel project first, then production. Do not put real tokens in
`.env.local` on a worktree unless you are deliberately leaving stub mode.

Also required and already used by the app: `CRON_SECRET` (cron routes), `NEXT_PUBLIC_SITE_URL`
(must be the HTTPS origin Meta will call).

---

## 3. Meta setup (order of operations)

Follow this order. Use cases cannot be removed once added.

### 3.1 Meta app

1. [developers.facebook.com/apps/creation/](https://developers.facebook.com/apps/creation/)
2. Name + contact email.
3. Use case: **"Connect with customers through WhatsApp"**.

### 3.2 Business portfolio

Connect a business portfolio. Complete business verification if Meta requires it for the products
you actually use (WABA + system user + templates).

### 3.3 WABA + phone number (decision C)

One **shared** Fillthemat Meta app + WABA. Per-school Cloud API `phone_number_id`.

In WhatsApp → API Setup:

1. Connect or create the WhatsApp Business Account. Record **WABA ID**.
2. Add the **pilot school's** business phone number. Record **`phone_number_id`**.
3. Write those onto the pilot `schools` row (`whatsapp_waba_id`, `whatsapp_phone_number_id`).
   Until that row is set, inbound webhooks for that number resolve to unknown-phone and fail closed.

Do **not** create per-school WABAs or Embedded Signup in v1 (plan non-goals).

### 3.4 System User + permanent token

Business Settings → System users:

1. Create an **admin** system user.
2. Assign assets: app (Manage app, Full control); WhatsApp account (Manage WhatsApp Business
   accounts, Full control).
3. Generate a token with:
   - `business_management`
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. Store it as `WHATSAPP_SYSTEM_USER_TOKEN` on Vercel. Treat it as a production secret.

### 3.5 Utility templates (decision G)

Submit **Fillthemat-owned** shared templates, language `en_US`, names **identical** to the registry
above. Approvals gate **out-of-window** sends (and Phase 5's no-email booking confirmation, which
always uses `booking_confirmation`).

Submit at least:

- `booking_confirmation` (4 body vars)
- `booking_reminder` (3 body vars)
- `lead_confirmation` (1 body var)

Wait for **APPROVED** before testing out-of-window or relying on no-email confirmation in prod.
In-window free-form text still works without templates.

### 3.6 Webhook

Callback URL: `https://<NEXT_PUBLIC_SITE_URL>/api/webhooks/whatsapp`

- GET verify: `hub.mode=subscribe` + `hub.verify_token === WHATSAPP_VERIFY_TOKEN` → 200 `text/plain`
  challenge (already implemented).
- Subscribe fields: `messages` and `message_template_status_update`.
- App secret = `WHATSAPP_APP_SECRET` (HMAC). Must differ from the verify token.

Meta must be able to reach this URL from the public internet. Staging Vercel origin first.

### 3.7 App Review

Required only if people **without a role** on the app/business will message the number. Budget this
before a public (non-tester) rollout. Testers/roles can exercise the number before Review.

---

## 4. Pilot school enablement (decision D / D10)

Ship order is **leads first, bookings second**, **one** approved + published school.

1. School is `approvedAt` + `publishedAt` (same public gate as `/s/<slug>`).
2. Set `whatsapp_phone_number_id` + `whatsapp_waba_id` on that row only.
3. Leave every other school null → they never match inbound `metadata.phone_number_id`.
4. Do **not** enable a second school until the acceptance bar below is green.

v1: **no WhatsApp cancellation** (decision K). Point the pilot owner at the dashboard/email cancel
path.

---

## 5. Acceptance bar (real Meta — not replay)

All of these on **staging**, then the same on **production** with the pilot number.

1. **Two-way in-window:** send a text from a test phone (app role / tester) → webhook 200, job
   processed, reply arrives in WhatsApp. Typing indicator optional-nice.
2. **Statuses:** outbound `whatsapp_deliveries` moves `sent` → `delivered` (and `read` if the client
   sends it). Failed Graph sends surface `last_error`, not a silent pending.
3. **Lead path first:** consent → `leads` row, synthesized landing session `utm_source='whatsapp'`,
   contact upsert on `(school_id, phone)` if no email, `lead_captured` with `{channel:'whatsapp'}`,
   owner email still fires.
4. **Booking path second:** `prepare_booking` → interactive confirm → `bookings` row, occupancy +1,
   no double-write on Meta retry of the same wamid. No-email contact → `booking_confirmation`
    template enqueued (needs the template APPROVED even inside 24h; checking the row alone is not delivery).
5. **Out-of-window template:** after 24h with no inbound (or force-closed window in a controlled
   test), a template send succeeds once approved.
6. **Caps:** do not load-test a real number into the daily cap; the integration tests already cover
   429-equivalent. Spot-check that prod logging would show the notice path.

Only then: production env + production webhook + production school row → **publish** (school already
published; "publish" here means the WhatsApp number is the live customer channel). Second school is
a later ops step: another `phone_number_id` on another row, same WABA.

---

## 6. Retry behavior and monitoring

Implemented states:

- Jobs: `pending|claimed|done|failed|dead`; WhatsApp deliveries:
  `pending|claimed|sent|delivered|read|failed|dead`; email:
  `pending|claimed|sent|failed|delivered|bounced|complained|dead`.
- `failed` means retryable; `dead` means no automatic retry/replay. Rows keep payload, dedupe key,
  execution count, last error, structured failure reason/code where present and terminal cause
  (`permanent`, `attempts_exhausted`, `stale`); active claims clear.
- **Five started executions total** across all runs. Counts are saved before side effects, so accepted
  sends and crashes consume the budget; a fifth success is allowed. Single-flight deferrals do not
  consume it, and failed status callbacks do not increment it again. Delivered/read cannot regress
  into retries, duplicate/out-of-order failures cannot reschedule a send, and dead rows cannot revive.
- Known permanent school/mapping/window/credential failures and Meta recipient/payload/template/auth/
  permission/policy errors stop immediately. Rate limits, temporary/network failures and unknown/no-code
  outcomes retry within the cap. Shared classifier: `src/lib/retry-policy.ts`; matrix: the decision record.
- Initial claims reserve **8 fresh + 2 retry jobs**, **20 + 5 WhatsApp deliveries**, and **20 + 5 email
  deliveries**, refilling unused capacity. Each lane is oldest-first by `created_at, id` under `SKIP LOCKED`.
- In both inbound `after()` and cron runs, initial fresh-first batches are followed by retry-only claims
  with roughly **10/20/40/80-second** due times, within **four minutes from run entry**. The worker stops
  when no retry is due before the deadline, does not chase new fresh arrivals, and does not cancel work
  already started. Daily cron continues remaining work without resetting the cap. Email still uses
  **1/2/4/8-minute** due gates and ordinary email runs/maintenance, not this fast loop. Status-only
  callbacks do not wake the WhatsApp worker.
- Text/interactive with a closed or missing window stops permanently; Meta's re-engagement code is
  **`131047`**. **No generic template fallback exists.** Explicit registered utility templates are separate.
- Booking confirmations stop stale at/after class start, without owner mail. Non-stale confirmation
  death atomically enqueues one `owner_whatsapp_confirmation_failed` email per booking, unless class
  has already started. Ordinary replies/other templates do not notify owners; email death never recurses.
- Inbound transient exhaustion can enqueue one fixed in-window “trouble replying” plain-text apology,
  deduped per job, with normal send caps and no recursive fallback. No apology for permanent failures
  or closed windows. Its receipt-based window assumption remains subject to #78.

No new product monitoring surface or operator alerting exists. For diagnosis, inspect:

- `whatsapp_jobs` / `whatsapp_deliveries` stuck `claimed`, retryable `failed`, and terminal `dead` counts
  and reasons. Stale claims recover with counts intact; exhausted claims stop, never get a fresh budget.
- One privacy-safe `queue.dead` log per successful terminal transition: row/school IDs, machine
  reason/code, cause, execution count and run ID; no message body, phone or raw provider ID.
- `/api/cron/whatsapp` at 05:00 UTC returns job `{claimed, done, retrying, dead, deferred}` and delivery
  `{claimed, sent, retrying, dead, deferred}` counters; use its Vercel logs/response. Counters aggregate
  execution outcomes, not unique rows; inline sends are separate and recovery deaths can exceed claims.
  The route **does not write `cron_runs`**; those rows/dashboard health are email-maintenance metrics.
- Wamid uniqueness: duplicate Meta deliveries must no-op.
- Per-`wa_id` caps in `src/lib/security/limits.ts` (`MAX_BOOKINGS_PER_WA_ID_PER_DAY`,
  `MAX_WHATSAPP_OUTBOUND_PER_WA_ID_PER_DAY`) — distinct from email recipient quota.

Nobody is assigned to watch these logs/rows. **No operator configuration/credential alerting** is an
accepted pilot gap, not an implemented control. Owner booking-confirmation emails are actionable
business notifications, not infrastructure alerts. See `docs/known-gaps.md` for the gap and deferred
minute-scale timed wakes outside active runs.

---

## 7. Explicit non-goals (still)

- No Director re-implementation of Phases 1–5.
- No sub-daily Vercel cron on Hobby (D11 deferred).
- No `cancelBooking` over WhatsApp.
- No per-school WABAs, Embedded Signup, groups, calling.
- No email/OAuth changes.
- Do not put production `WHATSAPP_*` in worktree `.env.local` as a matter of course.

---

## 8. Optional follow-ups (only if you want code)

These are **not** Phase 6. Each is a small, separate Director plan if you choose:

1. **Dashboard WhatsApp settings** — owner (or you) can set/clear `whatsapp_phone_number_id` /
   `whatsapp_waba_id` without SQL. Closest match to D10's "dashboard flag".
2. **Graph version bump** — if `v26.0` is EOL at rollout.
3. **Minute-scale timed retry wake** — Vercel Pro cron or Supabase `pg_cron`, deferred for revisit if
   daily idle recovery is too slow (D11); active-run retries already exist.
4. **Operator alerting** — configuration/credential failures remain logs + table only, with no assigned
   watcher. Define a recipient, dedupe and recursion policy before adding alerts.

---

## 9. Operator checklist (copy/paste)

```
[ ] Phase 5 + #79 merged; all committed Drizzle migrations applied on staging then prod
[ ] #78 verified inbound-message window timestamp fix shipped before pilot
[ ] Accepted operator-alerting gap understood; WhatsApp logs/counters are not maintenance cron_runs
[ ] Graph version still live; WHATSAPP_API_VERSION set to match
[ ] Meta app + WhatsApp use case
[ ] Business portfolio (+ verification if required)
[ ] WABA + pilot phone_number_id recorded
[ ] System User token on Vercel (staging)
[ ] Templates submitted; booking_confirmation APPROVED before no-email / out-of-window
[ ] Webhook URL + verify token + app secret; fields messages + message_template_status_update
[ ] Staging: two-way in-window message
[ ] Staging: delivery statuses
[ ] Staging: lead on WhatsApp
[ ] Staging: booking on WhatsApp (then out-of-window template)
[ ] Pilot school row: approved+published + whatsapp_* columns set; all other schools null
[ ] Same env + webhook on production
[ ] Production smoke on a tester number
[ ] App Review if non-role users will write in
[ ] Second school: later, new phone_number_id only
```
