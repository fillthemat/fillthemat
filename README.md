# Fillthemat

Fillthemat is an AI-powered growth platform for martial arts schools that converts leads into trial classes, follow up automatically, and helps convert them into paying members.

V1 is a multi-tenant landing page and trial-booking product. Product intent and architecture: **`docs/product-brief.md`**; docs index: **`docs/README.md`**.

## Local development

Canonical setup: **`docs/local-development.md`**.

```bash
bun install
bun run setup
bun run dev
```

`bun run setup` starts local Supabase (OrbStack / any Docker Engine), writes `.env.local`, migrates, and seeds `owner@local.test` / `local-dev-password`. Then `bun run dev` and sign in with that email. The AI Gateway and Resend are optional (`bunx vercel env pull` / Resend key); without them the assistant answers with a scripted local model, email is logged instead of sent, and you can still book. Worktrees share that Docker stack and get their own Next port. `bun run doctor` checks the stack.

## Hosted deploy

Deploy steps (Vercel env, Supabase, Resend, cron): **`docs/v1-deploy-current.md`**. Keep the production session-pooler URI in gitignored `.env.production.local` (`DIRECT_URL` only). After `bun run db:generate` and a local `bun run db:migrate`:

```
bun run db:migrate:prod
```

## Agent skills

Skills are pinned in `skills-lock.json` (not committed skill files). Coding agents restore them via `bun run skills:install`. See `AGENTS.md`.
