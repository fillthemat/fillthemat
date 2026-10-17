> Archived. Not current instructions. See docs/README.md.

# Dashboard makeover — director handoff

## Mission

Give the owner dashboard a cohesive, approachable design using one small design system. This is a presentation and interaction-polish pass, not a product rebuild.

**User priorities, in order:**

1. Simplicity and clarity.
2. Consistency across the dashboard.
3. Compact, useful layouts: less unnecessary whitespace.
4. Less redundant copy: no habitual subtitle beneath every heading, caption beneath every control, or explanation beneath every navigation item.

The result should feel like a practical tool for a martial arts school owner, not an AI configuration console or a generic analytics template. Compact does not mean tiny text, crowded controls, or hidden actions.

**Status:** planning only. No UI implementation, dependency installation, or browser verification has been done for this handoff.

## 1. Design-system decision

**Recommended choice: shadcn/ui using Radix primitives, Tailwind v4, and the existing Geist fonts.** Adopt its component source and semantic tokens, not a prebuilt dashboard block. Confirm current official installation guidance and compatibility before installing; do not blindly execute the older commands in `docs/v1-plan.md`.

Why this choice:

- Fits the existing React 19 / Next.js 16 / Tailwind v4 stack without replacing the styling approach.
- Supplies consistent controls and accessible interaction primitives while leaving density and copy under our control.
- Matches the original architecture's intended kit; neither shadcn nor Radix is installed today.
- Lets us migrate incrementally while preserving settings' existing form logic.

Alternatives considered:

- **Mantine/MUI:** capable, but introduce a larger parallel styling/component model for a small existing Tailwind app.
- **Continue with bespoke components:** smallest immediate dependency change, but leaves us maintaining every interaction and visual convention ourselves.

Do not run a multi-kit bake-off. The foundation agent should validate this recommendation, record the selected shadcn style/base, and report any concrete incompatibility to director. A different kit requires director approval before downstream agents begin.

### Minimum component inventory

Start with Button, Input, Textarea, Label, Badge, Separator, Table, and AlertDialog. Add other components only for an actual approved interaction. A Card is optional, not the default wrapper for everything.

- Keep native selects for simple choices unless there is a demonstrated usability need for a custom select. Style them consistently.
- Keep date, time, number, and color controls native where practical.
- Use real links for navigation and URL-backed filters, not an ARIA tab widget just because it looks like tabs.
- Add icons only where they improve recognition; if needed, use one library such as Lucide. Text remains the primary label.
- No AI SDK Elements, charting package, data-table framework, form-state library, theme switcher, animation framework, or full shadcn registry installation in this pass.

## 2. Scope and guardrails

### In scope

- `/dashboard`: overview, publication/readiness presentation, metrics hierarchy.
- `/dashboard/bookings`: filters, rows, status display, action presentation, cancellation confirmation.
- `/dashboard/leads`: compact, readable records and empty state.
- `/dashboard/settings`: all seven categories, local navigation, controls, feedback, confirmations, previews.
- Shared dashboard shell, components, semantic tokens, and regression tests.

### Out of scope

- Marketing/home, sign-in, onboarding, and public `/s/[slug]` redesigns. Smoke-test them for shared-CSS regressions.
- Database migrations, query-semantic changes, auth changes, API changes, analytics definitions, booking eligibility, email behavior, or AI behavior.
- New filters, search, pagination, charts, school switcher, notifications, account menu, or features without existing behavior behind them.
- New settings categories, autosave, draft/publish settings, FAQ/offering editing, or interactive agent testing.
- Deployment or changes to production data/configuration.

**Do not confuse shorter UI copy with removing safeguards.** Preserve labels, validation, disabled-action reasons, time-zone context, destructive confirmations, and information needed to make a decision.

## 3. Visual direction and density contract

Use a **quiet, compact, softened-dark dashboard** for this pass. Keep the current dark-mode direction; replace inconsistent near-black boxes and zinc class strings with a coherent token system. Approachability should come from readable contrast, plain language, predictable controls, and less clutter—not illustration, oversized cards, or a new theme preference system.

