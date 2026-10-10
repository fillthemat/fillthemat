# Spike: Supabase-triggered WhatsApp worker vs. `after()` — decision doc

**Status:** accepted and implemented (`after()` in the WhatsApp webhook + typing indicator + Hobby-safe daily cron `0 5 * * *` on `/api/cron/whatsapp`). Do not reopen unless production needs sub-daily retries.

**Date:** 2026-09-11
**Scope:** evaluate replacing the Vercel 1-minute cron that PR #34 adds for the
WhatsApp outbound worker with (a) a Supabase `pg_cron`/pgmq trigger, or
(b) `next@16.3.3` `after()` in the inbound webhook. Include the WhatsApp typing
indicator as the perceived-immediacy lever.

**Retry update (2026-10-09, #79 implemented):** active worker runs now retry WhatsApp jobs/deliveries
at roughly 10/20/40/80 seconds within four minutes from entry, with a five-execution cap. The daily
sweeper continues remaining work without resetting counts. This does not add a sub-daily timer outside
an active run; Vercel Pro cron / Supabase `pg_cron` remain deferred for revisit. Later references here
to retries becoming daily describe the original scheduler tradeoff, not the new in-run loop. Current
behavior: `docs/whatsapp-plan.md` §1.6; decision record: `whatsapp-retry-limits-research.md`.

All findings below were checked against the actual Phase 4 code on
`origin/director/mtxa15ws/wt1`, the installed `node_modules/next/dist/docs/` and
`node_modules/ai/docs/`, the local Supabase stack, and current vendor docs
(Supabase/Vercel/Meta pages fetched 2026-09-11).

---

## TL;DR recommendation

1. **Do not adopt a Supabase trigger as the primary wake-up.** It is either a
   periodic poll in disguise (`pg_cron` → `pg_net` → HTTP ping) or a queue that
   still has no always-on consumer on Supabase's serverless product (`pgmq` +
   Edge Functions/Realtime). It adds a migration, a secret hand-off, and a
   monitoring surface to fix a problem that `after()` fixes for free.
2. **Adopt `next@16.3.3` `after()` in the WhatsApp webhook.** It is stable and
   documented; it kicks `runWhatsAppWorkerOnce` in the same response lifecycle,
   turning enqueue-then-ack into enqueue → ack → immediate worker — with the
   60 s worst-case dispatch delay gone. Keep the DB claim/idempotency semantics
   exactly as they are (`dedupe_key = wamid`, `FOR UPDATE SKIP LOCKED`).
3. **Add the WhatsApp typing indicator synchronously in the webhook.** It is a
   free, ~1-call, ~1 s perceived-latency win and is the real UX lever. It is a
   `status:"read"` read receipt extended with `typing_indicator`, not a
   standalone `type:"typing"` message (see Q4).
4. **Keep a Hobby-safe daily Vercel cron as a sweeper** (replace the failing
   `* * * * *` entry with `0 5 * * *`) and add stuck-`claimed` recovery so a
   crashed `after()` invocation never strands a job.

This keeps Phase 4 on the Hobby plan, is the fewest-moving-parts design, and
gives the fastest perceived reply cadence. Treat Supabase `pg_cron` as the
fallback for *later* if time-based retry cadence ever needs to be sub-daily
without paying for Vercel Pro (sketch provided in §Q1).

---

## Grounding: what Phase 4 does today

