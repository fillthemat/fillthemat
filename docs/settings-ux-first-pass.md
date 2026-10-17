# Settings UX — first pass (implementation notes)

Implements the first pass of `docs/archive/settings-ux-research.md`, plus Release A
of `docs/settings-overview-ux-plan.md` (trial-class/FAQ inline editing and
overview metrics, shipped in #21).

**Next work:** Release B — safe class-time management. Spec, locking gate,
and acceptance checklist live in `docs/settings-overview-ux-plan.md`. This
file is current-state after A. Schedule copy that says times cannot be
reopened or structurally edited is still true until B ships; do not treat it
as accidental.

The seven categories are unchanged: Profile (“School”), Offerings (“Trial
classes”), Schedule, Pricing, FAQs, Agent, Branding.

**Presentation:** owner dashboard visuals now follow
`docs/dashboard-design-system.md` (shared primitives, tokens, AlertDialog).
Route IDs, `sectionHref()`, form-state, and authorization contracts in this
file still apply.

Design thesis: the owner is teaching a helpful receptionist about their school,
not editing an AI configuration database.

## Route and navigation contract

- One route, `/dashboard/settings`, with a deep-linkable `section` query
  parameter: `?section=profile|offerings|schedule|pricing|faqs|agent|branding`.
- `?section=profile` and no parameter are the same page; `sectionHref()` in
  `src/app/dashboard/settings/sections.ts` is the only place that builds these
  URLs. Unknown values fall back to Profile.
- Categories are real `<Link>`s, so Cmd/Ctrl-click, middle-click, back, and
  forward all behave natively.
- Unsaved edits intercept **same-origin left-clicks** that leave the current
  settings view (category nav, in-content links, and dashboard nav) and ask
  Keep Editing / Discard Changes (`settings-shell.tsx`). `beforeunload` still
  covers reload, tab close, and cross-origin leaves.
- Browser Back/Forward is **not** intercepted. Next.js App Router has no
  `router.beforePopState` (Pages Router only). `popstate` fires after the
  router has already applied the history entry.
- Kept as a query parameter (not nested routes) so `page.tsx` stays the single
  settings entry point and `revalidatePath("/dashboard/settings")` in every
  action stays correct. Mutations also revalidate `/dashboard` and `/s/<slug>`.

## Files

| File                 | Role                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `page.tsx`           | RSC shell: resolves the section, loads only that section's data. |
| `sections.ts`        | Category ids, labels, purpose copy, `sectionHref`.               |
| `settings-shell.tsx` | Client shell: local nav rail + unsaved-changes guard.            |
| `actions.ts`         | Server Actions. Every one still calls `requireOwnedSchool()`.    |
| `mutations.ts`       | School-scoped writes used by actions (and integration tests).    |
| `schemas.ts`         | Zod schemas + owner-facing validation messages + limits.         |
| `form-state.ts`      | `SettingsFormState` returned by every action.                    |
| `form-utils.ts`      | Pure save/merge helpers, including create `clearOnSuccess`.      |
| `queries.ts`         | Server-only reads (kept out of `"use server"` on purpose).       |
| `format.ts`          | Pure formatting: times, durations, age ranges, counts.           |
| `ui/*`               | Labeled controls, save bar, confirm dialogs, inline editors.     |
| `sections/*`         | One client component per category.                               |

`windowHasFutureBooking` moved from `actions.ts` to `queries.ts`: exporting it
from a `"use server"` module made it a callable endpoint that accepted any
`schoolId`.

## Inline create / edit editors (trial classes and FAQs)

- One expanded editor under the selected row (or the Add panel). Not a modal
  and not a new route. Create and Edit reuse the same field components.
- Each existing row has a visible Edit button. Stop Offering / Offer Again and
  Delete Question stay secondary and distinct.
- One open create/edit panel per category. Switching records or opening Add
  while dirty asks Keep Editing / Discard Changes. A clean panel switches
  immediately. Submit marks the editor saving synchronously, so a following
  click cannot unmount it. While saving, switch/Add/Cancel are blocked (no
  discard dialog) because server actions are not abortable from the client.
- Opening Edit loads every supported saved field from the record DTO, including
  values omitted or truncated in the summary.
- Editors have a contextual heading, a primary save action, and Cancel. Cancel
  closes without writing; if dirty, confirm discard. Idle Cancel uses the
  form's own dirty flag (not `dirtyKeys`) so a clean panel never shows the
  discard dialog.
- Save disables while pending, preserves input on validation/server failure,
  and focuses the first invalid control. Success is never optimistic.
- After confirmed success, the row updates from normalized server values.
  The editor closes and focus returns to Edit only if nothing newer was typed
  during the save; otherwise those edits stay and the form shows Unsaved
  changes.
- Create success announces in a live region **outside** the editor that closes,
  then focuses the new row. Characters typed after submit are not wiped
  (`applyCreateSuccessValues` / `clearOnSuccess`).
- Same-record Stop Offering / Delete is disabled while that record’s save is
  pending. Each editor is keyed to a record so a late response cannot overwrite
  another editor.
- Updates use `updatedAt` as an optimistic concurrency token. Conflicts keep
  typed values and ask the owner to reload; they never silently overwrite.
- Trial class edits update the existing offering ID. `active`, class-time IDs,
  and `waiverNotes` are not written by the editor. Age changes affect new
  booking eligibility only; existing reservations keep their snapshots.
- Stop Offering / Offer Again sends an explicit desired `active` state.
- Offered is not the same as bookable: an offered class with zero active times
  links to Schedule (“Add a class time”) instead of claiming availability.
- FAQ edits keep id and `sortOrder`. The 20-question limit applies to creating
  new rows, not to correcting existing ones. Answer disclosure is a separate
  `<details>` from Edit; actions are not nested inside the summary.

## Feedback model

Actions no longer fail silently. Each returns
`{ status, message, fieldErrors, values }`. The shared `run()` wrapper calls
`unstable_rethrow(error)` before mapping anything to form state, so Next.js
control flow — the `redirect()` inside `requireOwnedSchool()` when a session has
expired, `notFound()` — still reaches the framework instead of being reported as
a save failure. The states are:

- pending — submit button shows “Saving…”, stays enabled until the request
  starts, `aria-busy` set;
- validation — inline message under the field, `aria-invalid`, focus moves to
  the first invalid control, everything typed is preserved;
- server error — one plain sentence with a next step; nothing is lost;
- success — a sentence in a polite live region, the form re-baselines to the
  values the server stored (so “ca” becomes “CA” without looking unsaved). An
  action that reports success without echoing values back falls back to what was
  submitted, so a save can never leave the form stuck on “Unsaved changes” with a
  Discard button that would undo a write that already happened.

Saves are live. No draft/publish model for settings, and the UI says so
(“Saved changes are used by your agent right away.”).

Destructive or family-visible actions (delete FAQ, delete class time, turn off a
class time or a trial class) confirm in a native `<dialog>` — focus trap,
Escape, and backdrop for free. There is no undo, so nothing is deleted without
a confirmation.

## Restrictions the UI now explains

- Published schools: slug and time zone are locked, with a callout that says why
  and shows the current values.
- Class times on the calendar cannot be deleted — the delete button is replaced
  by the reason and the “turn it off” alternative.
- Capacity cannot drop below the students already booked in an upcoming class;
  the minimum is on the input and the server repeats it if bypassed.
- Turned-off class times cannot be reopened yet; the row says so.
- Trial classes can be edited in place; they still cannot be permanently
  deleted. Stop Offering / Offer Again remains reversible.
- FAQs can be edited in place. They cannot be reordered yet. The 20-question
  limit is visible and applies to creating, not editing.
- Changing a trial class’s age range does not change who is already booked.

## Honest previews

`ui/public-page-preview.tsx` renders a representative version of the family-facing
page (logo, school name, location, welcome message, accent color). It is labeled
“Representative view … spacing and colors on the live page may differ”, marked
“Unsaved” whenever it is showing unsaved edits, and never claims to be a test of
agent behavior. There is no interactive agent test in this pass, so no preview
can create a booking, lead, or notification.

## Deliberately out of scope (this pass)

New categories, AI model controls, website ingestion, uploads, multi-channel
settings, draft/publish for settings, schema migrations, FAQ reordering, and
in-settings agent testing.

**Release B (next, specified in `docs/settings-overview-ux-plan.md`):**
reopening class times, capacity/label edits through the shared inline editor,
in-place structural edits when a time has no history, and guided replacement
when it does — without moving, cancelling, or notifying existing bookings.
Needs a proven transaction/locking strategy shared with booking confirmation,
cancellation, and occurrence creation. Prefer no migration.

`createOfferingAction` already accepted `expectations` and `waiverNotes`; the
form exposes `expectations` (the booking agent reads it) and keeps accepting
`waiverNotes` without a field. Edit must not clear `waiverNotes`.

## Tests

- `bun run test` — `schemas.test.ts` (validation and normalization),
  `format.test.ts`, and `form-utils.test.ts` (save merge / clearOnSuccess).
- `bun run test:integration` — offering/FAQ mutations (identity, hidden-field
  preservation, stale `updatedAt`, foreign IDs, FAQ limit) and overview metric
  fixtures against local Postgres.
- `bun run test:e2e` — `e2e/settings.spec.ts` covers deep links, history,
  validation errors with preserved input, a successful save, server-normalized
  values, the unsaved-changes guard, add/delete with confirmation, trial-class
  edit, FAQ edit, and dirty editor switching. `e2e/overview.spec.ts` covers
  metric labels and drill-downs. `playwright.config.ts` takes its base URL from
  `.env.local` (`NEXT_PUBLIC_SITE_URL`), so it respects the worktree port
  contract.