| Element    | Starting specification                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Color      | Charcoal canvas, subtly raised surfaces, readable muted text, restrained borders. Neutral primary action; semantic success/warning/destructive colors only where meaningful.         |
| Tokens     | Background, foreground, surface/card, muted, muted-foreground, border/input, primary, secondary, accent, destructive, ring, and status variants. Pages must not invent new palettes. |
| Typography | Existing Geist Sans; 14px default UI text, 12px secondary metadata, 22–24px page title, 16–18px section heading. Never shrink essential content to decorative microtype.             |
| Spacing    | 4px base scale; 8px within tight groups, 12–16px between related controls/rows, 20–24px between sections. Usually 16px mobile and 24px desktop page padding.                         |
| Controls   | Roughly 36–40px tall on pointer-oriented desktop layouts; comfortable approximately 44px touch targets on mobile. Maintain spacing and WCAG target-size requirements.                |
| Shape      | Consistent modest radii (roughly 6–8px controls, 8–12px panels). Pills reserved for badges/segmented navigation, not every button.                                                   |
| Layout     | Stable desktop navigation rail around 200px. Compact mobile top navigation; avoid a tall stacked menu before every page. No unnecessary collapsed-rail state.                        |
| Width      | Let operational lists use the available width. Cap long text/form lines where it improves reading; do not stretch a single input just to eliminate all empty space.                  |
| Motion     | Brief color/focus feedback only; honor reduced motion. No decorative entrance sequences.                                                                                             |

Additional rules:

- One clear page heading. Section headings only where they divide real tasks.
- No default page subtitle. Remove explanatory text that restates a heading or label.
- Prefer separators and alignment over nested cards. Avoid card → card → fieldset stacks.
- Keep routine actions visible and text-labeled. Do not replace three legible actions with a mystery kebab menu just to save space.
- Prefer one obvious primary action per task area, not a row of equally loud buttons.
- Do not reserve empty helper-text/status rows. Keep live regions accessible without adding permanent visual gaps.
- Status is conveyed by words as well as color. Long school names, emails, and FAQ answers must wrap or have an accessible way to reveal the full value.
- Shared page/header components may be small layout helpers; do not build a configurable dashboard framework.

### Copy-removal test

For every subtitle/helper/callout, ask: **Does this add a fact the owner needs here that the label does not already convey?** If not, remove it. If yes, place one concise explanation next to the relevant decision.

Concrete targets:

- Remove the settings intro: “Teach your agent about your school and manage the trial-booking experience.”
- Remove navigation hints such as “Name, contact, arrival” under “School.”
- Remove blanket section-purpose paragraphs beginning “Your agent uses…”; move only necessary constraints to their relevant controls.
- Use “Trial classes” rather than “offerings,” and “Class times” rather than “windows” in owner-facing copy.
- Replace raw statuses like `no_show` with “No-show”; raw ISO timestamps with readable dates and appropriate timezone context.
- Replace founder/dev instructions such as `ALLOW_SELF_APPROVAL` / “set approved_at in Studio” with an honest “Awaiting approval” state. Do not invent a support/contact workflow.
- Keep a concise explanation that settings saves take effect immediately, near the save interaction where needed; do not repeat it in multiple places on the same screen.
- Keep the representative-preview disclaimer and unsaved indicator once per visible preview. Never imply a preview is an actual agent test.

## 4. Screen-by-screen changes

### Shell

Files: `src/app/dashboard/layout.tsx`, new small dashboard shell/navigation components as needed.

- School identity once; Overview, Bookings, Leads, Settings in a consistent navigation pattern.
- Clear active route with `aria-current="page"`, hover and focus states.
- Preserve server-side ownership enforcement. Keep only interactive navigation pieces client-side.
- Include a skip link and one main landmark per rendered page; avoid nesting a new shell `<main>` around existing page `<main>` elements.