`origin/director/mtxa15ws/wt1` (PR #34) adds:

- `src/lib/whatsapp/jobs.ts` — `enqueueInboundJobs` inserts one
  `whatsapp_jobs` row per inbound message, `ON CONFLICT DO NOTHING` on
  `dedupe_key` (= inbound `wamid`). `claimDueWhatsAppJobs` claims due rows with
  `SELECT … FOR UPDATE SKIP LOCKED`, `state IN (pending, failed)`,
  `next_attempt_at <= now()`.
- `src/lib/whatsapp/worker.ts` — `runWhatsAppWorkerOnce(runId)` →
  `drainWhatsAppJobs` (the assistant's `completedReply`, then inline send) +
  `drainDueWhatsAppDeliveries` (retry/backoff).
- `src/app/api/cron/whatsapp/route.ts` — `cronSecretMatches` → `runWhatsAppWorkerOnce`.
- `vercel.ts` — adds `{ path: "/api/cron/whatsapp", schedule: "* * * * *" }`.
- `src/app/api/webhooks/whatsapp/route.ts` — enqueue-then-ack (D12): parse,
  apply statuses, enqueue jobs, `return Response.json({ ok: true })`.

The deploy blocker: Vercel Hobby's minimum cron interval is **once per day**
(per-hour, ±59 min precision). The `* * * * *` entry fails the preview deploy
("redirects to vercel.com/docs/cron-jobs/usage-and-pricing"). Pro's minimum is
once per minute.

Latency today (if the minute cron deployed): webhook enqueues and 200s fast;
the worker only wakes on the next minute tick, so the reply is dispatched
0–60 s later **plus** generation time. No typing indicator today — the chat is
silent until the full reply lands.

---

## Q1 — Supabase `pg_cron`: versions, cadence, and trigger shape

**Verified on the local stack** (`public.ecr.aws/supabase/postgres:17.6.1.165`,
`docker exec supabase_db_fillthemat`):

```
pg_available_extensions:
  pg_cron  1.6.4
  pg_net   0.20.4
  pgmq     1.5.1
server_version: 17.6
```

None of the three are enabled by default (`installed_version` is empty).

**Supabase docs (fetched 2026-09-11):**

- Cron guide: "Cron Jobs can be created via SQL or the Dashboard, and can run
  anywhere from **every second to once a year** depending on your use case."
  "For best performance, we recommend no more than 8 Jobs run concurrently.
  Each Job should run no more than 10 minutes."
- Cron quickstart: "You can input seconds for your Job schedule interval **as
  long as you're on Postgres version 15.1.1.61 or later.**" — local is 17.6, so
  minute and sub-minute schedules work.
- Plan gating: `pg_cron`/Subabase Cron are not listed as gated features in the
  pricing matrix (Database section). The real free-tier caveats are: **Free
  projects pause after 1 week of inactivity** (would kill a background
  producer), and Free runs on shared compute with 2 active projects. A
  production background trigger therefore practically implies Supabase Pro
  (**$25/mo** base) or accepting the pause/timeout risk.

**What would trigger the worker?**

The worker is Node/Bun code (Drizzle `getDb()`, the assistant's
`completedReply`, school-catalog assembly, Graph API send). Postgres cannot run
that loop, so `pg_cron` has exactly two shapes:

1. **`pg_cron` → `pg_net` → HTTP ping of the existing `/api/cron/whatsapp`
   route** (recommended if a Supabase trigger is ever used). The Next worker
   stays exactly as-is; the DB only replaces Vercel's scheduler. Claim and
   idempotency are **preserved** because the route still runs
   `claimDueWhatsAppJobs` (`FOR UPDATE SKIP LOCKED`) and `dedupe_key = wamid`.
   The `pg_cron` job should *not* re-implement claiming.
2. **A pure-SQL worker that selects and claims inside Postgres.** Rejected:
   it cannot run the agent/LLM step, so it would have to move the whole worker
   into the DB or an Edge Function — a rewrite that sacrifices the Drizzle
   app-schema worker and isn't what the product needs.

**Migration sketch (hosted; do NOT run against the shared local stack):**

```sql
-- Can be run in the Supabase SQL editor or `supabase db query`.
create extension if not exists pg_cron with schema "extensions";
create extension if not exists pg_net with schema "extensions";

-- Put the Vercel CRON_SECRET somewhere the pg_cron job can read it. Preferred:
-- Supabase Vault (vault.create_secret), read back by a small SECURITY DEFINER
-- helper in a non-exposed schema. Simplest alternative for a sketch:
alter database postgres set app.whatsapp_cron_secret = 'REPLACE_WITH_CRON_SECRET';

-- Ping the Next worker only when there is actually due work (avoid waking a
-- Hobby function every tick while idle).
select cron.schedule(
  'whatsapp-worker-ping',
  '* * * * *',                -- or '30 seconds' for sub-minute (PG >= 15.1.1.61)
  $$
  select net.http_get(
    url := 'https://<project>.vercel.app/api/cron/whatsapp',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || current_setting('app.whatsapp_cron_secret', true)
    ),
    -- The route runs the worker to completion; default 2000ms is too short.
    timeout_milliseconds := 120000
  )
  where exists (
    select 1 from app.whatsapp_jobs
    where state in ('pending','failed') and next_attempt_at <= now()
    union all
    select 1 from app.whatsapp_deliveries
    where state in ('pending','failed') and next_attempt_at <= now()
    limit 1
  );
  $$
);

-- Inspect runs:
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'whatsapp-worker-ping')
order by start_time desc limit 10;

-- Inspect outbound HTTP result (pg_net keeps responses ~6h):
select * from net._http_response order by created desc limit 10;
```

Ops notes for this shape:

- `net.http_get` is async: the `cron` command returns a `request_id`
  immediately; pg_net performs the request after commit. Gateway timeouts also
  apply to the request inside the Next function.
- If the hosted project enables **network restrictions**, pg_net's outbound
  call to `*.vercel.app` must be allowed.
- `cron.job_run_details` is **never auto-cleaned** — budget for that (small).
- There is no re-run of a missed tick beyond pg_cron's own scheduler; a paused
  Free project misses every tick until unpaused.

**Architecting soundness verdict:** it *is* architecturally sound as a
scheduler substitute (the claim/idempotency contracts transfer cleanly), but it
is still a **poll in disguise** — the reply cadence improvement is only "faster
cron", and every tick adds a DB→Vercel HTTP hop plus a new failure mode (the
pg_net request) that today's Vercel cron doesn't have.

---

## Q2 — Supabase Queues (`pgmq`) / Edge Functions / Realtime: is "always on" feasible?

No — not without adding a long-running process that doesn't exist in this stack.

- **Queues are pull-based.** The Queues quickstart is explicit: "a pull-based
  Queue … consumers actively fetch Messages when they're ready to process
  them." `pgmq` gives a durable table + `pop`/`read` with a visibility window
  and archived `a_*` tables, but *someone must call pop*. There is no push
  delivery to a dead-letter or to your app.
- **Edge Functions are request-triggered, not resident.** They cannot run a
  persistent queue consumer. You'd still schedule Edge Function invocations
  (with a cron, or `pg_cron`+`pg_net`) — i.e. the same poll.
- **Realtime (broadcast / Postgres Changes) needs a connected subscriber.** The
  Next app has no long-lived WebSocket consumer on the server side; the
  Supabase Realtime client in this repo is browser-side. You could build a
  small always-on subscriber, but that is a new deployment target — a rewrite,
  not a trigger swap.

So every Supabase-native shape is still "a periodic poll in disguise" for this
codebase. If queueing fidelity ever matters, `pgmq` is a *better* durable queue
than `whatsapp_jobs` polling is, but it does not change the wake-up problem.
pgmq 1.5.1 also shipped a `delay` behavior change (changelog 2025-10-08) with
upgrades paused briefly — notable but not a blocker here.

**Cost/latency tradeoff:** `pg_cron`(minute-or-sub-minute) → `pg_net` →
Next is the cheapest Supabase shape. Edge Functions add 500 k invocations/mo
free, but you'd be paying invocation budget to re-marshal work Next already
does. Realtime adds peak-connection and message-volume limits for no benefit
unless you already have a subscriber.

---

## Q3 — `next@16.3.3` `after()` / `waitUntil` — does it remove the cron?

**Verified in `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`:**

- `after` is **stable since v15.1.0** and is documented for Route Handlers in
  the installed 16.3.3 docs: "`after` allows you to schedule work to be
  executed after a response (or prerender) is finished."
- "It can be used in … Route Handlers."
- Duration: "`after` will run for the platform's default or configured max
  duration of your route," configurable via `maxDuration`.
- On serverless (Vercel), Next implements it through `waitUntil`, which
  "extends the lifetime of a serverless invocation until all promises … have
  settled" (see the `<details id="after-serverless">` block in the same file).
- In a Route Handler you may call `cookies()`/`headers()` inside the callback;
  we don't need either.

**Vercel duration limits (docs fetched 2026-09-11, "Duration limits" table,
fluid compute enabled by default):**

| Plan | Default | Maximum |
| --- | --- | --- |
| Hobby | 300 s (5 min) | 300 s |
| Pro | 300 s | 800 s (1800 s beta) |

So on Hobby the webhook's `after` callback has a 5-minute budget — far more
than the agent loop needs (a tool-loop `agent.generate()` is typically single-
digit-to-tens of seconds). The webhook still 200s fast (enqueue is awaited
before `after`); the worker runs after the response is flushed.

**Does it remove the cron entirely?** For *dispatch* of a fresh inbound
message, yes — the reply is crafted in the same invocation instead of waiting
for the next tick. It does **not** remove the need for a safety-net sweeper,
because `after`/`waitUntil` is best-effort and time-based retries still need a
periodic wake:

- a crashed/frozen invocation leaves `whatsapp_jobs`/`whatsapp_deliveries` in
  `claimed` (today nothing reclaims them — see the recovery sketch below);
- `failJob`/failed deliveries schedule `next_attempt_at` in the future
  (1–60 min backoff); nothing will wake at that timestamp without a timer;
- Meta status callbacks with no inbound message (e.g. a stale `sent`→`delivered`
  webhook) don't enqueue, so they don't create an `after` either.

Those paths are exactly what a **daily** (Hobby-safe) cron covers. So the shape
is: `after()` for the interactive fast path + daily cron for the slow path,
rather than "cron or nothing".

**Bun-runtime caveat (flag, don't block):** this project sets `bunVersion:
"1.4.x"`, so production functions run on Vercel's Bun runtime. The Vercel
`waitUntil` changelog (2024) names Node.js and Edge runtimes; the current Bun
runtime docs I fetched do not list `after`/`waitUntil` support explicitly. If
Bun does not honor `waitUntil`, the worst case is *not* data loss — the job row
is already committed (enqueue-then-ack), and the daily sweeper picks it up —
it only forfeits the instant dispatch. Verification step before rollout: deploy
a preview, send one inbound, and confirm the assistant reply lands within
seconds (not on the daily tick). If it doesn't, fall back to `pg_cron` (§Q1) or
Pro cron.

---

## Q4 — WhatsApp typing indicator: mechanism, TTL, sequencing

**Verified against Meta's current docs.** The page "Typing indicators"
(developers.facebook.com/documentation/business-messaging/whatsapp/typing-indicators,
"Updated: Jun 17, 2026") documents the typing indicator as an **extension of
the mark-as-read request** — not a standalone `type:"typing"` message:

```
POST https://graph.facebook.com/<API_VERSION>/<WHATSAPP_BUSINESS_PHONE_NUMBER_ID>/messages
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "status": "read",
  "message_id": "<wamid>",
  "typing_indicator": { "type": "text" }
}
```

Response: `{ "success": true }`.

Key facts from that page:

- Use the **inbound `wamid`** as `message_id`. Marking read + showing typing is
  one request (cheap, no `to` needed — the conversation is implied by the id).
- **TTL:** "The typing indicator will be dismissed once you respond, or after
  **25 seconds**, whichever comes first." So one indicator at webhook time fills
  a ~25 s gap; the real reply then dismisses it naturally.
- **Only display it if you are going to respond** (we always do for text
  inbound). It is part of the read receipt, not a billed message.

Sequencing that falls out of the design: **typing (synchronous, ~1 s) → ack 200
→ `after()` worker → reply text.** If the agent ever exceeds 25 s, re-issuing a
typing indicator is possible but keep v1 to one per inbound message
(spam-averse; no numeric rate limit documented, but Meta asks businesses not to
overuse it).

**One open question to confirm at rollout:** the typing shape above is from
current docs using `v26.0` examples; this repo defaults `WHATSAPP_API_VERSION`
to `v23.0` (`client.ts`/`config.ts`). Confirm `typing_indicator` is accepted on
the pinned Graph version before shipping (same `POST …/messages` path as text).

---

## Q5 — Comparison of options

"Dispatch delay" is the time from webhook-200 to the worker actually starting
work; generation time is additive and identical across options. Typing
indicator is orthogonal and can be layered onto any option.

| Option | p50 / p95 dispatch | Real reply latency | Cost | Ops burden | Failure modes | Idempotency | Moving parts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **0. Baseline: Hobby 1-min cron (PR #34)** | 30 s / ~57 s +gen | 35–75 s | $0 | none | **deploy fails on Hobby**; missed ticks; stuck `claimed` rows | preserved (dedupe_key + SKIP LOCKED) | 1 (Vercel) |
| **1. Vercel Pro + 1-min cron** | 30 s / ~57 s +gen | 35–75 s | $20/mo | upgrade plan, keep `CRON_SECRET` | missed ticks; stuck `claimed` | preserved | 1 |
| **2. Supabase `pg_cron` → pg_net → route (minute)** | 30 s / ~57 s +gen | 35–75 s | $0 on Vercel, **$25/mo Supabase Pro** for production pause-safety (Free: 1-wk pause) | enable 2 extensions + migration + Vault secret + monitor `cron.job_run_details`/`net._http_response` + egress allow-list | missed ticks; pg_net call can fail/timing-out; Free pause | preserved (the route claims) | 3 (Supabase, pg_net, Vercel) |
| **2b. Same, sub-minute (10–30 s)** | 10–15 s / ~28 s +gen | 15–40 s | same as 2 | same, plus idle-wake mitigation | same, more invocations | preserved | 3 |
| **3. `pgmq` + cron-pulled consumer** | = poll interval | same as 2/2b | same as 2 | queue mgmt + RLS/API exposure + consumer rewrite | visibility-window expiry vs claim crash overlap | equivalent (visibility timeout ≈ claim) | 4+ |
| **3b. Realtime "always on"** | near-0 only w/ resident subscriber | seconds | new deployment target | build/subscribe/monitor a WS process | subscriber crash = silent | preserved | 5+ |
| **4. Webhook `after()` + typing + daily sweeper (recommended)** | **~0 s** (same invocation) | **~1 s perceived (typing), actual = generation (≈5–20 s)** | **$0 (Hobby)** | no new infra; small route/worker edits; daily cron already Hobby-safe | crashed `after` → sweeper reclaims `claimed`; retries become daily | preserved | 1 (Vercel) + 1 daily cron |

Notes:

- Options 0/1/2/2b all keep the "silent until the full reply lands" feel unless
  the typing indicator is added; typing is the biggest single UX win and costs
  ~1 Graph call.
- Supabase's "always on" is *not actually always-on* on their serverless
  product: pg_cron is a scheduler and pgmq is a durable buffer; both still need
  an external waker. Only a resident consumer (3b) is truly push, and that's a
  new component this repo doesn't have.
- `after()` preserves every Phase 4 invariant: enqueue happens (awaited) before
  `after` fires; the worker still claims with `FOR UPDATE SKIP LOCKED`;
  `claimGenerating` still single-flights a conversation; `dedupe_key` still
  makes Meta's webhook retries idempotent.

---

## Recommended path — concrete sketches

### 1. Typing indicator (synchronous in the webhook)

Add to `src/lib/whatsapp/client.ts` (Phase 4 code — note `graphPost` already
exists there and returns `{ ok, providerId }`; a read receipt has no
`messages[].id`, so `providerId` is `null` and `ok:true` is correct):

```ts
// src/lib/whatsapp/client.ts (Phase 4 branch)
export function sendWhatsAppTypingIndicator({
  phoneNumberId,
  messageId, // the inbound wamid being acknowledged
}: {
  phoneNumberId: string;
  messageId: string;
}): Promise<WhatsAppSendOutcome> {
  return graphPost(phoneNumberId, {
    messaging_product: "whatsapp",
    status: "read", // marks read AND shows typing in one request
    message_id: messageId,
    typing_indicator: { type: "text" },
  });
}
```

### 2. Webhook: typing → enqueue → ack → `after()` worker

```ts
// src/app/api/webhooks/whatsapp/route.ts (Phase 4 branch, POST handler tail)
import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { sendWhatsAppTypingIndicator } from "@/lib/whatsapp/client";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";

// … existing signature verification / JSON.parse ...

const statuses = parseInboundWhatsAppStatuses(payload);
const messages = parseInboundWhatsAppMessages(payload);

// Perceived-immediacy lever: acknowledge + typing first (fast Graph call).
// Best-effort and bounded so Meta's 200 is never gated on it.
await Promise.allSettled(
  messages.map((m) =>
    sendWhatsAppTypingIndicator({
      phoneNumberId: m.phoneNumberId,
      messageId: m.wamid,
    }),
  ),
);

try {
  if (statuses.length > 0) await applyWhatsAppStatuses(statuses);
  if (messages.length > 0) await enqueueInboundJobs(messages); // dedupe_key = wamid
} catch (error) {
  console.error("whatsapp: webhook enqueue/status failed", error);
}

// Wake the worker in this same response lifecycle, AFTER the 200 is flushed.
// D12's enqueue-then-ack contract is unchanged: the handler still never runs
// the agent inline.
after(async () => {
  try {
    await runWhatsAppWorkerOnce(randomUUID());
  } catch (error) {
    console.error("whatsapp: after-worker failed", error);
  }
});

return Response.json({ ok: true });
```

### 3. Stuck-`claimed` recovery (make the daily sweeper meaningful)

Add to the worker tick (or `jobs.ts`/`deliveries.ts`) so a crashed `after`
invocation can't strand rows:

```ts
// run before drainWhatsAppJobs / drainDueWhatsAppDeliveries
await db.update(whatsappJobs).set({
  state: "pending", claimedAt: null, claimedBy: null, updatedAt: new Date(),
}).where(and(
  eq(whatsappJobs.state, "claimed"),
  lt(whatsappJobs.claimedAt, new Date(Date.now() - 5 * 60_000)),
));
// … same shape for whatsappDeliveries …
```

This is idempotent (only older-than-5-min `claimed` rows) and keeps the claim
semantics intact.

### 4. `vercel.ts`: replace the failing entry with a Hobby-safe sweeper

```ts
crons: [
  { path: "/api/cron/maintenance", schedule: "0 14 * * *" },
  // Hobby minimum interval is once per day; the fast path is now `after()`.
  { path: "/api/cron/whatsapp", schedule: "0 5 * * *" },
],
```

Daily cadence covers retry/backoff and reclaims stuck claims. The
`runWhatsAppWorkerOnce` worker itself needs **no** change for the `after` path
(it is already callable with a `runId`).

---

## Recommendation

Adopt **`after()` + typing indicator + daily sweeper** for the Phase 4
follow-up, and keep the Supabase `pg_cron` sketch as a documented fallback.

Reasoning:

- **Product outcome is strictly best.** Perceived reply latency drops from
  "0–60 s of silence" to "typing in ~1 s, reply as fast as the model finishes"
  — the exact "almost instantly crafting a reply" feel the spike targets — at
  $0 and with no new infrastructure.
- **Identical correctness semantics.** Every Phase 4 invariant (wamid dedupe,
  `FOR UPDATE SKIP LOCKED`, single-flight `claimGenerating`, inline send on
  completion) is reused untouched; `after()` only changes *who wakes the
  worker and when*.
- **Supabase is the wrong place to fix the cadence problem.** pg_cron is
  scheduler-shaped, not event-shaped; it substitutes one poll for another,
  adds a DB→Vercel hop, and effectively implies Supabase Pro for production
  pause-safety. pgmq/Realtime only pay off with a resident consumer this
  codebase doesn't have.
- **Risk is bounded and non-catastrophic.** The one real unknown is whether
  Vercel's Bun runtime honors `waitUntil`. If it doesn't, we lose only the
  instant dispatch (the job is already committed) and the documented fallback
  (pg_cron, or Pro cron) is a small, isolated change.

### When to revisit Supabase `pg_cron`

Reconsider if (a) failed-delivery retries must fire sub-daily and you'd rather
pay Supabase than Vercel, or (b) you later add a resident consumer for pgmq.
Until then it is an avoidable moving part.

---

## Open questions / risks

1. **Bun runtime + `after`/`waitUntil` on Vercel** — not explicitly confirmed
   in the current Vercel Bun docs. Verify with a preview deploy + one inbound
   (reply should land in seconds, not on the daily tick). Non-catastrophic
   fallback exists (§Q3).
2. **Graph version** — `WHATSAPP_API_VERSION` defaults to `v23.0`; current
   Meta docs show `v26.0`. Confirm `typing_indicator` on the pinned version
   (and check whether v23.0 is still live at rollout, per the existing errata).
3. **Retry cadence becomes daily** on the recommended path (any `after`-failed
   send whose backoff lands between sweeps waits up to ~24 h). Acceptable for a
   pilot; the moment it isn't, this is the trigger to re-evaluate `pg_cron`
   (§Q1) or Vercel Pro.
4. **Typing spam etiquette** — we send one indicator per inbound text message.
   If agent runs start exceeding ~25 s, decide whether to re-issue (Meta says
   to show it only when you'll respond; re-issuing is possible but unbounded
   reuse is discouraged).
5. **Local parity** — `after()` is a Next/Vercel affordance; local dev uses the
   `scripts/whatsapp-worker.ts --once` path. Keep the replay CLI as the local
   verification story (unchanged).
6. **`cron.job_run_details` growth** and free-tier pause risk would apply to
   the pg_cron fallback; note them in any future adoption.
7. **Meta webhook retry surface** — typing indicator is a new outbound call in
   the inbound path; wrap it in `Promise.allSettled` (sketched) and keep it
   out of the ACK critical path.
