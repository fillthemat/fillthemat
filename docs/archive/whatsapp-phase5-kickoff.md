> Archived. Not current instructions. See docs/README.md. Phase 5 is implemented; remaining WhatsApp work is Phase 6 in `docs/whatsapp-plan.md`. Cron decision: `docs/decisions/whatsapp-cron-after.md`.

# Phase 5 kickoff prompt — WhatsApp-sourced leads & bookings

Ready-to-paste prompt for a fresh Director session. Phases 1–4 are implemented and merged; this is
the final implementation phase before the human-only production rollout (Phase 6).

---

IMPLEMENTATION TASK — WhatsApp Cloud API channel, Phase 5 (fillthemat)

You are one implementation sub-agent. The plan is merged to main as `docs/whatsapp-plan.md`; the
architecture-spike decision (after() fast path + typing indicator + Hobby-safe daily cron) is
recorded in `docs/decisions/whatsapp-cron-after.md`. **Phases 1–4 are ALREADY IMPLEMENTED AND MERGED:**
- Phase 1: `whatsapp_deliveries` table, `contacts.email` nullable (+ unique `(school_id, phone)`),
  `schools.whatsapp_phone_number_id` / `whatsapp_waba_id`, `isLocalWhatsAppNoop()`.
- Phase 2: `/api/webhooks/whatsapp` (GET verify + POST `X-Hub-Signature-256`), wamid dedupe at the
  webhook layer, webhook-replay CLI + fixtures.
- Phase 3: `conversations.wa_id_hash`, inbound persistence as UIMessage parts, single-flight
  `generatingAt`.
- Phase 4: `whatsapp_jobs` enqueue-then-ack worker (`FOR UPDATE SKIP LOCKED`), agent driver
  (`runBookingAgentToCompletion`, D3), `whatsapp_deliveries` claim/send, status webhook, 24h window +
  explicit utility templates (no generic closed-window fallback), `src/lib/whatsapp/client.ts`
  (Graph transport + noop), PLUS the spike follow-up:
  `next after()` inline worker wake in the webhook, synchronous typing indicator, Hobby-safe daily cron
  (`0 5 * * *`), stuck-claim recovery, and a `sendWhatsAppTypingIndicator` client helper.

Verify all of the above are present in your tree before coding; if any is missing, STOP and report —
do not re-derive it.

== YOUR SCOPE ==
Implement EXACTLY Phase 5 of `docs/whatsapp-plan.md` plus the plan's "Addendum → Phase 5 additions" and
"Schema delta folded into Phase 1 (no-email bookings)". Stop after Phase 5. Phase 6 is a human-only
Meta rollout checklist — do not start it.

Concrete work, in order:

1. **Booking-intent capture + table** (Addendum "Phase 5 additions"). New `whatsapp_booking_intents`
   table (Drizzle `app` schema): `id` uuid pk; `school_id`; `conversation_id`;
   `offering_id`; `slot_id`; `participant_name`; `participant_age`; `state` enum
   `whatsapp_booking_intent_state` (`pending|confirmed|expired|superseded`); `expires_at`; timestamps;
   partial unique index on `conversation_id` `WHERE state = 'pending'` (one active intent per
   conversation). Extend the agent's `prepare_booking` tool `inputSchema`
   (`src/lib/ai/booking-agent.ts`) with optional `participantName` + `participantAge` and capture the
   `ok` output. IMPORTANT: the Phase 4 review round reverted `runBookingAgentToCompletion`
   (`src/lib/ai/run-agent.ts`) to return a plain string and reverted the `prepare_booking`
   participant fields — Phase 5 must reintroduce the capture seam (e.g. return
   `{ text, prepareBooking }` again, or otherwise surface the last successful `prepare_booking` tool
   output) so the **platform** can persist/refresh the pending intent. The agent still NEVER writes
   the booking.

2. **Lead path** (Phase 5 "Leads"). Synthesize a pseudo landing session with `utm_source='whatsapp'`
   (decision J) so `leads.landing_session_id NOT NULL` stays intact; upsert the contact keyed
   `(school_id, phone)` when there is no email (decision B); write a `lead_captured` funnel event with
   `{channel:'whatsapp'}`. Owner-lead delivery stays email. Prefer a shared
   `src/lib/leads/create-lead.ts` used by both web and WhatsApp rather than duplicating the form route.

