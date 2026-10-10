# Docs index

Short guide to what is current versus historical. Treat only the files below as active.

## Living (current)

- `local-development.md` — scripted local stack how-to (`bun run setup`, seed credentials, worktree ports).
- `known-gaps.md` — still-true remaining work.
- `conversation-debugger-plan.md` — implementation handoff for opt-in preview conversation timelines, Langfuse tracing, and regression-case capture (planned).
- `v1-deploy-current.md` — founder-alpha hosted deploy.
- `prod-account-cutover.md` — move production vendors off personal email onto `admin@fillthemat.com` + company bank.
- `product-brief.md` — product intent.
- `dashboard-design-system.md` — implemented owner-UI visual language.
- `settings-ux-first-pass.md` — current Settings state after Release A.
- `settings-overview-ux-plan.md` — spec for Settings Release B (still open).
- `whatsapp-plan.md` — WhatsApp channel spec. Phases 1–5 implemented; Phase 6 (Meta production rollout) remains. §4 is the binding decisions record.
- `whatsapp-phase6-kickoff.md` — human rollout runbook, shipped retry behavior and pilot gates.

## Decisions

- `decisions/whatsapp-cron-after.md` — accepted: `after()` + typing indicator + Hobby-safe daily cron. Do not reopen unless production needs sub-daily retries.
- `decisions/whatsapp-retry-limits-research.md` — implemented (#79, tickets #80–#89): five-execution cap,
  fresh/retry lanes, bounded in-run WhatsApp retries and failure notifications. Historical spike findings
  are labelled; current behavior is in `whatsapp-plan.md` §1.6. #78 remains a pre-pilot gate.
- `decisions/lint-policy.md` — accepted: `@shadcn/lint` policy on the Oxlint host — six rules, `no-restyle` error + layout/TableCell contract, `page-*` tokenization; promote the warn rules to `error` when adoption settles.

## Archive

Historical plans and prompts. Not current instructions.

- `archive/v1-architecture.md` — original V1 plan.
- `archive/v1-plan-remaining-2026-08.md` — older remaining-work snapshot (superseded by `known-gaps.md`).
- `archive/local-dev-onboarding-plan.md` — onboarding diagnosis and phase log.
- `archive/dashboard-makeover-plan.md`
- `archive/settings-ux-research.md` (+ screenshots in `references/settings/`).
- `archive/e2e-testing-plan.md`
- `archive/whatsapp-director-kickoff.md`
- `archive/whatsapp-phase5-kickoff.md`
