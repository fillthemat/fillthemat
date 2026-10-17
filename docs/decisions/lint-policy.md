# @shadcn/lint policy — decision doc

**Status:** accepted and implemented (PR #39 — `@shadcn/lint` hosted on Oxlint,
all six `shadcn/*` rules, `no-restyle` at `error`, and the whole-repo compliance
fit so `bun run lint` reports zero findings). Do not reopen unless the team
promotes the four `warn` rules to `error`, the component set grows past the
current ui primitives and genuinely needs a new `no-restyle` contract (e.g.
Card/Dialog), or `@shadcn/lint` stabilizes past its current alpha and the
recommended policy changes.
**Date:** 2026-09-15
**Scope:** the final `@shadcn/lint` rule configuration in `.oxlintrc.json` plus
the compliance migration of `src/` to zero findings. `.oxlintrc.json` is the
single source of truth for exact values — this record explains why the config is
shaped the way it is, not the JSON itself.

---

## Final rule set

| Rule                            | Severity | Notes                                                    |
| ------------------------------- | -------- | -------------------------------------------------------- |
| `shadcn/no-restyle`             | `error`  | `allow: ["layout"]` + a `^TableCell$` contract (§ below) |
| `shadcn/require-static-classes` | `error`  | static `cn(...)` literals only                           |
| `shadcn/no-raw-colors`          | `warn`   | zero findings — promotable to `error`                    |
| `shadcn/no-arbitrary-values`    | `warn`   | zero findings — promotable to `error`                    |
| `shadcn/no-inline-styles`       | `warn`   | zero findings — promotable to `error`                    |
| `shadcn/no-unknown-classes`     | `warn`   | zero findings — promotable to `error`                    |

The `src/components/ui/**` override turns off `no-restyle`,
`no-arbitrary-values`, and `require-static-classes` there, so the primitives may
use their own palette and tokens without tripping the consumer-facing rules.

## Why `no-restyle` is `error` with `allow: ["layout"]` + `^TableCell$`

Restyling a primitive from a call site is the highest-signal rule: it is how
visual drift creeps into a design system. Consumers may still pass `layout`
(and only `layout`) so a primitive can be sized/positioned where it is used.
`TableCell` gets a one-off contract additionally allowing `typography` and
`text-muted-foreground` because the booking table styles its cells per-column —
column header/cell pairs must match exactly, so that styling legitimately lives
at the table, not inside the component.

## Input `code` / `uppercase` variants

Three typography overrides sat on `<Input>`/`<TextField>` call sites: the hex
color field (`font-mono uppercase`) and the two-letter country field
(`uppercase`). Two alternatives were rejected:

- **Consumer `className`** — would void `no-restyle` by reopening `Input`'s
  typography to arbitrary call-site styling.
- **A broad `Input` contract** — would give every consumer the same reach and
  defeat the rule's purpose.

Instead `Input` gained a `variant` API (via `cva`, matching the existing
`button.tsx` / `badge.tsx` convention):

- `variant="code"` → `font-mono uppercase` (hex color codes);
- `variant="uppercase"` → `uppercase` (country codes — the casing is a real UX
  nicety, and the schema also normalizes to uppercase on submit, so the display
  must match; kept in the default sans font).

`TextField` now forwards a `variant` rather than an arbitrary `className`. The
override lives in the component that owns the styles, which is exactly what
`no-restyle` wants.

## `--color-page-*` tokenization (`no-raw-colors`)

The public (non-dashboard) surface used raw `zinc-*`/`red-*` utilities. They
became a **static** `@theme` block in `src/app/globals.css`, separate from the
existing reactive `@theme inline` that maps the dashboard tokens:

- `--color-page-50…950` — the public neutral ramp, each value **equal to the
  corresponding Tailwind `zinc-*` step** (e.g. `--color-page-950: #09090b`), so
  every `bg-`/`border-`/`text-zinc-*` swaps to `*-page-*` 1:1 with no pixel
  change.
- `--color-page-error: #dc2626` — the light booking form's `text-red-600`.
- `--color-page-accent-default: #111111` — the "default dark accent" fallback,
  referenced via `var()` so `no-inline-styles` accepts the dynamic accent.

We deliberately did **not** reuse the dashboard semantic tokens for the public
pages: those are `@theme inline` mapped to CSS variables that change with the
owner theme, whereas the public surface needs a fixed, literal zinc palette.

`text-red-400` (onboarding / dev-email-auth errors) maps to `text-destructive`:
`<html>` always carries `dark`, so `--destructive` resolves to `#f87171` =
`red-400` exactly.

### Arbitrary-value → scoped tokens

Remaining arbitrary values became scoped theme tokens rather than ad-hoc
utilities: `--tracking-eyebrow: 0.2em`, `--text-metric: 1.75rem`,
`--text-metric-lg: 2rem`, `--text-page-title: 1.375rem`,
`--container-preview-logo: 60%`, and `--settings-page-columns: minmax(0, 1fr)
18rem`. (`min-h-[320px]` simply became the existing `min-h-80`.)

### Font-size tokens: the `text-(length:--*)` disambiguation

A `--text-*` theme token surfaces as a `text-<name>` class, which the plugin's
`cn`-grammar classifier misreads as a _color_ utility — so `text-metric` was
flagged by `no-raw-colors` as "not a declared theme color". The Tailwind v4
disambiguating form `text-(length:--text-metric)` both sets
`font-size: var(--text-metric)` correctly and passes every rule. Use the same
`length:` form for any future font-size token.

## Dynamic accent via custom property (`no-inline-styles`)

- `PublicPagePreview`: `backgroundColor: accent` became
  `style={{ "--accent": accent }}` + `bg-(--accent)` — the plugin's documented
  dynamic-value pattern. The fallback changed to
  `var(--color-page-accent-default)` so the rule's "custom property hardcodes a
  color" check passes; the rendered pixel is identical.
- `src/app/s/[slug]/page.tsx`: the `--school-accent` custom property was dead —
  no `bg-(--school-accent)` consumer exists anywhere — and its fallback literal
  would still trip the rule, so it was removed along with its now-unused
  `accent` const. Zero rendered change; the live page never consumed it.

## Verification

`bun run lint` reports zero findings (exit 0); `bun run check` and `bun run
build` pass; compiled CSS confirms the `*-page-*` tokens resolve to their exact
zinc hexes and the scoped tokens render as intended; `bun run test` passes.

---

## Caveats / revisit triggers

- `@shadcn/lint` is `0.1.0` (alpha). Its `cn`-grammar classifier caused the
  `text-*` font-size collision above; re-check the recommended policy when the
  project upgrades past alpha.
- `no-raw-colors`, `no-arbitrary-values`, and `no-inline-styles` remain `warn`
  per the recommended policy. At zero findings each is safely promotable to
  `error` once the team is comfortable — the natural first revisit.