3. **Booking path** (Phase 5 "Bookings"). After `prepare_booking` + explicit in-chat confirmation, the
   platform calls `bookSlot` (`src/lib/schedule/book-slot.ts`) with a **PLATFORM-MINTED idempotency
   UUID** (decision F). The Meta `wamid` stays the dedupe key at the webhook layer only — do NOT relax
   the `z.string().uuid()` constraint in `validation.ts`; mint a real UUID per confirmation. Keep
   `bookSlot`'s web semantics sacred: same transaction, occupancy guard, idempotency replay, and email
   behavior; the web Turnstile path is untouched.

4. **Deterministic confirmation** (Addendum). Send the confirmation prompt as an interactive button
   message (`type:"interactive"`, reply button id `confirm_booking:<intentId>` plus a "choose another
   time" button). The webhook must recognize interactive/button replies and text replies: an exact
   affirmative (`yes|confirm|yep|ok|sure`) while a pending intent exists routes straight to `bookSlot`;
   anything else routes to the agent. Verify the interactive-message shape against the WhatsApp
   OpenAPI spec at implementation time — do not trust memory.

5. **No-email confirmation** (decision B/D8 + "Schema delta"). Make `bookings.contact_email_snapshot`
   nullable (verify current state first — the Phase 4 branch restored `NOT NULL`; re-drop it), and have
   `bookSlot` accept an optional email passed through as `null`. When the booking contact has no email,
   send the prospect confirmation as a WhatsApp template; owner notifications stay email.

6. **Abuse controls**. Per-wa_id daily caps mirroring `src/lib/security/limits.ts` (the email/recipient
   quota pattern), keyed on `wa_id` (or `(school_id, wa_id_hash)`), DISTINCT from any
   `MAX_OUTBOUND_RECIPIENTS_PER_DAY` budget. Triggering the cap returns the 429-equivalent.

7. **`cancelBooking` stays email/dashboard-only** (decision K) — no WhatsApp cancellation in v1.

== GROUNDING RULES ==
- Read `AGENTS.md` + `docs/local-development.md` first. Next 16.3.3 breaking changes: consult
  `node_modules/next/dist/docs/` before Next APIs. `ai@7.0.84`: consult `node_modules/ai/docs/` before
  agent/tool code.
- `bun run skills:install`, then load `supabase`, `supabase-postgres-best-practices`, and `ai-sdk`
  skills as applicable. Drizzle owns all schema. Do NOT modify `skills-lock.json`.
- `bookSlot`'s web semantics are sacred — your WhatsApp path calls the same transactional core; do not
  change its idempotency, occupancy, or email behavior for existing web flows.
- The trigger model is already shipped (after() wake + daily cron sweeper + typing indicator,
  `docs/decisions/whatsapp-cron-after.md`). Do NOT reintroduce a sub-daily Vercel cron (Hobby rejects it) and do
  not re-architect the trigger without a product decision.

== WORKTREE CONTRACT ==
Own your 30X0 origin via `bun run setup`, plain `bun run dev`, `bun run dev:stop` to stop, never
`pkill`, never `supabase stop`, report port collisions, never hand-edit port claims. The Bun-runtime
`after()`/`waitUntil` verification is a deploy-time check, not required locally.

== DELIVERABLES ==
Implement Phase 5 and run the plan's exact local test steps, all with ZERO `WHATSAPP_*` env values:
- replay a full conversation to a confirmed booking → `bookings` row + occupancy +1 + no double-write
  on a duplicate wamid replay;
- per-wa_id cap → 429-equivalent;
- lead row with a synthesized `utm_source='whatsapp'` session + contact upsert when no email;
- WhatsApp-template prospect confirmation enqueued when the contact has no email.
Commit per logical change. Final `result.md`: per-item summary, files + `file:line` for load-bearing
spots, test commands/evidence, deviations, open issues. End with `bun run dev:stop`.
