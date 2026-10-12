# Coding standards

## Where code belongs

**Keep related work together**:
Put shared business code in `src/lib/<area>`, such as `schedule` or `conversations`. Keep dashboard-only queries, actions and forms beside their page in `src/app`.

**Keep API routes focused**:
Routes in `src/app/api` check requests, call library functions and return responses. They must not import database code; Oxlint checks this.
_Example_: `src/app/api/bookings/route.ts` → `src/lib/schedule/book-slot.ts`

**Separate database setup from business work**:
`src/db` holds the connection, table definitions and database row types; `drizzle` holds migrations. Library functions and dashboard server code run queries; booking checks and writes stay together in `book-slot.ts`.

**The assistant prepares; the platform books**:
The assistant proposes a Booking Intent or Lead Request, never a booking or lead. Enforce rules in code, not just instructions; keep school facts in instructions and fetch trial offerings and occurrences through tools.
_Example_: `src/lib/ai/tools/prepare-booking.ts`; `docs/adr/0003-school-facts-in-prompt-live-data-in-tools.md`

## Pages and UI

**Let pages assemble the screen**:
Pages and layouts in `src/app` load data and arrange the screen; nearby components handle page-specific UI. Put shared components in `src/components` and basic controls in `src/components/ui`.

**Change controls through variants**:
Use a control's `variant` for appearance changes; add new variants inside the control instead of restyling each use. Oxlint checks shadcn styling and static classes; see `docs/decisions/lint-policy.md` for the few exceptions.
_Example_: `src/components/ui/input.tsx`

## Everyday style

**Keep changes proportionate**:
Prefer the smallest change that solves the issue. State a reason in the PR body for each new dependency, new file over approximately 150 lines, or large lockfile change. These triggers need an explanation; they are not bans or reasons to split an implementation artificially.

**Run everything through `bun run`**:
Every command an agent or human runs has a `package.json` script; docs never show raw `bun scripts/...` or `bunx` commands.

**Follow the existing names**:
Use lowercase, hyphenated file and folder names, such as `book-slot.ts`; keep Next.js names such as `page.tsx` and `route.ts`. Use PascalCase for components and types, and camelCase for functions and variables.

**Keep types and validation with their owners**:
Export shared types from the file that defines the work; database row types live in `src/db/schema.ts`. Reuse Zod checks from `src/lib/validation.ts`, with chat checks in `src/lib/chat/requests.ts` and settings checks beside the settings page.

**Keep tests beside the code**:
Use `*.test.ts` for unit tests and `*.integration.test.ts` for database-backed tests. Shared test helpers and fixtures live in `src/test`; browser tests live in `e2e`.

**Keep failures visible**:
Return clear codes for expected failures, such as `slot_unavailable`. Rethrow unexpected errors rather than reporting success. Log unexpected errors as one line: `console.error(JSON.stringify({...}))`.

**Let tools handle mechanical style**:
Run `bun run lint` for Oxlint's import and UI rules, and `bun run check` for Biome's formatting, import order and recommended code checks. Use `bun run check:write` to apply Biome fixes instead of formatting by hand.
