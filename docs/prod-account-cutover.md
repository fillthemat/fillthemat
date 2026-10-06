# Production account cutover — personal → `admin@fillthemat.com`

Operator runbook. Do this **yourself** (dashboards, bank, identity providers). It is not an implementer task.

**Goal:** every production vendor, domain, invoice, and secret lives on Fillthemat identity (`admin@fillthemat.com`) and the company bank account. Personal Gmail / personal cards stop being in the blast radius.

**Status:** not started (Workspace mailbox exists). Revisit this file as you complete each vendor; tick the checklist at the bottom.

Related: `docs/v1-deploy-current.md` (what production needs), `docs/whatsapp-phase6-kickoff.md` (Meta), `docs/known-gaps.md` (pilot gate). After cutover, update those docs so they no longer name the personal Vercel team.

---

## 0. Principles

1. **Create new company accounts. Do not “change email” on the personal ones.** Billing, ToS, 2FA, and recovery stay tangled if you only add an alias. Exception: the domain registrar, if it already is Fillthemat’s domain and you can add `admin@` as owner without a transfer headache — still move billing to the company card.
2. **Cut over, then decommission.** Old and new can coexist. DNS, OAuth clients, and API keys change on a planned window. Do not delete the personal project until the new stack has passed smoke.
3. **Company card / bank on day one of each new account.** If a vendor trials without a card, add the card before any paid SKU (Vercel Pro, Supabase Pro, Resend, Gateway credits).
4. **Leave personal stuff personal.** `cosmikmuffin.com` stays on the personal Vercel team. OpenCode on a personal Zen key can stay personal until you decide otherwise. Local Docker / `.env.local` stays on the laptop.
5. **One extra human recovery path.** `admin@` as the only owner of Google Workspace + Vercel + the bank is a single point of failure. Add a second Workspace super-admin (another person or a break-glass mailbox) before you depend on this in production.
6. **Do not paste secrets into this repo.** New keys go to the new Vercel project only. Rotate anything that ever lived on the personal account.

---

## 1. Target identity (already true)

| Item | Value |
| --- | --- |
| Operator mailbox | `admin@fillthemat.com` |
| Domain | `fillthemat.com` (Porkbun nameservers; MX already `smtp.google.com`) |
| Public origin to keep | `https://www.fillthemat.com` |
| Bank | company account (connect as each vendor’s payment method) |

Workspace is the root of identity. Every new vendor login should be **Google sign-in with `admin@fillthemat.com`** where the vendor supports it, or a password in the company password manager with 2FA.

---

## 2. Inventory — what is on personal today

Snapshot from the founder-alpha era. Confirm in each dashboard before you touch it; names drift.

| Vendor | Personal owner (as of 2026-09) | What production uses | Move? |
| --- | --- | --- | --- |
| Google Workspace | — | `admin@fillthemat.com` already | Done |
| Porkbun | personal login | registrar + DNS for `fillthemat.com` | Yes (account or ownership + billing) |
| Vercel | user `jakegoodmandev-3440`, team `jakegoodmandev-3440s-projects` (Hobby) | project `fillthemat`, domain `fillthemat.com`, env, crons, AI Gateway **$25/mo project budget**, OIDC | Yes — **new team + new project** |
| Vercel domain `cosmikmuffin.com` | same team | unrelated | **No** |
| Supabase | org “jakegoodmandev's Org”, project `fillthemat` (`uhhabpnpfypjtnjyohwb`, `us-east-2`) | Auth + Postgres (`app` schema) | Yes — **new org + new project** |
| Resend | personal | `RESEND_API_KEY`, webhook, `RESEND_FROM` (was `onboarding@resend.dev` until the company mailbox) | Yes — **new account** |
| Cloudflare Turnstile | personal | site + secret keys on Vercel | Yes — **new account + new widgets** |
| Google Cloud OAuth | personal GCP project | Web client for hosted Supabase Google sign-in (and local callback) | Yes — **new GCP project under Workspace** |
| GitHub | user `jakegoodmandev`, repo `fillthemat` (public) | git deploys, Actions, Pages reports | Yes — **org + transfer repo** |
| Meta / WhatsApp | personal (Phase 6; tokens already on Vercel) | Cloud API app, WABA, system user token | Yes if you keep WA; otherwise leave unset on the new Vercel until Phase 6 |
| OpenCode Zen | personal | dev only | Optional |
| Bank / cards | personal | Vercel/Supabase/Resend invoices | Yes |