### Overview

File: `src/app/dashboard/page.tsx`.

- Label it “Overview” to match navigation.
- Replace the verbose publication box with a compact status/action area: Published or Unpublished, public link when available, Preview, and Publish only when relevant.
- When unpublished, show concise unmet-readiness information from existing data and preserve the actual publish action's server validation. Do not claim a complete checklist without checking all of its real requirements.
- Lead with **Upcoming bookings, Leads, Conversion rate** in one compact summary row. Keep their existing definitions; do not add fictional “this week” labels.
- Move qualified sessions, converted sessions, chat-assisted bookings, active trial classes, and active class times into a compact secondary details area. Keep definitions discoverable where labels alone would mislead.
- Move email failures and last maintenance into a low-emphasis “System status” disclosure, not equal-sized business KPI cards. Surface an existing failure count as a visible warning when nonzero; do not invent maintenance-health thresholds.
- No charts, new metrics, or new queries required. Reorganize the existing information rather than deleting access to it.

### Bookings

Files: `src/app/dashboard/bookings/page.tsx`, new booking presentation/action components.

- Compact URL-backed Upcoming / Past / All filter links with selected state; preserve current query behavior and sort order.
- Shared table styling on desktop. At narrow widths, use readable stacked records or a deliberately contained table scroller; never make the whole page horizontally scroll.
- Participant/class/time are prominent; contact and email-delivery status remain available without competing equally for attention.
- Human-readable statuses and dates; preserve booking timezone snapshots and all existing action eligibility.
- Clear empty state that reflects the selected filter. No dead-end fake CTA.
- Keep Showed / No-show actions efficient; visually separate Cancel as destructive.
- Add accessible cancellation confirmation before invoking the existing server action. Dismissing the dialog must perform no mutation. Do not claim success without a confirmed result or completed revalidation.

### Leads

File: `src/app/dashboard/leads/page.tsx`.

- Replace per-lead oversized cards with compact rows or one divided list surface using the same spacing and typography as bookings.
- Prioritize contact, participant, stated need, and readable date. Use actionable email/phone links where values exist.
- Omit unnecessary “No stated need” / “No participant” filler when absence is clear; retain any information necessary to interpret the record.
- Show a short, honest empty state. No implied CRM follow-up feature.

### Settings

Files: `src/app/dashboard/settings/{page.tsx,settings-shell.tsx,sections.ts,sections/*,ui/*}`.

- Keep the seven categories, their IDs, query URLs, and `sectionHref()` contract unchanged.
- Make category navigation label-only and compact. Keep settings recognizably grouped; do not hide seven categories behind an unlabeled icon or duplicate the global nav.
- Eliminate the repeated page intro → section purpose → fieldset description ladder.
- Group related short fields into two columns where readable; long prose fields stay wide enough to edit comfortably. Mobile stays single-column.
- Reduce repeated borders/padding in field groups and item lists. Unrelated fields should not be squeezed together solely for density.
- Keep one save/discard/status area per existing form. Preserve pending, validation, error, success, normalization, and edits-during-save behavior.
- Keep restrictions close to the affected controls: published slug/timezone locks, capacity floors, deletion restrictions, inactive-time reopening limitations, FAQ limits, and unavailable editing.
- Agent/Branding preview remains secondary. Use a side preview only when the form retains comfortable width; collapse it on constrained screens without reserving an empty column. Keep representative/unsaved labeling concise and truthful.
- Replace native confirmation presentation with the shared AlertDialog where appropriate, preserving cancel, Escape, focus return, and the unsaved-navigation guard. Default destructive confirmation focus should be safe.

## 5. Technical migration rules

