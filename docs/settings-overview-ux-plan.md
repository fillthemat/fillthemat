# Settings editing + overview UX — director handoff

## Mission and status

Make the owner dashboard feel like a tool the school can maintain, not a one-time setup wizard. Owners should be able to correct a trial class or FAQ without recreating it, safely manage class times, and understand the overview at a glance.

**Status: Release A shipped** in [#21](https://github.com/jakegoodmandev/fillthemat/pull/21) (2026-09-10). Current-state notes: `docs/settings-ux-first-pass.md`. Design system: `docs/dashboard-design-system.md`.

**Remaining: Release B** — safe class-time management. This file is now the spec for B. Do not reimplement trial-class/FAQ editing or the overview metric rewrite. Reuse the inline editor (`src/app/dashboard/settings/ui/editor-lifecycle.tsx`), shared field components, and the mutation/form-state contracts already on `main`.

**Priority order:**

1. ~~Edit existing trial classes and FAQs without losing identity or history.~~ **Done** (#21).
2. ~~Give overview metrics a stronger visual hierarchy and trustworthy labels.~~ **Done** (#21).
3. Make class-time management reversible and safe for existing bookings. **Next.**
4. Polish secondary conveniences only after B is verified.

This is a follow-up to `docs/archive/dashboard-makeover-plan.md`, not a repeat of its foundation work. Keep the implemented shadcn/Radix, softened-dark, Geist design system. Do not reinstall the kit or redesign the shell.

## 1. Current-state findings

Post-#21. Line numbers below are approximate; read the files.

| Evidence                                                   | Current experience                                                                                                                               | UX consequence                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Offerings / FAQs / overview / bookings filter              | **Shipped in Release A.** Inline Edit on existing IDs; grouped overview; `/dashboard/bookings?filter=upcoming&status=booked`.                    | Do not reopen A.                                                                                              |
| `src/app/dashboard/settings/sections/schedule-section.tsx` | Every row has a permanently expanded capacity form; other fields are not editable. Turned-off times cannot reopen.                               | Visual clutter for one editable field, but no natural way to change the actual schedule or reverse a mistake. |
| `src/app/dashboard/settings/actions.ts` / `mutations.ts`   | Offering/FAQ updates exist. Class times still have capacity update and deactivation only — no reopen, no structural edit, no guided replacement. | Release B needs server-side capabilities, not just new Edit buttons.                                          |

**Known A limitations (do not “fix” as part of B unless they block B):** Browser Back/Forward is not intercepted (App Router has no `router.beforePopState`; documented in `docs/settings-ux-first-pass.md`). Saving editors stay mounted until the action settles. Prefer no migration.

Useful foundations to preserve: seven URL-backed settings categories, section-specific server reads, Zod validation, shared form state and save feedback, the inline editor lifecycle, confirmation dialogs, booking snapshots, and owner-scoped mutations.

## 2. Scope and product decisions

### Required release A — editing essentials and overview (shipped, #21)

- In-place editing of existing trial classes and FAQs.
- One consistent Add / Edit / Save / Cancel interaction pattern.
- Compact settings rows with visible text actions.
- Overview metric presentation, definitions, no-data states, and honest navigation.
- Automated coverage of mutations, data preservation, metric calculations, and browser interactions.

### Required release B — safe class-time management

- Edit capacity and internal label through the same editor pattern.
- Reopen a turned-off class time without creating a duplicate.
- Edit structural fields directly when the time has no occurrences or bookings.
- For a time with history, offer a guided replacement instead of silently moving bookings or telling the owner to start over manually.

Release B is separately gated because class times participate in availability, occurrence capacity, booking confirmation, and historical records. Do not hold release A hostage to that work; do not mark the complete plan done if B is deferred.

### Optional follow-up, not a release blocker

- Duplicate trial class as a prefilled, unsaved form; never copy bookings or silently clone class times.
- FAQ Move up / Move down using existing `sortOrder`, with keyboard-accessible controls, stable ordering, and atomic updates. No drag-only interaction.
- Date-range analytics and real comparisons, after a separate metric-cohort specification.

### Explicit non-goals

New themes, a new component library, charts for decoration, AI configuration features, autosave, draft/publish settings, permanent trial-class deletion, bulk editing, automatic booking rescheduling/cancellation, new email workflows, auth changes, deployment, or production data changes.

Published slug and timezone remain intentionally locked. Do not interpret “make settings editable” as permission to remove integrity safeguards.

## 3. Settings interaction contract

### One editor pattern

Use an **inline expanded editor under the selected row**, not a long modal or a new route. It keeps the class/question in context and fits the existing form architecture. Shared fields must be reused by Create and Edit; do not maintain two independently validated field sets.

- Each existing row has a visible **Edit** button. Keep Stop Offering / Offer Again and Delete Question secondary and distinct.
- Allow one open create/edit panel per category. Attempting to switch records or open Add while dirty offers **Keep Editing** / **Discard Changes**. A clean panel can switch immediately.
- Opening Edit loads every supported saved field, including values omitted or truncated in the read-only summary. Do not prefill from summary text.
- Editor has a contextual heading, **Save Changes**, and **Cancel**. Cancel closes without writing; if dirty, confirm discard. Do not confuse “reset fields” with “close editor.”
- Save disables duplicate submission, reports pending, preserves input on validation/server failure, and focuses the first invalid control.
- After confirmed success, update the row from normalized server values. Close and restore focus to Edit only if no newer edits were typed while saving; otherwise retain those edits and show Unsaved changes.
- On Create success, reveal/focus the new row and announce the result. Do not wipe characters typed after submission. The existing `clearOnSuccess` branch resets the whole form and needs explicit regression coverage.
- Keep the success announcement mounted outside an editor that closes. No toast-only error handling and no optimistic “Saved” before the server confirms.
- Disable conflicting same-record actions while a save is pending; switching records must not let one response overwrite another editor.
- Retain dirty tracking for category navigation and document unload. Extend protection to editor switching and app-owned dashboard links that leave settings. Browser Back/Forward needs an explicit tested strategy; do not assume `beforeunload` catches client-side history navigation. Any framework limitation must be reported, not silently described as protected.
- Keep existing category IDs and `sectionHref()` URLs. No new routing library is needed for transient editor state.

### Trial classes

Edit: class name, youngest/oldest age, description, what to wear, and what to expect. Use the existing `offeringSchema` constraints and normalization.

**Data contract:**

- Update the existing offering ID; never implement Edit as delete + insert.
- Preserve `active`, associated class-time IDs, and fields not exposed by this form, especially `waiverNotes`. Reusing create parsing must not erase hidden data with empty defaults.
- Existing booking name/instructions/age/time/location snapshots stay unchanged. New bookings and future settings/availability reads use saved settings; a settings save must not rewrite chat transcripts or claim retroactive updates to them.
- Changing age eligibility affects new booking eligibility, not existing reservations. Put that one-sentence consequence beside age fields; explain snapshot behavior once in the editor.
- Keep Stop Offering / Offer Again reversible. Prefer an explicit desired state over “invert whatever state the server finds,” so repeated/stale submissions cannot accidentally undo the user's intent.
- Distinguish **Offered** from **Bookable**: an offered class with zero active times needs an **Add Class Time** link to Schedule, not a false availability claim. Do not imply an active time guarantees an open slot within the booking horizon.

**Acceptance:** an owner can correct a class name and age range, save, reload, and edit again; the ID and schedule associations remain the same, old bookings retain their snapshots, and a subsequent booking uses the new settings.

### FAQs

- Edit question and answer in place; leave delete as a confirmed secondary action.
- Keep FAQ ID and sort position. Updating an existing FAQ must work at the 20-question limit; the limit applies to creating new records, not correcting them.
- Preserve starter questions for Create only. Remove the delete-and-recreate workaround once Edit is shipped.
- Show answer disclosure separately from Edit; buttons must not be nested inside an interactive summary/link.

**Acceptance:** editing an answer at the limit neither deletes a row nor changes the list count/order; invalid answers remain in the editor; cancelling leaves persisted data unchanged.

### Class times

Replace the always-visible capacity form with a compact summary: day/time, trial class, spots, optional internal label, status, and visible **Edit** plus **Turn Off / Reopen**. Keep timezone context at section level and in structural-change review.

| Situation                             | Allowed behavior                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capacity or internal label changes    | Edit on the existing ID. Enforce the capacity floor against future occupancy on the server, including concurrent bookings. Apply capacity consistently to relevant future occurrences; preserve historical occurrences. |
| Turned-off time, parent class offered | Reopen the same ID after explaining that new bookings can resume and existing occupancy still consumes spots.                                                                                                           |
| Parent class not offered              | Explain the dependency and link to Trial Classes. Do not label the time publicly bookable or silently activate its parent.                                                                                              |
| No occurrences/bookings               | Allow changing trial class, weekday, start time, and duration in place, subject to normal validation and availability rules.                                                                                            |
| Any occurrence or booking history     | Keep structural fields protected, with a visible **Change Future Schedule** action that opens a prefilled replacement flow. Do not merely replace a disabled button with another dead-end explanation.                  |
| Delete                                | Retain current restriction against deleting times with occurrences, enforce on the server, and confirm deletion for eligible unused times.                                                                              |

**Guided replacement:** review old and new schedules, explain “Existing bookings keep their original time. New bookings use the replacement schedule,” then atomically create the replacement and turn off the old time. Do not migrate, cancel, or notify existing reservations. In this release the change takes effect immediately; future effective dates and bulk rescheduling are separate features. Show old-time booking counts and link to Bookings without pretending that route already supports a window-specific filter.

Do not modify a recurring time with history in place: slot IDs, occurrence start/end values, and booking snapshots would otherwise disagree. A retry must not create multiple replacement windows. Recheck eligibility/occupancy at commit time; a browser-supplied count or preflight check is not enough.

**Release B gate:** backend owner documents and tests the transaction/locking strategy shared with booking confirmation, cancellation, and occurrence creation. At minimum cover capacity reduction racing a booking, replacement racing a booking, stale slot submission, reopening a full occurrence, daylight-saving boundaries, and duplicate confirmation/retry. Escalate any required schema change to director before implementation.

## 4. Overview design and metric contract

### Recommended composition

Keep the quiet dark palette, but replace disconnected text columns with **one grouped summary surface**: restrained border/background, consistent padding, equal cell anatomy, desktop dividers, stacked mobile cells. Avoid three oversized decorative cards.

```text
Overview

Public page  [Published]                  View Page   Preview
(or a compact setup checklist with links to the relevant settings)

┌──────────────────────┬──────────────────────┬────────────────────────┐
│ Upcoming bookings    │ Leads                │ Booking conversion     │
│ 8                    │ 24                   │ 12.5%                  │
│ Scheduled from now    │ All time             │ 10 of 80 eligible      │
│ View bookings →      │ View leads →         │ sessions · All time    │
└──────────────────────┴──────────────────────┴────────────────────────┘

Booking activity and definitions ▸
System status ▸                 [visible warning if email failures exist]
```

Numbers above are illustrative only, never fallback production values.

- Metric values start at 28–32px, semibold with tabular numerals; primary labels 14px, context 12–14px. Check large counts, `100%`, and missing data without shifting baselines.
- Each cell has label → value → scope/evidence → optional action in the same positions. Keep context readable and do not reserve large empty areas to force symmetry.
- No gradient fills, arbitrary colored metric icons, sparklines without data, or green arrows suggesting unmeasured growth.
- Use real text links for drill-downs, not a clickable container with nested controls. Provide visible focus and hover feedback.
- Publication status remains compact. Unpublished owners get actionable readiness items built from actual server requirements; awaiting approval has no fake self-service action.
- Rename “More details” to a meaningful booking-activity disclosure. Keep setup inventory separate from conversion evidence inside it. System status stays lower priority; nonzero email failures remain visible without opening it. Do not invent maintenance-health thresholds from the global cron timestamp.

### Required definitions for release A

**Do not add a global date selector in this release.** Upcoming inventory and lifetime acquisition are different scopes; label each explicitly rather than pretending they share a period.

| Display                      | Definition / behavior                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upcoming bookings            | This school's bookings with `status = booked` and `startAt >= now`. Label “Scheduled from now”; no invented “this week.”                                                                                                                           |
| Leads                        | Count of this school's lead records, all time. Not unique visitors, people, or “new this month.” Link to `/dashboard/leads`.                                                                                                                       |
| Booking conversion           | Distinct eligible public-page sessions with at least one confirmed booking, divided by eligible public-page sessions, all time. Count each session once. A later cancellation does not undo the fact a booking was made; disclose this definition. |
| Eligible sessions            | Existing `qualifiedAt IS NOT NULL` records. Explain that tracking excludes preview and known-bot sessions when created on an approved, published page; do not claim all bots are eliminated or call these booking-ready prospects.                 |
| Converted sessions           | Explicit intersection of booking-linked session IDs and eligible sessions belonging to the same school. Do not divide an unrelated session population by the eligible-session denominator.                                                         |
| Chat-assisted bookings       | Current recorded booking-confirmation events with `source = chat`; label as recorded events in definitions unless the implementation verifies/deduplicates booking identity. Not synonymous with converted sessions.                               |
| Active trial classes / times | Configuration counts, not traffic/performance metrics or guaranteed available slots. Link to the corresponding settings category.                                                                                                                  |

The conversion intersection is an intentional query-semantic correction. Director approves the definition and fixture expectations before it ships; do not silently change public session tracking or backfill historical events. Show `—` with “No eligible sessions yet” when denominator is zero; show `0%` only when there are eligible sessions and none converted. Never clamp a broken calculation to 100% to hide mismatched cohorts.

**Navigation reconciliation:** make the upcoming metric link represent its count. Recommended: add a validated optional `status=booked` query parameter on Bookings, use `/dashboard/bookings?filter=upcoming&status=booked`, and show a clear removable “Booked only” filter. Preserve existing Upcoming / Past / All defaults. Test the filtered destination against the metric; do not change every Upcoming view's meaning as a side effect of adding a link.

### State and performance requirements

- New/unpublished school: honest zero counts, undefined conversion, useful setup links; no demonstration stats.
- Published/no activity: short empty context, public-page link, no alarming failure treatment for zero leads.
- Populated: values, denominators, and drill-down counts reconcile against fixtures.
- Query failure: display an unavailable/error state or route error boundary, never silently substitute zeros. If adding streamed loading, use dimensionally stable placeholders rather than flashing `0`.
- Keep aggregation server-side and school-scoped, use a consistent `now`, run independent reads concurrently, and send only required summaries to interactive components. Do not hydrate the entire overview or ship raw sessions/bookings just to calculate totals.
- No new analytics/chart dependency. Any index/migration proposal needs query evidence and a director decision.

**Later date ranges:** specify school-local boundaries, cohort timestamp, conversion attribution window, late conversions, cancellation treatment, matching drill-downs, and previous-period comparison before adding 7/30/90-day controls. Never compare bookings created this period against unrelated visitors seen this period and call it conversion.

## 5. Server and form safety contract

Applies to every new or changed mutation:

- Call `requireOwnedSchool()` and validate input server-side. Scope both reads and writes to the owned school; never trust a hidden `schoolId` or the fact the UI loaded an item.
- Return the existing `SettingsFormState` shape with normalized saved values. Check affected rows; missing/deleted/foreign IDs must not report success or disclose another school's data.
- Preserve Next.js control-flow rethrow behavior in the existing `run()` wrapper.
- Protect against stale edits. Recommended: use the existing `updatedAt` as an optimistic concurrency token where suitable; on conflict retain typed values and offer an explicit reload path, never silently overwrite another tab's changes. Verify timestamp precision/serialization and apply the predicate atomically.
- Keep unedited/hidden fields intact. Forms update their supported fields, not entire deserialized database records.
- Revalidate affected settings, overview, and public-school views according to their actual caching behavior. Test revisits/back navigation; do not claim immediate availability changes on the basis of a settings-only success message.
- Availability-sensitive operations require a transaction and consistent coordination with booking writers, not just a client-side minimum or a select-then-update race.
- Prefer no migration for editing, reopening, and metric aggregation. If safe replacement/idempotency needs one, director approves it and the backend owner uses the project's Drizzle-owned migration workflow. Do not apply standalone hosted SQL or switch schema tools.

## 6. Director execution workflow

### Phase 0 — baseline and decisions (`UX-00`)

Director + QA:

1. Read this plan, `AGENTS.md`, `skills-lock.json`, `docs/dashboard-design-system.md`, `docs/settings-ux-first-pass.md`, and `docs/local-development.md`.
2. Restore missing locked skills and load the applicable React, web-design, Playwright, Supabase, and Postgres guidance. Before code changes, read relevant installed Next.js guides, especially `node_modules/next/dist/docs/01-app/02-guides/forms.md` and current mutation/revalidation guidance.
3. Capture desktop/mobile baselines of overview and all seven settings categories with synthetic data. Record baseline check failures.
4. Approve the inline-editor mockup, metric cell composition, conversion definition, status-filter URL, and release-B replacement semantics. Record decisions in this plan or a linked implementation log.
5. Assign exclusive file and fixture ownership. Freeze server-action signatures/editor DTOs before parallel UI work.

**Gate:** screenshots/mockups show an actual existing-item editor and realistic metric states, not only a blank form or idealized dashboard.

### Work packages and ownership

| ID      | Owner                      | Deliverable / primary paths                                                                                                                                                                                       | Depends on                                                 |
| ------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `UX-01` | A — interaction foundation | Editor lifecycle, focus, feedback and dirty protection; `settings/ui/*`, `settings/settings-shell.tsx`, necessary shared primitive/nav adjustments                                                                | `UX-00`                                                    |
| `UX-02` | B — settings backend       | Offering/FAQ update actions, desired-state activation, version checks, normalized responses; `settings/actions.ts`, `schemas.ts`, `queries.ts`, `form-state.ts`, backend tests                                    | `UX-00`, agreed contract with A                            |
| `UX-03` | C — settings UI            | Reusable create/edit field groups, trial-class and FAQ rows; `settings/sections/*`, `settings/page.tsx` DTO mapping                                                                                               | integrated `UX-01` + `UX-02`                               |
| `UX-04` | D — overview               | Server metric module/tests, metric surface, states/definitions, matching Bookings filter; `dashboard/page.tsx`, new `dashboard/overview/*`, `dashboard/bookings/page.tsx`                                         | `UX-00`                                                    |
| `UX-05` | E — QA                     | Browser tests and test fixtures; `e2e/*`, coordinated test-only fixture helpers                                                                                                                                   | scenario design after `UX-00`; execution after integration |
| `UX-06` | B then C                   | Release-B class-time mutations/transactions and UI, using the accepted editor; `settings/actions.ts`, `schemas.ts`, `queries.ts`, `sections/schedule-section.tsx`, coordinated `src/lib/schedule/*` changes/tests | release-A gate, backend safety review                      |
| `UX-07` | Director + all owners      | Integrated visual review, fixes, updated current-state docs, evidence and remaining backlog                                                                                                                       | `UX-05` + `UX-06`                                          |

Paths prefixed `settings/` are under `src/app/dashboard/settings/`; `dashboard/` under `src/app/dashboard/`. B owns **all** edits to shared settings actions/schemas/queries; do not split FAQ and schedule agents across that same file. C owns section components but requests shared form changes from A. A owns shared CSS/components/navigation; D keeps overview-specific components under its own directory. E owns test fixtures, while B/D own their feature unit/integration tests. Director owns package/config/migration approvals and documentation updates.

Suggested sequence: run A, B, D, and E's test planning in parallel; integrate A/B before C; integrate C/D and run release-A QA; then execute B/C's release-B work. Use fewer agents serially if preferred—ownership boundaries matter more than agent count.

### Local environment and integration

- Create worktrees at `.worktrees/<name>` using `git worktree add`; run `bun run setup` in each and use its printed origin. Never pass `--port` or hand-edit `NEXT_PUBLIC_SITE_URL`. Stop and report port collisions.
- Worktrees share one Supabase stack. QA owns synthetic test tenants/data; serialize mutation-heavy suites or allocate separate tenants. Different frontend ports do not isolate fixtures. Coordinate setup/migrations before suites run.
- Do not stop/recreate Supabase from a child worktree or use production data/secrets for screenshots.
- Stop each frontend with `bun run dev:stop`; remove its worktree from the repo root with `git worktree remove`. Do not delete port-claim files manually.
- Every agent hands back changed paths, decisions, test commands/results, screenshots where relevant, and unresolved risks. Review the combined branch, not just isolated worktree screenshots. No deployment.

## 7. Acceptance and verification

### Release A checklist

Shipped in #21. Back/Forward dirty protection is a documented App Router limitation, not a silent claim of coverage.

- [x] Trial classes and FAQs can be edited, saved, reloaded, and edited again without recreation.
- [x] Offering IDs, schedule relationships, hidden fields, and existing booking snapshots are unchanged by content edits.
- [x] FAQ edits work at the create limit and preserve order/count.
- [x] Pending, error, normalized success, cancel/discard, stale record, deleted record, and edits-during-save cases preserve the intended data.
- [x] Switching editors/categories or leaving via app navigation does not silently drop dirty work; reload/history behavior is tested and documented.
- [x] Unauthorized and cross-school update attempts cannot mutate data, including forged record IDs and related IDs.
- [x] Overview uses the agreed hierarchy, truthful scopes, and `—` vs `0%` distinction; no fictional trends or missing-data zeros.
- [x] Metric fixtures cover duplicate bookings per session, cancelled bookings, unqualified/preview sessions, no-session bookings, zero denominator, and two schools. Numerator is a subset of denominator.
- [x] Upcoming drill-down count matches the metric for the same captured time, including cancelled-future-booking fixtures. Existing Bookings filter defaults still work.

### Release B checklist

- [ ] Class-time label/capacity edits and reopen work on the same ID; existing occupancy survives deactivation/reactivation.
- [ ] Structural edits work for unused times; history-bearing times have a working guided replacement flow.
- [ ] Replacement does not move/cancel existing bookings, rewrite snapshots, or generate duplicate replacement windows on retry.
- [ ] Capacity and structural changes are safe under concurrent booking/cancellation; test database constraints as well as displayed errors.
- [ ] Stale slots, parent-offering inactivity, full occurrences, timezone/DST, and missing/foreign record IDs have tested outcomes.
- [ ] Remaining intentional restrictions explain the reason and provide a real next action. Remove obsolete “not editable/reopenable yet” copy only when that capability is implemented.

### Visual/accessibility gate for both releases

At 1280×800 and 390×844, plus a 320px-width and 200%-zoom check:

- Overview summary and compact public-page status fit comfortably in the initial desktop viewport; settings show meaningful controls without explanatory stacks.
- No page-level horizontal scrolling, unreadably small metric labels, overlapping long names, or disappearing actions.
- Keyboard users can open/edit/save/cancel records and traverse disclosures; focus returns correctly and error/success announcements remain available after editor closure.
- Visible focus, associated unique field IDs/labels, AA text contrast, non-color-only statuses, and approximately 44px mobile targets. No hover-only Edit controls.
- Check all seven settings categories for shared-form regressions and public page/sign-in for shared-style regressions. Confirmation dismissal performs no mutation; confirmation submits once.
- Present before/after screenshots for empty/populated overview, trial-class editing, FAQ editing, and safe schedule replacement, using synthetic data only.

### Commands on the integrated branch

- `bun run check`
- `bun run test`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run test:integration` against local Postgres after adding actual feature integration tests under `src/**/*.integration.test.ts`
- `bun run test:e2e` against the setup-assigned local origin

An empty integration suite is not evidence of database safety. Keep fixture creation/cleanup tenant-scoped and coordinated with QA. Separate pre-existing failures and environment blockers from regressions; skipped commands are not passes. Update `docs/settings-ux-first-pass.md` and `docs/dashboard-design-system.md` only after implementation so current-state docs do not advertise planned behavior.

## Ready-to-use `/director` prompt

> Execute **Release B** from `docs/settings-overview-ux-plan.md`. Release A already shipped (#21): do not reimplement trial-class/FAQ editing or the overview metric rewrite. Current-state: `docs/settings-ux-first-pass.md`. Reuse the existing inline editor lifecycle, dashboard design system, and form-state architecture. Ship class-time editing, reopening, and guided replacement without moving existing bookings, behind the booking-safety / locking gate. Prefer no migration; escalate any schema change before implementing. Preserve school ownership, hidden fields, booking snapshots, and unsaved work. Use the repo's worktree ports/shared-Supabase contract and synthetic fixtures. Deliver integrated changes, before/after desktop/mobile screenshots of schedule editing/replacement, unit/integration/E2E results (including the B race cases), updated current-state docs, and explicit remaining risks. Do not deploy or change production data.