GitHub homepage metadata still says `https://fillthemat.vercel.app`; production origin is `https://www.fillthemat.com`.

---

## 3. Order of operations

Do it in this order so DNS and login keep working.

```
A. Company password manager + 2FA + break-glass admin
B. Porkbun: company login / billing (DNS stays put)
C. GitHub org (repo transfer can wait until E is ready to reconnect)
D. Google Cloud project + OAuth clients (no DNS change)
E. Cloudflare Turnstile widgets (no DNS change)
F. Resend account + verify sending domain (DNS TXT/CNAME — low risk if you add records, don't delete old until mail works)
G. Supabase org + project + migrate or recreate + wire Google Auth
H. Vercel team + project + env + git + domain move + first prod deploy
I. Point OAuth / Turnstile / Resend webhooks / Supabase URLs at the new origin (same origin if DNS unchanged)
J. Smoke
K. Meta/WhatsApp on the new stack (or explicitly skip)
L. Billing: company card on every vendor; Gateway budget; consider Vercel Pro + Supabase Pro
M. Decommission personal projects (after ≥7 days of clean prod)
N. Update this repo's deploy docs so they name the new team
```

**Freeze window (H–J):** 30–90 minutes where Google login and outbound email can break. Do not run a school demo that day. DNS for `fillthemat.com` should **not** need to change if Porkbun NS stay as they are and you only move the Vercel *domain assignment*.

---

## 4. Vendor playbooks

### A. Password manager and break-glass

- Company vault (1Password Business, Bitwarden org, etc.) owned by `admin@`.
- Store: registrar, GitHub org owner, GCP, Vercel, Supabase, Resend, Cloudflare, Meta, bank portal, 2FA backup codes.
- Second Workspace super-admin. Print/store recovery codes offline.

### B. Porkbun (`fillthemat.com`)

**Keep Porkbun nameservers.** Vercel already treats the domain as “Third Party / Third Party”. Moving NS to Vercel is optional and not required for this cutover.

1. Create or take over a Porkbun account under `admin@fillthemat.com`.
2. Transfer the domain **or** add `admin@` as the account owner and remove the personal login.
3. Put the company card on file for renewal.
4. Do not change NS, A/ALIAS for `www` / apex, or MX until after Vercel cutover is planned. MX must stay Google.
5. Later (Resend): you will **add** DKIM/SPF/CNAME records. Do not replace the Google MX. SPF should include both Google and Resend (`include:_spf.google.com` and Resend’s include). Today apex TXT is still `v=spf1 include:_spf.porkbun.com ~all` — update SPF when Resend is verified so Gmail + Resend both authorize.

### C. GitHub

1. Create org `fillthemat` (or similar). Org owner = `admin@fillthemat.com` (GitHub account that uses that email, verified).
2. Transfer `jakegoodmandev/fillthemat` → `fillthemat/fillthemat` (Settings → Transfer). Public repo: Actions minutes stay free.
3. Confirm Pages still publishes Playwright reports (`gh-pages`). After transfer the URL becomes `https://fillthemat.github.io/fillthemat/…` — update `docs/decisions/vercel-gh-pages-deployments.md` if you care about the old user Pages URL.
4. Reconnect the **new** Vercel project to the org repo (step H). The old Vercel git integration will go stale; that is expected.
5. Optional: require 2FA, disable personal deploy keys, add a second org owner.

Do **not** make the repo private just to look “company.” That starts Actions billing.

### D. Google Cloud (owner OAuth)

Hosted sign-in is Google OAuth through Supabase. Local still uses a separate client with callback `http://127.0.0.1:54321/auth/v1/callback`.

1. In Google Cloud, create project `fillthemat-prod` under the Workspace org (billing account = company).
2. APIs & Services → OAuth consent screen: External (or Internal if you only allow Workspace users — **Internal will block school owners on Gmail**). App name Fillthemat, support/developer email `admin@fillthemat.com`. Scopes: `openid`, email, profile only.
3. Create **two** Web clients (or one with both redirect URIs):
   - Production: JS origin `https://www.fillthemat.com`; redirect `https://<NEW_SUPABASE_REF>.supabase.co/auth/v1/callback`
   - Local: JS origin `http://127.0.0.1:3000`; redirect `http://127.0.0.1:54321/auth/v1/callback`