- Add shadcn source under `src/components/ui/`; keep app-specific shell/layout helpers under `src/components/dashboard/`.
- Establish one shared style utility if the kit requires it; no second independent class-variant system.
- `settings/ui/controls.tsx` can remain the settings-specific field adapter. It should compose shared primitives while preserving labels, IDs, descriptions, errors, controlled values, and existing prop contracts. Do not create a second competing Button implementation there.
- Preserve `useSettingsForm`, action signatures, Zod validation, authorization, tenant predicates, and server-side data loading. Do not wrap the entire dashboard in `"use client"` to use the kit.
- Foundation agent owns all global CSS/config changes. Preserve `background`/`foreground` behavior used outside the dashboard. Use an explicit dashboard theme boundary where necessary and a shared, tested portal-theme strategy so dialogs do not lose their tokens.
- Global `<html class="dark">` and the public light wrapper already coexist. Test public native controls and owner dialogs after token changes; do not silently redesign either public or auth surfaces.
- Install only used components/dependencies; inspect CLI diffs for overwritten fonts, root layout, styles, or configuration. Retain Geist's existing package-based loading.
- Read relevant installed Next.js guides in `node_modules/next/dist/docs/` before coding; consult current shadcn/Radix docs for composition, forms, and dialogs. Do not use remembered API signatures blindly.
- Load applicable project skills. For UI work: React best practices and web design guidelines; for browser work: Playwright. Load Supabase/database skills if fixture work actually touches auth/database code or data.

## 6. Director execution plan

### Phase 0 — baseline and coordination (director + QA)

1. Read `AGENTS.md`, `skills-lock.json`, `docs/local-development.md`, this plan, and `docs/settings-ux-first-pass.md`.
2. Capture baseline screenshots at desktop and mobile, record existing lint/test failures, and inventory current empty/populated states.
3. Use seeded local data only. Assign exclusive fixture ownership to QA; all worktrees share one database, so serialise mutating browser tests or provide isolated test tenants. Ports do not isolate data.
4. Assign the shared-file ownership below. No agent starts an independent style direction.

### Phase 1 — agent A: foundation and visual checkpoint

**Owns:** `package.json`, `bun.lock`, `components.json`, shared utilities, `src/app/globals.css`, any unavoidable root-layout changes, `src/components/ui/*`, `src/components/dashboard/*`, dashboard layout, and `settings/ui/controls.tsx`.

Deliver:

- Validated kit choice and minimal installation.
- Semantic theme, compact component variants, shell/navigation.
- Compatible settings control adapter.
- A short `docs/dashboard-design-system.md` describing tokens, component imports/APIs, spacing, status variants, and usage examples. No Storybook or production demo route required.
- Desktop/mobile screenshots of the shell and existing School settings using the new controls, plus representative button/input/error/disabled/dialog states.

**Gate:** director reviews whether it is cohesive, readable, compact, and less ornamental. Resolve token/component questions now. Integrate this foundation commit before agents B/C branch; subsequent shared-component changes are requests to A, not parallel edits.

### Phase 2 — parallel implementation

**Agent B: operational screens**

- Owns overview, bookings and leads page files, plus new screen-specific components outside A's shared directories.
- Implements section 4's operational-screen work using A's components.
- Does not edit server actions, queries' semantics, auth, schemas, or shared tokens. Escalate a required behavior change rather than expanding scope.
- Delivers screenshots, changed-copy notes, and interaction checks.

**Agent C: settings simplification**

- Owns settings page, settings shell, `sections.ts`, `sections/*`, and `ui/*` **except `controls.tsx`**.
- Removes redundant copy and nesting, standardizes save areas/dialogs, and compacts previews and forms.
- Preserves form-state mechanics and the documented settings contracts; request adapter changes from A.
- Delivers screenshots of every category and explicit checks of save/validation/unsaved behavior.

**Agent D: QA and consistency review**

- Owns `e2e/*` changes and test-only fixtures/support files; coordinates any test configuration change through director.
- Can prepare test scenarios in parallel, but runs mutation-heavy suites sequentially against shared data.
- Reviews A/B/C against one visual standard. Reports defects to the owner of the affected files rather than doing competing cosmetic edits.
- Does not weaken tests to accommodate lost behavior or create test auth bypasses.

