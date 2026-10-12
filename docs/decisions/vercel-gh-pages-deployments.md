# Skip Vercel deploys for `gh-pages` — decision doc

**Status:** accepted and implemented (`vercel.ts` `git.deploymentEnabled.gh-pages
= false` + `ignoreCommand`, project Ignored Build Step, existing `gh-pages`
deployments deleted). Do not reopen unless reports move off GitHub Pages or
Vercel starts deploying another non-app branch.
**Date:** 2026-09-16
**Scope:** why Hobby “deployment storage” spiked, and why Playwright visual
reports must stay on GitHub Pages only.

---

## Decision

Do **not** let Vercel create or retain deployments for the `gh-pages` branch.
Playwright HTML reports stay on GitHub Pages
(`https://jakegoodmandev.github.io/fillthemat/playwright/<pr>/`).

`vercel.ts` is the durable config:

- `git.deploymentEnabled["gh-pages"] = false` — no auto-deploy for that branch
- `ignoreCommand` — if a deployment is created anyway, skip the build when
  `VERCEL_GIT_COMMIT_REF=gh-pages` (exit `0` = skip). The shell guard runs before
  `bun run vercel:ignore-build`: the report branch has no `package.json` or
  `scripts/`. Other branches defer to the docs-only Preview skip.

The dashboard Ignored Build Step must keep the shell-only check
`[ "$VERCEL_GIT_COMMIT_REF" = "gh-pages" ]` and must never use the `bun` command.
Only the dashboard command applies on `gh-pages`: that branch has no `vercel.ts`,
`package.json`, or `scripts/`. Leave dashboard settings unchanged.

Existing Ready `gh-pages` preview deployments were deleted so the 30-day
retention window is not still holding accumulated report trees.

## Why this spiked

Through 8 Sep the project had a handful of deploys per day. On 10 Sep (Playwright
HTML reports to `gh-pages`, PR #18) Vercel started building **every** report
push because `createDeployments` is enabled and there was no ignored-build
step.

- `main` source tree is ~2.4 MB.
- `gh-pages` is an accumulating report archive (`playwright/13`…`42`, ~361 MB,
  1601 files at the time of this decision).
- Each report commit deployed the **whole** tree again. ~40 Ready `gh-pages`
  deployments sat in the 30-day / keep-10 retention window.

Director worktree previews added deploy **count** and Hobby build-queue time;
they are small. The gigabytes were the report branch.

GitHub Actions already publishes those reports for humans. The Vercel copies
did no work the app needed.

## Alternatives rejected

- **Stop publishing reports** — loses the in-browser screenshot/trace UX on PRs.
- **Ignore `director/*` too** — those previews are useful; they are not the
  storage problem.
- **Shorter retention only** — still rebuilds and stores a 361 MB tree on every
  report push until expiry.
- **App code / Playwright test changes** — the tests are fine; the Git
  integration was pointed at the wrong branch.

## Follow-up

If CI ever publishes reports some other way that still pushes to a branch
Vercel watches, add that branch to `git.deploymentEnabled` the same way.
Do not put report artifacts on `main`.