4. You cannot finish the production redirect URI until the new Supabase ref exists (G). Create the client now, add the URI in G.
5. Disable or leave the personal GCP OAuth client. Do not delete until Google login works on the new project.
6. Put client id/secret into the **new** Supabase Auth Google provider (not into Vercel). Local: `supabase/.env` as today.

### E. Cloudflare Turnstile

1. Sign up / add `admin@` Cloudflare account (Turnstile does not require a proxied site).
2. Create a **production** widget, hostname `www.fillthemat.com` (and apex if you serve it).
3. Keep Cloudflare’s always-pass **test** keys for local (`bun run setup` already writes those).
4. New site key → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; secret → `TURNSTILE_SECRET_KEY` on the **new** Vercel project.
5. Retire the personal widget after smoke.

### F. Resend

1. Create Resend account with `admin@fillthemat.com`. Company card on file (Free is enough until 100 emails/day).
2. Add domain `fillthemat.com` or `mail.fillthemat.com`. Prefer a sending subdomain (`mail.fillthemat.com`) so apex SPF/Google stay simple.
3. Add the DNS records Resend shows (DKIM CNAME, SPF include, optional `resend._domainkey`).
4. Create API key (sending + webhook). Create webhook `https://www.fillthemat.com/api/webhooks/resend` for delivered / bounced / complained. Copy signing secret.
5. Production env on the new Vercel:

   ```
   RESEND_API_KEY=
   RESEND_FROM=Fillthemat <admin@fillthemat.com>
   ```

   or `bookings@mail.fillthemat.com` if that is the verified From. **From must be on the verified domain.** `admin@` is fine for operator mail; a dedicated `bookings@` / `noreply@` is cleaner for prospects.
6. `RESEND_WEBHOOK_SECRET=` from the webhook.
7. Send a test to a non-Workspace inbox before decommissioning the personal Resend account.
8. Delete `onboarding@resend.dev` from production env. Personal Resend can stay for local experiments.

### G. Supabase

Create **new**, do not “transfer project” across orgs (painful and still tied to old billing).

1. New org under `admin@fillthemat.com`. Company card. For anything public-facing, **Pro** ($25/mo) so the project does not pause after a week idle — see cost notes in the funding discussion; Free is how founder-alpha got paused-risk.
2. New project, region **us-east-2** (keep the same region unless you have a reason). Empty.
3. Data API: do **not** expose schema `app` (browser uses Auth only). Same as `docs/v1-deploy-current.md`.
4. Copy into the new Vercel env:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Transaction pooler (port **6543**) → `DATABASE_URL`
   - Direct (port **5432**) → `DIRECT_URL` (also `.env.production.local` on the laptop for `bun run db:migrate:prod`)
5. Migrate schema:

   ```bash
   bun run db:migrate:prod
   ```

   against the **new** `DIRECT_URL` only. Confirm `app.schools` exists.
6. Auth: Site URL `https://www.fillthemat.com`. Redirects: `/auth/callback`, preview `https://<new-vercel>/**` if you use previews, plus local callbacks if this project is also used from the laptop (prefer not to — local Docker stays local).
7. Enable Google; paste the new GCP client id/secret from D. Add the new callback URI on the GCP client.
8. **Data:** founder-alpha hosted data is not sacred. Prefer **recreate the school in the new dashboard** (onboarding → Studio `approved_at` → publish). Dump/restore only if you have real bookings you cannot lose. Auth user ids will not match a naive SQL copy; if you restore `app.*` without `auth.users`, FKs break.
9. Optional now: second Supabase project for Vercel Preview (known gap). Same org, extra ~$10/mo on Pro.
10. After cutover: enable backups/PITR on Pro before inviting gyms.

### H. Vercel

The current team is Hobby, personal, `planIteration: legacy`. You want a **new team** billed to the company.

1. Log into Vercel with `admin@fillthemat.com` (or GitHub org SSO once C is done).
2. Create team `fillthemat` (or `fillthemat-prod`). Put the **company card** on immediately. For a public commercial LP, use **Pro** ($20/mo) — Hobby is personal/non-commercial.
3. `bunx vercel login` as that user, then from the repo:

   ```bash
   bunx vercel link --yes --scope <new-team-slug> --project fillthemat
   ```

   This rewrites local `.vercel/project.json` (gitignored). Old team link is gone from this checkout.