### Phase 3 — integration and polish

Director integrates B and C after A, then D's tests. Re-run the full review on the combined branch. A handles shared-token/primitive corrections; screen owners fix their own layouts. Do not let an agent declare success based solely on isolated worktree screenshots.

All agents return: changed paths, summary, screenshots, commands/results, known failures, and any scope deviations. Update the current-state design docs only after implementation; keep historical planning docs clearly distinguished from implemented behavior.

### Worktree operations

Follow the existing contract, not a new setup process:

- Create `.worktrees/<name>` using `git worktree add`; run `bun run setup` there and use its printed origin.
- Do not pass `--port`, manually edit `NEXT_PUBLIC_SITE_URL`, or pick another port after a collision; stop and report it.
- Do not stop/recreate Supabase from a child worktree. Have director coordinate any machine-level stack problem.
- Stop each frontend with `bun run dev:stop`; remove the worktree from the repo root with `git worktree remove`. Do not hand-delete port claims.

## 7. Acceptance criteria

### Visual and copy

- One consistent family of buttons, fields, borders, badges, table/list rows, and dialogs across all dashboard routes. No remaining page-specific duplicate visual systems.
- Every settings navigation item is label-only; generic settings intro and repeated section-purpose paragraphs are gone.
- No dashboard-wide default subtitles, gratuitous empty panels, nested decorative cards, or ten equal-priority KPI cards.
- At 1280×800, Overview's primary summary/status/actions fit comfortably in the initial viewport; on School settings the first meaningful editable controls are visible without scrolling past explanatory blocks.
- At 390×844 (and a 320px narrow-width check), no page-level horizontal overflow. If a table scrolls, it scrolls locally and actions remain reachable.
- Main operational content is readable at 200% zoom. Density is achieved by removing repetition and padding, not by shrinking labels or hit targets.
- Before/after screenshots demonstrate reduced visual clutter. Screenshot evidence must use local demo data, not real contact information.

### Functional and accessibility

- Existing settings tests continue to pass: all categories/deep links, unknown-section fallback, browser history, input retention, inline validation, successful save, normalized values, unsaved navigation, and confirmed FAQ/class-time deletion.
- Keyboard-only navigation reaches all actions. Active navigation, visible focus, labels, status announcements, dialog focus trapping/return, safe cancellation, and Escape behavior work.
- Dialog tests cover dismiss-without-mutation and confirm-exactly-once; cancellation and settings destructive actions do not bypass server authorization.
- Bookings filters, attendance updates, cancellation eligibility, and time-zone displays retain their existing meaning.
- Readiness/preview/publish flow still works and no status labels imply capabilities that do not exist.
- Empty and populated bookings/leads; long content; form error/pending/success; published locks; and dirty preview states are checked.
- Public school page, sign-in, onboarding, and shared fonts/backgrounds have no unintended style regressions.
- Normal text meets WCAG AA contrast; focus/controls remain discernible. No color-only status or unlabeled icon-only action.

### Verification commands and evidence

Run on the integrated branch:

- `bun run check`
- `bun run test`
- `bunx tsc --noEmit`
- `bun run build`
- `bun run test:e2e` against the assigned running local origin

Separate pre-existing failures and environment blockers from regressions. Do not call a check passed if it was skipped. Follow browser checks with human-readable screenshot review; successful compilation alone is not acceptance.

## Ready-to-use director prompt

> Execute `docs/dashboard-makeover-plan.md`. Use shadcn/ui with Radix as the recommended foundation, with a compact softened-dark style and the existing Geist fonts. Prioritize consistency and simplicity: remove redundant subtitles, navigation hints, nested cards, and excess padding without removing meaningful labels, constraints, or feedback. Start with agent A's shared foundation and a visual checkpoint before parallelizing operational pages and settings. Preserve all existing behavior and the local worktree/shared-database contract. Agent D owns regression evidence and tests. Deliver the integrated changes with before/after desktop/mobile screenshots and verification results; do not deploy.
