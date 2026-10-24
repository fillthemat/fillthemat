# Dashboard design system

Implemented visual language for `/dashboard`. This is the current-state
reference for owner UI. Planning notes live in `docs/archive/dashboard-makeover-plan.md`
and `docs/settings-ux-first-pass.md` (contracts there still apply; presentation
follows this file).

## Kit

- **shadcn/ui** style `radix-nova`, **Radix** primitives (`radix-ui`), Tailwind v4, existing Geist fonts.
- Source lives in `src/components/ui/`. App chrome lives in `src/components/dashboard/`.
- One variant helper: `class-variance-authority`. One class merger: `cn` in `src/lib/utils.ts`, built from `clsx` + `tailwind-merge`.
- Config: `components.json`. Do not install the full registry, charts, data-table kits, or a theme switcher.

## Tokens

Semantic colors are CSS variables. Public and auth pages keep the global
`--background` / `--foreground` pair (`#ffffff` / `#171717` in `:root`,
`#0a0a0a` / `#ededed` on `html.dark`).

Dashboard canvas and raised surfaces are scoped:

- `.dashboard` — charcoal page background and the same semantic tokens.
- `[data-dashboard-theme]` — same tokens on portaled overlays (AlertDialog).
- Component tokens (`--card`, `--muted`, `--primary`, …) are also set on
  `html.dark` so a portal to `document.body` does not lose the palette.

| Token                             | Use                                         |
| --------------------------------- | ------------------------------------------- |
| `--background` / `--foreground`   | Canvas and copy                             |
| `--card` / `--popover`            | Raised surfaces and dialogs                 |
| `--muted` / `--muted-foreground`  | Secondary regions and metadata              |
| `--border` / `--input` / `--ring` | Hairlines, fields, focus                    |
| `--primary`                       | Neutral primary action (near-white on dark) |
| `--secondary` / `--accent`        | Quiet fills                                 |
| `--destructive`                   | Destructive actions and errors              |
| `--success` / `--warning`         | Status only, never as the only cue          |

Pages must not invent new palettes. Status always includes a word label.

## Overview metrics

`/dashboard` uses one grouped summary surface (border, equal cell padding,
desktop dividers, stacked mobile cells) — not three decorative cards. Metric
values are 28–32px semibold tabular numerals; labels 14px; evidence 12–14px.
Each cell is label → value → scope → optional real text link. No gradient
fills, metric icons, or unmeasured growth cues. Conversion is undefined (`—`)
when there are no eligible sessions; `0%` only when eligible sessions exist
and none converted.

## Typography and spacing

- Geist Sans. Default UI `text-sm` (14px). Metadata `text-xs` (12px).
- Page title 22–24px (`PageHeader`). Section heading 16–18px.
- 4px base scale. 8px inside tight groups, 12–16px between related controls,
  20–24px between sections. Page padding 16px mobile, 24px desktop.
- Controls 44px tall on small screens, 36px on `md+`. Radius 6–8px on controls,
  8–12px on panels. Pills are for badges and segmented filters only.

## Components

Import from `@/components/ui/<name>` (no barrel file).

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
```

### Button

`variant`: `default` | `outline` | `secondary` | `ghost` | `destructive` | `link`  
`size`: `default` | `sm` | `lg` | `icon`  
`asChild` merges onto a Radix trigger or `Link`.

Primary action per task area uses `default`. Cancel uses `destructive`
(outline treatment, not a solid red fill). Routine secondary actions use
`outline`.

### Fields

`Input`, `Textarea`, and `NativeSelect` share `controlClass`. Keep native
`select`, `date`, `time`, `number`, and `color` controls. Settings field
adapters in `src/app/dashboard/settings/ui/controls.tsx` compose these
primitives and preserve labels, ids, errors, and existing props.

### Badge

`variant`: `default` | `secondary` | `outline` | `muted` | `success` | `warning` | `destructive`

Booking statuses: Booked `outline`, Showed `success`, No-show `warning`,
Cancelled `muted`. Always pair with the human-readable word.

### AlertDialog

Use for destructive confirms and unsaved-navigation. Overlay and content set
`data-dashboard-theme`. Cancel is first in the DOM so initial focus is safe.
Escape and the cancel action must not mutate. Confirm runs the existing server
action exactly once.

## Shell

`src/app/dashboard/layout.tsx` stays a server component (ownership check).
`DashboardNav` is the only interactive chrome. Skip link targets
`#main-content` on each page `<main>`. Do not wrap pages in a second `<main>`.
Desktop rail ~208px (`md:w-52`). Mobile nav is a compact horizontal row.

Navigation and URL-backed filters are real `<Link>`s with `aria-current="page"`.

## Copy

One page heading. No default subtitle. Navigation items are label-only.
Helpers stay only when they add a fact the label does not already convey
(locks, floors, internal-only email, timezone). Owner-facing language uses
“trial classes” and “class times”, not “offerings” or “windows”.