4. Git: connect the **org** repo. Confirm `gh-pages` is not deployed (`vercel.ts` already disables it; set the same Ignored Build Step on the new project).
5. Env: set every key from `.env.example` for Production (and Preview if used). **New values** from G/F/E. Do not copy personal `DATABASE_URL` / Resend / Turnstile / WhatsApp tokens.

   ```
   DATABASE_URL=
   DIRECT_URL=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
   NEXT_PUBLIC_SITE_URL=https://www.fillthemat.com
   RESEND_API_KEY=
   RESEND_FROM=
   RESEND_WEBHOOK_SECRET=
   CRON_SECRET=          # generate a new long random string; do not reuse personal
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=
   TURNSTILE_SECRET_KEY=
   BOOKING_AGENT_MODEL=google/gemini-2.5-flash
   WHATSAPP_*            # omit until K
   ```

6. AI Gateway: enable on the new team. Set a **project budget** (start $50–100/mo, not $25 if a gym will run ads). Do not buy credits until Flash needs paid tier; buying credits ends free-tier credits.
7. Crons: first production deploy of `vercel.ts` should register `/api/cron/maintenance` and `/api/cron/whatsapp`. Confirm in the new project.
8. **Domain move** (brief DNS-safe, but Vercel-exclusive):
   - On the **old** team: remove `fillthemat.com` / `www` assignment (or you cannot add it elsewhere).
   - On the **new** team: add `fillthemat.com` + `www`, verify. Porkbun records that already point at Vercel should re-verify. If they used Vercel-specific nameservers they don’t — they use Porkbun NS, so you may need the ALIAS/CNAME/A records Vercel displays. **Compare before deleting the old assignment.**
9. Deploy: `bunx vercel --prod` from `main` (or push to the org repo).
10. Set Gateway tags still work via OIDC (`VERCEL_OIDC_TOKEN` is automatic). Confirm `BOOKING_AGENT_MODEL` is allowed on this team’s free/paid Gateway tier.

### I. Wire callbacks that embed hostnames

Same public origin (`www.fillthemat.com`) if DNS did not change. Still re-check:

| Place | Must match new stack |
| --- | --- |
| Supabase Auth Site URL + redirects | new project + `https://www.fillthemat.com/auth/callback` |
| GCP OAuth JS origins + redirects | new Supabase callback |
| Turnstile hostname | `www.fillthemat.com` |
| Resend webhook | `https://www.fillthemat.com/api/webhooks/resend` |
| Meta webhook (K) | `https://www.fillthemat.com/api/webhooks/whatsapp` |
| `NEXT_PUBLIC_SITE_URL` | `https://www.fillthemat.com` (no trailing slash) |

### J. Smoke (same bar as `docs/v1-deploy-current.md` §6)

1. `https://www.fillthemat.com` — Continue with Google as a **non-admin** Gmail if you can, or a test Workspace user. Land on onboarding/dashboard.
2. Create/configure school. Studio: set `app.schools.approved_at`. Publish. Open `/s/<slug>` signed out.
3. Qualified session, chat reply (Gateway), one booking.
4. Prospect **and** owner receive mail from the verified From (not `onboarding@resend.dev`). Webhook moves `email_deliveries` to delivered.
5. `curl -H "Authorization: Bearer $CRON_SECRET" https://www.fillthemat.com/api/cron/maintenance`
6. Signed-out `/dashboard` → sign-in. Unknown slug 404.
7. Confirm invoices would go to `admin@` / company card (even at $0).

### K. Meta / WhatsApp

> **Decision (2026-09):** WhatsApp remains on personal Meta account. The `admin@fillthemat.com` Meta Business account was permanently banned during initial setup (rapid account/app/business creation flagged as suspicious behavior). Appeal not possible. Production `WHATSAPP_*` tokens are from the personal Meta app and will stay that way unless a new company Meta identity can be established later.

<details>
<summary>Original plan (blocked by ban)</summary>

Tokens on the **old** Vercel are personal-Meta. For a clean company:

1. Meta Business portfolio owned by `admin@fillthemat.com` (or the company). Complete verification against the company, not a personal FB profile if you can avoid it.
2. New app, WABA, system user, templates — follow `docs/whatsapp-phase6-kickoff.md` from scratch on that portfolio. Do not reuse the personal system-user token.
3. Set `WHATSAPP_*` only on the **new** Vercel. New `WHATSAPP_VERIFY_TOKEN`. Update Meta webhook URL + verify token.
4. Rewrite `schools.whatsapp_phone_number_id` / `whatsapp_waba_id` on the **new** DB.
5. If Phase 6 is not happening yet: leave `WHATSAPP_*` unset on the new project. Production fails closed; that is correct.

