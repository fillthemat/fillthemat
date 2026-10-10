# Known gaps

Living list of what is still unfinished. Shipped work is deliberately not repeated here; check the tree and `docs/README.md` for what is current. The archived snapshot (`docs/archive/v1-plan-remaining-2026-08.md`) contains the older, longer version, including items that have since shipped.

## Pilot launch gate (hosted)

Isolated hosted Supabase (preview vs production), verified Resend sending domain, Vercel WAF + production Turnstile, Gateway ZDR + spend-ceiling verification, backup/PITR restore drill, and the founder-alpha smoke checklist are still open. See the "Explicitly skip on this deploy" list in `docs/v1-deploy-current.md`.

## Booking quotas and abuse

Per-school and per-IP booking quotas are not stored or enforced. Email/recipient daily caps exist (`src/lib/security/limits.ts`); per-school/IP reservation quotas do not.

## Chat refresh recovery

GET `/api/chat` exists and can return canonical history, but the prospect client fetches and discards the payload — `useChat` starts empty on reload and the transcript is not hydrated into the UI.

## Privacy-safe chat telemetry

No telemetry table exists in the `app` schema. Model, time-to-first-token, usage, step count, finish/abort, and tool name/result code are not persisted for privacy-safe analytics.

## Integration test coverage

Integration tests exist and run in CI (`bun run test:integration`, `vitest.integration.config.ts`) for: settings offer/FAQ mutations, overview metrics, and the WhatsApp webhook/worker flow. Still missing: the booking write path (concurrent identical bookings, idempotency replay, capacity floor, transaction rollback), the email delivery state machine, and maintenance-cron overlapping-claim behavior.

## Settings Release B

Safe class-time management (reopen / guided replacement for windows with future bookings) is still open. Spec and acceptance live in `docs/settings-overview-ux-plan.md`; current-state notes in `docs/settings-ux-first-pass.md`.

## WhatsApp

Phases 1–5 (schema through WhatsApp-sourced leads and bookings) are implemented. Remaining work is Phase 6: human Meta production rollout (app, WABA, tokens, templates, webhook HTTPS, App Review, pilot school). Checklist: `docs/whatsapp-plan.md` § Phase 6. Cron decision: `docs/decisions/whatsapp-cron-after.md`.

- **Pre-pilot gate: [#78](https://github.com/fillthemat/fillthemat/issues/78)** — use verified customer
  message timestamps for the 24-hour customer-service window, not worker processing time. Bounded
  retries (#79) do not fix this. The exhaustion apology uses the latest original inbound receipt time
  for its school number/recipient; that is not yet the verified Meta message time either.
- **Accepted pilot gap: no operator alerting for configuration/credential failures** (including missing
  token/permissions or unknown school-phone mapping). Terminal transitions log once and WhatsApp cron
  returns counters, but nobody is assigned to watch logs/terminal rows. The per-booking undelivered
  WhatsApp confirmation owner email is not an infrastructure alert; email failures trigger no notification.
  Maintenance `cron_runs` / dashboard health do not monitor the WhatsApp worker.
- **Deferred for revisit: minute-scale timed retries outside an active run** — Vercel Pro cron or
  Supabase `pg_cron`. Active WhatsApp runs already retry at roughly 10/20/40/80 seconds within a
  four-minute budget, with the daily 05:00 UTC sweeper continuing the same five-execution cap. No
  independent minute-scale wake exists on Hobby; status-only callbacks do not wake the worker.
  Revisit if pilot idle recovery is too slow; do not assume `next_attempt_at` is a timer.

## Not gaps (already shipped)

shadcn/Radix UI, cancel-booking AlertDialog, Playwright beyond a smoke test (bookings, settings, overview specs + CI), CI (unit, integration, Playwright), local email auth, and WhatsApp Phases 1–5 are done. Do not re-list them as remaining.
