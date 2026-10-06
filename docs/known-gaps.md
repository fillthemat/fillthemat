# Known gaps

Living list of what is still unfinished. Shipped work is deliberately not repeated here; check the tree and `docs/README.md` for what is current. The archived snapshot (`docs/archive/v1-plan-remaining-2026-08.md`) contains the older, longer version, including items that have since shipped.

## Pilot launch gate (hosted)

Isolated hosted Supabase (preview vs production), verified Resend sending domain, Vercel WAF + production Turnstile, Gateway ZDR + spend-ceiling verification, backup/PITR restore drill, and the founder-alpha smoke checklist are still open. See the "Explicitly skip on this deploy" list in `docs/v1-deploy-current.md`.

## Booking quotas and abuse

Per-school and per-IP booking quotas are not stored or enforced. Email/recipient daily caps exist (`src/lib/security/limits.ts`); per-school/IP reservation quotas do not.

## Chat refresh recovery

GET `/api/chat` returns canonical history and the prospect client hydrates it on refresh. Edge cases around concurrent refresh during an unfinished generation and booking preparation derived from historical tool output still need focused end-to-end tests.

## Privacy-safe chat telemetry

No telemetry table exists in the `app` schema. The optional, authenticated synthetic preview conversation debugger exports opted-in tests to Langfuse, **not** general production analytics or historical traces. Privacy-safe aggregate model/latency/usage metrics for real traffic are still not persisted. Langfuse retention/deletion and a real hosted smoke must be verified by an operator before enabling capture; hard kills and some stale-lock cases can leave unknown outcomes. See `docs/conversation-debugger-runbook.md`.

## Integration test coverage

Integration tests exist and run in CI (`bun run test:integration`, `vitest.integration.config.ts`) for: settings offer/FAQ mutations, overview metrics, and the WhatsApp webhook/worker flow. Still missing: the booking write path (concurrent identical bookings, idempotency replay, capacity floor, transaction rollback), the email delivery state machine, and maintenance-cron overlapping-claim behavior.

## Settings Release B

Safe class-time management (reopen / guided replacement for windows with future bookings) is still open. Spec and acceptance live in `docs/settings-overview-ux-plan.md`; current-state notes in `docs/settings-ux-first-pass.md`.

## WhatsApp

Phases 1–5 (schema through WhatsApp-sourced leads and bookings) are implemented. Remaining work is Phase 6: human Meta production rollout (app, WABA, tokens, templates, webhook HTTPS, App Review, pilot school). Checklist: `docs/whatsapp-plan.md` § Phase 6. Cron decision: `docs/decisions/whatsapp-cron-after.md`.

## Not gaps (already shipped)

shadcn/Radix UI, cancel-booking AlertDialog, Playwright beyond a smoke test (bookings, settings, overview specs + CI), CI (unit, integration, Playwright), local email auth, and WhatsApp Phases 1–5 are done. Do not re-list them as remaining.