</details>

### L. Billing pass

On each new account, confirm:

- Login email is `admin@fillthemat.com` (or GitHub org).
- Billing email is `admin@fillthemat.com`.
- Payment method is the **company** bank/card.
- Personal card removed.
- Ontario HST will apply on US SaaS — expected.

Suggested paid SKUs at first public gym (not part of identity, but do it while you are in the dashboards):

- Vercel Pro
- Supabase Pro (+ PITR)
- AI Gateway budget $50–100/mo
- Resend Free until you hit 100/day

### M. Decommission personal (wait ≥7 days)

Only after smoke and a quiet week:

| Vendor | Action |
| --- | --- |
| Old Vercel project | Remove env, unlink git, delete project. Keep the personal **team** if `cosmikmuffin.com` still lives there. |
| Old Vercel Gateway budget | Remove so a stray key cannot spend. |
| Old Supabase project | Pause or delete after a final dump sitting in the company vault (even if empty). |
| Old Resend | Revoke API keys; delete webhook. |
| Old Turnstile | Delete widget. |
| Old GCP OAuth client | Delete. |
| Personal GitHub | Repo is gone if transferred; remove leftover deploy keys / Actions secrets. |
| Personal Meta tokens | Revoke system user token. |

### N. Docs in this repo (after the new names exist)

Update so the next operator is not pointed at the personal team:

- `docs/v1-deploy-current.md` — team slug, `RESEND_FROM`, skip list (verified domain).
- `docs/README.md` — this file stays in Living.
- `docs/decisions/vercel-gh-pages-deployments.md` — Pages URL if the org changed it.
- GitHub repo homepage / description if still `fillthemat.vercel.app`.

Do **not** commit `.vercel/`, `.env.production.local`, or keys.

---

## 5. Local laptop after cutover

- `.env.local` can keep personal/test Resend and Turnstile test keys. That is not production.
- `bunx vercel env pull` from the **new** scope if you want real prod OIDC for local Gateway. Do not mix old/new files.
- `bun run db:migrate:prod` only with the new `DIRECT_URL` in `.env.production.local`.
- `vercel whoami` should show the company team before any `vercel --prod`.

---

## 6. What this cutover does *not* include

- Tenant custom domains
- Isolated preview Supabase (do it as a follow-up in the new org)
- Payments / Stripe (no V1 billing yet — when you add it, create Stripe on `admin@` + company bank from day one)
- Moving OpenCode Zen
- Moving `cosmikmuffin.com`

---

## 7. Checklist

Copy into a note and tick.

**Prep**

- [ ] Company password manager + 2FA + Workspace break-glass admin
- [ ] Company card / bank login works

**Identity / DNS**

- [ ] Porkbun owned or billed under `admin@`
- [x] SPF plan for Google + Resend (do not break MX)

**Git**

- [x] GitHub org + `admin@` owner
- [x] Repo transferred
- [x] Pages still builds

**IdP / bot / mail (can do before Vercel)**

- [x] GCP project + OAuth consent + web clients
- [x] Turnstile production widget
- [x] Resend account + verified domain + webhook + test email

**Data / app**

- [x] Supabase org + project (Pro if public)
- [x] Migrations applied
- [x] Google provider wired to new GCP client
- [x] School recreated or data restored on purpose

**Vercel**

- [x] New team + company card (+ Pro if commercial)
- [x] Project linked, git connected, `gh-pages` ignored
- [x] All env vars set (new secrets)
- [x] Gateway budget
- [x] Domain moved; `www.fillthemat.com` serves the new project
- [x] Crons present
- [x] Prod deploy

**Prove**

- [x] Google login
- [x] Publish + public `/s/<slug>`
- [x] Chat (Gateway)
- [ ] Booking + real email to a non-owner inbox
- [ ] Resend webhook state
- [ ] Cron auth

**Optional**

- [x] WhatsApp on company Meta, or explicitly skip — **staying on personal Meta (company account banned)**
- [ ] Preview Supabase
- [ ] PITR

**Clean up**

- [ ] Personal cards removed from every vendor you migrated
- [ ] Old Vercel/Supabase/Resend/Turnstile/GCP/Meta revoked
- [ ] Deploy docs updated to the new team slug
