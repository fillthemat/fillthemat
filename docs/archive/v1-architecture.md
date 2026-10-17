> Archived. Not current instructions. See docs/README.md.

# Fillthemat V1 architecture

## Product contract

Fillthemat V1 is a multi-tenant landing-page and trial-booking product for martial-arts schools. A school owner signs in with Google, configures one school, creates age/program-specific trial offerings and recurring windows, previews the result, and explicitly publishes a branded landing page. A prospect can either talk to an AI concierge or use a persistent **Book Trial** action. Both paths end at the same deterministic confirmation form and atomic booking command.

V1 stops after the pre-class lifecycle: booking, confirmation, one reminder for eligible bookings, owner cancellation, and Showed / No-show. Post-trial conversion sequences, payments, SMS, Google Calendar OAuth, tenant custom domains, waiver e-signing, RAG, staff roles, and ad management are not part of V1.

### Milestones

1. **Founder alpha:** local Supabase, disposable data, `onboarding@resend.dev`, daily manual operational checks, and no external school or prospect traffic. This proves mechanics only.
2. **Approved pilot:** 3–5 manually approved schools, real prospects, isolated hosted Supabase environments, verified email domain, durable email delivery, abuse controls, migrations, recovery, and production monitoring.

### Pilot product evidence

V1 measures absolute landing-page conversion; it does not claim that AI outperforms a conventional landing page.

- At least 200 qualified landing sessions in aggregate.
- At least 40 qualified sessions per pilot school.
- At least 10% of qualified sessions produce one or more confirmed participant bookings.
- A session counts once even when a parent books multiple children.
- Direct and chat-assisted paths are reported separately.
- Track no matching offering, no open slot, lead captured, confirmation failure, reminder delivery, Showed, and No-show as secondary outcomes.

A qualified session is a first-party browser session recorded after the public page is visibly hydrated, deduplicated for 30 minutes, with UTM parameters snapshotted at entry. Known bots, owner previews, and synthetic checks are excluded.

## 1. Application and platform foundation

Use one Next.js 16 App Router application. Do not create a monorepo, next-forge workspace, Eve app, Workflow DevKit workflow, or separate API service.

### Scaffold

`create-next-app` refuses the non-empty repository because of `README.md`. Move that file aside, scaffold, then restore the project README. Do not delete `LICENSE`, `.gitignore`, or `docs/`.

```bash
mv README.md ../fillthemat.README.md
bunx create-next-app@latest . \
  --typescript \
  --tailwind \
  --biome \
  --app \
  --src-dir \
  --turbopack \
  --import-alias "@/*" \
  --use-bun \
  --yes
mv ../fillthemat.README.md README.md
```

Use Bun for package installation, scripts, local execution, builds, and all non-Edge Vercel Functions. Commit `bun.lock`; do not create `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`.

`package.json`:

```json
{
  "scripts": {
    "dev": "bun run --bun next dev",
    "build": "bun run --bun next build",
    "check": "biome check .",
    "check:write": "biome check --write .",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "db:generate": "bunx drizzle-kit generate",
    "db:migrate": "bunx drizzle-kit migrate",
    "db:studio": "bunx drizzle-kit studio",
    "supabase:start": "bunx supabase start",
    "supabase:stop": "bunx supabase stop"
  }
}
```

Pin the exact local Bun version in `packageManager`. Vercel runs the managed Bun 1.4 line.

### Dependencies

```bash
bun add \
  ai @ai-sdk/react \
  @supabase/supabase-js @supabase/ssr \
  drizzle-orm postgres \
  resend \
  date-fns date-fns-tz \
  zod \
  geist \
  @marsidev/react-turnstile

bun add -d \
  @biomejs/biome \
  @playwright/test \
  @vercel/config \
  drizzle-kit \
  supabase \
  vitest
```

Do not install direct OpenAI/Anthropic SDKs, Prisma, an ICS package, `dotenv-cli`, ESLint, or Prettier.

### Biome and Geist

The scaffolded `biome.json` is the only lint/format configuration. Enable Biome's React and Next.js domains. There is no ESLint compatibility layer.

In the root layout:

```tsx
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
```

Put `GeistSans.variable` and `GeistMono.variable` on `<html>`. Use the Geist CSS variables in `globals.css`; do not load Geist through `next/font`.

### Vercel

Link the project after the local application builds:

```bash
bunx vercel whoami
bunx vercel link --yes --scope <team> --project fillthemat
```

Enable AI Gateway for the project and pull the environment. OIDC must provide `VERCEL_OIDC_TOKEN`; do not add provider API keys. Provision Resend directly or through the Vercel Marketplace, but Resend is the only supported application email provider.

`vercel.ts` is the sole Vercel configuration file:

```ts
import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  bunVersion: "1.4.x",
  buildCommand: "bun run build",
  framework: "nextjs",
  crons: [{ path: "/api/cron/maintenance", schedule: "0 14 * * *" }],
};
```

The Bun runtime is a Vercel Public Beta dependency. Before pilot traffic, run the complete production-like smoke against a preview deployment. On the pilot's Pro plan, change only the maintenance schedule to `*/5 * * * *`; the database worker remains idempotent, so missed or overlapping invocations are recoverable.

### Environment names

Commit names with empty values in `.env.example`; never commit values or `.env.local`.

```dotenv
DATABASE_URL=
DIRECT_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=
RESEND_API_KEY=
RESEND_FROM=
RESEND_WEBHOOK_SECRET=
CRON_SECRET=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
BOOKING_AGENT_MODEL=
```

Local Supabase Google OAuth additionally reads these from an uncommitted Supabase environment file:

```dotenv
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET=
```

Use `NEXT_PUBLIC_SITE_URL` for the stable production hostname. In preview, derive the request origin from trusted Vercel forwarding headers rather than embedding the production URL. Generate `CRON_SECRET` with Bun:

```bash
bun -e 'console.log(crypto.randomUUID() + crypto.randomUUID())'
```

Founder alpha uses `RESEND_FROM=onboarding@resend.dev`, which may send only to the Resend account owner's inbox. Before pilot traffic, verify a Fillthemat sending subdomain and change production `RESEND_FROM`.

## 2. Supabase PostgreSQL and Drizzle

Supabase hosts PostgreSQL and Supabase Auth. Drizzle is the sole application-schema migration and query convention.

### Environment topology

- **Local:** `bunx supabase start`; PostgreSQL and Auth run in Docker-compatible containers.
- **Preview:** isolated hosted Supabase project or preview branch; never production data.
- **Production:** dedicated hosted Supabase project with backups/PITR configured before pilot.

Install the Supabase CLI as the pinned project dependency above. Commit `supabase/config.toml`. The Supabase CLI owns local platform services and Supabase's internal schemas; it does not own Fillthemat application migrations.

### Connections

- `DATABASE_URL`: Supavisor transaction-mode connection for application traffic.
- `DIRECT_URL`: direct or session-mode connection for Drizzle migrations and administrative tools.
- Local development may use the local direct URL for both.

`src/db/index.ts` uses a lazy `postgres` client plus `drizzle-orm/postgres-js`, so importing a module during build does not open a connection:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false, max: 1 });
  return drizzle(client, { schema });
}

let cached: ReturnType<typeof createDb> | undefined;

export function getDb() {
  return (cached ??= createDb());
}
```

`prepare: false` is required by Supavisor transaction mode. `max: 1` bounds per-function connection pressure while Supavisor multiplexes application traffic. Do not connect through the Supabase Data API for application data.

`drizzle.config.ts` points at `src/db/schema.ts`, uses the PostgreSQL dialect, writes migrations to `drizzle/`, and uses `DIRECT_URL ?? DATABASE_URL` for migration commands. The first migration creates `app`:

```sql
CREATE SCHEMA IF NOT EXISTS app;
```

All Fillthemat tables live in that schema via `pgSchema("app")`. Do not expose `app` in Supabase's Data API settings; revoke `anon` and `authenticated` privileges on it. Browser code uses Supabase only for Auth. Server Components, Server Actions, and Route Handlers query `app.*` through Drizzle.

### Schema rules

- UUID primary keys.
- `timestamptz` for instants.
- IANA timezone strings for local display and recurrence generation.
- `school_id` on every tenant-owned row.
- Foreign keys and composite tenant constraints prevent a row from linking entities from different schools.
- Application queries always include the authenticated/publicly resolved school; PostgreSQL RLS is not used for `app.*`.
- Database constraints defend invariants; validation is not UI-only.

### Application tables

**`users`**

- `id` uuid primary key; equals the verified Supabase Auth user id.
- `email` text not null.
- `name` text nullable.
- `created_at`, `updated_at` timestamptz.
- Initial custom migration references `auth.users(id) ON DELETE CASCADE`.

**`schools`**

- `id`, `owner_user_id` (unique), `slug` (unique), `name`, `timezone`.
- `approved_at`, `published_at` nullable.
- Notification email, phone, website, address, country, parking/access notes.
- Trial guidance, pricing, welcome message, bounded owner agent instructions.
- Validated HTTPS `logo_url`; validated six-digit hex `primary_color`.
- `created_at`, `updated_at`.
- Once `published_at` is set, `slug` and `timezone` are immutable in V1.

**`faqs`**

- `id`, `school_id`, `question`, `answer`, `sort_order`, timestamps.
- At most 20 per school; enforce field-length limits.

**`trial_offerings`**

- `id`, `school_id`, `name`, `description`.
- `minimum_age`, `maximum_age` nullable with a valid inclusive range.
- Offering-specific expectations/attire/waiver notes when they differ from the school defaults.
- `active`, timestamps.

**`trial_windows`**

- `id`, `school_id`, `trial_offering_id`.
- `day_of_week` (0–6), `start_minute` (0–1439), `duration_minutes`, `capacity`, `label`, `active`.
- Check constraints: positive duration, capacity 1–50, valid day/minute.
- A structural change after a future booking requires deactivating the row and creating a replacement. Do not rewrite booked windows.

**`trial_occurrences`**

- `id`, `school_id`, `trial_window_id`, `trial_offering_id`.
- `start_at`, `end_at`, `capacity`, `booked_count`.
- Unique `(trial_window_id, start_at)`.
- Check `0 <= booked_count <= capacity`.
- Created lazily by the first successful booking.

**`contacts`**

- Adult/contact identity: `id`, `school_id`, normalized `email`, `name`, `phone`, timestamps.
- Unique `(school_id, email)`.

**`participants`**

- Person occupying a spot: `id`, `school_id`, `contact_id`, `name`, normalized name, timestamps.
- Unique `(contact_id, normalized_name)` for V1 identity/retry handling.
- Do not store birthdate; a booking snapshots age in years.

**`landing_sessions`**

- `id`, `school_id`, hashed first-party session key.
- First/last seen and `qualified_at`.
- UTM source, medium, campaign, content, and term.
- `is_preview` and bot-exclusion reason where applicable.
- Unique `(school_id, session_key_hash)`.

**`conversations`**

- `id`, `school_id`, optional `landing_session_id`, optional `contact_id`.
- Hashed 256-bit resume token, `expires_at`, timestamps.
- Resume token is stored raw only in browser `localStorage`, keyed by school slug; only its hash is stored in PostgreSQL.

**`messages`**

- `id`, `conversation_id`, stable client/server message id, role, AI SDK `UIMessage.parts` JSONB, completion state, timestamps, `purge_at`.
- Unique `(conversation_id, message_id)`.
- Raw message data expires after 30 days. Booking/contact records do not depend on transcript retention.

**`leads`**

- `id`, `school_id`, `landing_session_id`, `contact_id`, optional participant/offering, stated need, status, timestamps.
- Created only from an explicit no-match lead form; it does not consume capacity or count as conversion.

**`bookings`**

- `id`, `school_id`, `contact_id`, `participant_id`, `trial_offering_id`, `trial_window_id`, `trial_occurrence_id`.
- Optional `conversation_id` and `landing_session_id`.
- Unique server-issued `idempotency_key` within the school.
- `status`: `booked | showed | no_show | cancelled`.
- Snapshot participant name/age, offering name, timezone, start/end, location, and instructions needed by later email.
- Stable `ics_uid`, `ics_sequence`, `cancelled_at`, timestamps.
- Partial unique index on `(trial_occurrence_id, participant_id)` where status is not `cancelled`.

**`email_deliveries`**

- `id`, `school_id`, optional `booking_id` or `lead_id`.
- Kind: prospect confirmation, reminder, cancellation, owner booking, owner cancellation, owner lead.
- Recipient, unique provider idempotency key, state, attempts, provider id, last error, `next_attempt_at`, `sent_at`, timestamps.
- No raw email body is required after successful delivery.

**`funnel_events`**

- `id`, `school_id`, `landing_session_id`, optional conversation/booking/lead ids.
- Event type, privacy-safe metadata JSONB, timestamp.
- No raw message text, email, phone, or participant name.

**`cron_runs`**

- Maintenance run id, start/end, counts, result, and error summary for heartbeat monitoring.

### Migration policy

Founder alpha may use `drizzle-kit push` only against disposable local data. Before any hosted pilot data, generate and commit a baseline migration and use `drizzle-kit migrate`. Never run migrations during application startup. Apply hosted migrations with `DIRECT_URL`, test them against preview first, and complete one Supabase backup restore exercise before pilot launch.

## 3. Supabase Auth with Google OAuth

Use `@supabase/supabase-js` and `@supabase/ssr`. Google OAuth is the only owner sign-in method in V1; owners without a Google account are unsupported.

### Provider configuration

Create one Google Cloud project and separate Web OAuth client credentials for local, preview, and production. Request only `openid`, email, and profile scopes.

- Local Google callback: `http://127.0.0.1:54321/auth/v1/callback`.
- Hosted callbacks: each Supabase project's Google provider callback URL.
- Add exact local and production origins.
- Add the scoped Vercel preview pattern to the Supabase redirect allowlist; production uses an exact redirect.
- Configure local Google credentials through `supabase/config.toml` using `env(...)`, never literals.

### Next.js integration

Create:

- `src/lib/supabase/browser.ts` using `createBrowserClient`.
- `src/lib/supabase/server.ts` using `createServerClient` and request cookies.
- `src/proxy.ts` to refresh the Supabase Auth cookie, propagate all returned cache headers/cookies, and declare the `nodejs` middleware runtime so Vercel executes it on the configured Bun runtime.
- `src/app/sign-in/page.tsx` with a shadcn **Continue with Google** button.
- `src/app/auth/callback/route.ts` to validate a relative `next`, exchange the PKCE code, and redirect.
- `src/app/auth/error/page.tsx`.

Authorization rules:

- Use `supabase.auth.getClaims()` for server authorization.
- Never trust `getSession()` as proof of identity.
- Dashboard/onboarding layouts independently require verified claims.
- `ensureUser()` upserts `app.users` with the Supabase subject UUID, email, and display name.
- `getOwnedSchool()` loads the one school whose `owner_user_id` equals that application user.
- Every Server Action repeats authorization and includes `school_id` in its mutation predicate.
- Public landing/chat/booking/lead routes do not require Supabase Auth.

Manual pilot approval is application state (`schools.approved_at`), not an Auth role. A school cannot publish or send application email until approved. Founder alpha approval may be applied directly in local Supabase Studio; add an internal approval surface only when another operator needs it.

## 4. Owner application and publishing

Install shadcn after the scaffold is healthy:

```bash
bunx --bun shadcn@latest init -d --base radix
bunx --bun shadcn@latest add \
  button card input label textarea select switch tabs \
  dialog alert-dialog sheet dropdown-menu badge separator skeleton table
bunx --bun shadcn@latest add https://elements.ai-sdk.dev/api/registry/all.json
```

Set `dark` on `<html>` so portalled owner components inherit dark tokens. The public `/s/[slug]` layout applies a scoped light theme. Use validated CSS custom properties for the school's accent color.

### Routes

**`/`**

- Signed-out: concise product explanation and Continue with Google.
- Signed-in without a school: redirect to `/onboarding`.
- Signed-in with a school: redirect to `/dashboard`.

**`/onboarding`**

- School name, slug, timezone, city, notification email.
- Slug is lowercase `[a-z0-9]` groups joined by hyphens, length 3–48.
- Timezone uses `Intl.supportedValuesOf("timeZone")` with a static US fallback.
- Create an unpublished, unapproved school and redirect to settings.

**`/dashboard`**

- Publication/readiness state and preview action.
- Qualified sessions, confirmed converted sessions, conversion rate, direct/chat split, leads, upcoming bookings, active offerings/windows.
- Email delivery failures and last successful maintenance run.
- Public URL uses the current trusted site origin plus the immutable published slug.

**`/dashboard/settings`**

- Profile: name, pre-publish slug/timezone, phone, website, address, country, parking/access.
- Offerings: name, description, age range, trial guidance, active.
- Schedule: offering, weekday, local time, duration, capacity, label, active.
- Pricing, FAQs, Agent, Branding.
- Empty optional text persists as null.
- Every input is length/range/protocol validated server-side.

When a window has a future booking, offering/weekday/start/duration are frozen; deactivate and create a new window. Capacity updates propagate to future occurrences only when the new capacity is at least `booked_count`. Deleting a window is allowed only when no occurrence exists; otherwise deactivate it.

**Publish action**

Requires:

- `approved_at` set.
- Complete name, slug, timezone, location/contact facts.
- At least one active offering and one active window.
- Owner preview completed.

Publishing sets `published_at`; slug and timezone then become immutable. Public `/s/[slug]` returns 404 unless the school is both approved and published.

**`/dashboard/bookings`**

- Upcoming/Past/All filters.
- Contact and participant, age at booking, offering, local time, status, email delivery state.
- `booked -> showed | no_show | cancelled`; allow correcting showed/no-show.
- Cancellation is allowed only for a future `booked` booking and requires confirmation.

**`/dashboard/leads`**

- No-match leads with contact, participant need, source, and created time.

Owner notifications are separate Resend messages, not CCs.

## 5. Public landing page, funnel, and forms

`/s/[slug]` is mobile-first. It renders the school logo using a validated HTTPS `<img>`, school name, offering context, the AI concierge, and a persistent **Book Trial** action. Do not configure a wildcard Next image optimizer host and do not add Blob storage.

On visible hydration, create or refresh a random 30-minute landing-session token in browser storage and call `POST /api/sessions`. The server hashes the token, validates the school, snapshots UTM values, rejects known bots/previews, and creates the qualified-session event exactly once.

### Direct booking flow

1. Select an eligible offering.
2. Enter participant name and age in years.
3. Select an open slot.
4. Enter/edit adult contact name, normalized email, and phone.
5. Show one final card with school, offering, participant, local date/time, location, and contact details.
6. Obtain Turnstile verification and submit once to `POST /api/bookings` with a server-issued idempotency key.

The chat path opens the same editable form with its selected offering/slot prefilled. AI-extracted contact text is never silently committed.

### No-match flow

If no offering is eligible or no open slot works, offer an explicit lead form. With consent and Turnstile verification, `POST /api/leads` creates a lead and durable owner-notification delivery. It does not consume capacity or count as a booking conversion.

## 6. Recurrence and atomic booking

Use `date-fns` and `date-fns-tz`; store UTC instants and render with the school's snapshotted IANA timezone.

```ts
export const SLOT_HORIZON_DAYS = 14;
export const MIN_LEAD_MINUTES = 120;
```

`listOpenSlots({ school, offering, windows, occurrences, now })` is pure and receives `now` explicitly. It:

- Uses active windows for one active offering.
- Generates matching local calendar dates through the horizon.
- Converts local time to UTC.
- Skips nonexistent DST local times and uses the earlier offset for a repeated fall-back local time.
- Uses occurrence capacity when materialized, otherwise window capacity.
- Omits full slots and returns exact UTC plus formatted local display data.

`slotId` is opaque to the client but contains only a window id and UTC start. It is not an authorization token. The booking handler parses it, reloads the window by `school_id`, regenerates the open set, and rejects a slot not currently open.

### `POST /api/bookings`

Validate before the database transaction:

- Published and approved school.
- Request/body limits and Vercel WAF policy.
- Turnstile token.
- Per-school/IP/recipient quota.
- Contact and participant schema.
- Offering age eligibility.
- Idempotency key and slot shape.

Then use one Drizzle/PostgreSQL transaction:

1. Return the existing booking when `(school_id, idempotency_key)` already exists.
2. Upsert the normalized contact.
3. Upsert the participant by contact and normalized name.
4. Lock/load or create the occurrence from the current window snapshot.
5. Revalidate lead time, active state, eligibility, and capacity inside the transaction.
6. Increment `booked_count` only when below capacity.
7. Insert the booking. The active-booking partial unique index prevents a concurrent duplicate for the same participant/occurrence; any conflict rolls back the increment.
8. Link the conversation/contact where present.
9. Insert prospect confirmation and owner booking rows into `email_deliveries` with deterministic keys.
10. Insert funnel events in the same transaction.

Commit before calling Resend. After commit, attempt the pending deliveries immediately; failures remain pending for maintenance. A retry returns the same booking rather than `already_booked`. For non-idempotent probes, use a generic acknowledgement rather than disclosing whether a third party's email has a booking.

### Cancellation

One transaction conditionally changes a future booking from `booked` to `cancelled`, increments `ics_sequence`, decrements its occurrence exactly once, and inserts prospect/owner cancellation deliveries. A repeat returns the existing cancelled state without another decrement or delivery.

Attendance corrections do not change occupancy or send email.

## 7. Email and calendar delivery

Use the `resend` SDK lazily. Email bodies are plain text in V1; this avoids unsafe tenant-authored HTML. Never include raw transcript content.

Provider idempotency keys:

- `booking-confirmation/{bookingId}`
- `booking-reminder/{bookingId}`
- `booking-cancellation/{bookingId}/{icsSequence}`
- `owner-booking/{bookingId}`
- `owner-cancellation/{bookingId}/{icsSequence}`
- `owner-lead/{leadId}`

The application database remains the durable source of truth beyond Resend's idempotency retention window.

`buildTrialIcs` is hand-written and vector-tested. It uses CRLF, folds lines at RFC limits, escapes backslash/comma/semicolon/newlines, emits UTC `DTSTART`/`DTEND`/`DTSTAMP`, and uses the stable booking UID. Confirmation/reminder use `METHOD:PUBLISH`. Cancellation reuses UID, increments `SEQUENCE`, adds `STATUS:CANCELLED`, and uses `METHOD:CANCEL`.

Confirmation and reminder include snapshotted offering, local time, location, parking/access, attire, arrive-early guidance, and school contact. Confirmation explains how to contact the school to cancel or reschedule. Reminder subject uses the formatted class date, not the word “tomorrow”.

The maintenance worker claims pending deliveries conditionally, sends with the deterministic key, and records provider id/error/state. Failed attempts receive bounded exponential retry timestamps. Overlapping cron invocations cannot claim the same row concurrently. The Resend webhook route verifies the provider signature with `RESEND_WEBHOOK_SECRET` against a bounded raw request body before updating delivered/bounced/complained state; webhook events never change the booking itself.

A booking created less than 36 hours before its class receives confirmation but no reminder. For older bookings, maintenance creates exactly one reminder delivery when the class enters the reminder window.

No SMS or Google Calendar API is used.

## 8. AI concierge

Install and implement against the pinned AI SDK v7 package's bundled docs/source. Use `ToolLoopAgent`, `createAgentUIStreamResponse`, `isStepCount`, `UIMessage.parts`, `DefaultChatTransport`, and the current Gateway provider interface. Do not copy v6 examples.

```ts
export const BOOKING_AGENT_MODEL = process.env.BOOKING_AGENT_MODEL || "anthropic/claude-sonnet-4.6";
```

Wrap the model with the Gateway provider so calls carry `tags: ["feature:booking-chat"]` and `user: school.id`. GPT-5.4 is the manually configured fallback, not an automatic hidden switch. Require Gateway/provider Zero Data Retention for pilot traffic.

### Trust boundary

The LLM may answer, qualify, list, and prepare. It may not create a booking or lead.

Read-only/pure tools:

- `list_trial_offerings({ participantAge? })`
- `list_trial_slots({ offeringId })`
- `prepare_booking({ offeringId, slotId })` — revalidates and returns data used to open the deterministic form; it performs no write.

The platform instruction block is immutable and higher priority than school content. School fields, FAQs, and owner instructions are bounded and delimited as untrusted tenant data. Owner instructions may control tone and approved qualification behavior but cannot override honesty, privacy, eligibility, slot, payment, waiver, or mutation rules.

### Conversation identity and persistence

The browser keeps a random 256-bit resume token in `localStorage`, keyed by school slug. The database stores only its hash. The first request creates a school-bound conversation; later requests must match it. The token expires with the 30-day transcript policy.

Configure `DefaultChatTransport.prepareSendMessagesRequest` to send the resume token and exactly one new user message. The server does not trust a client-supplied assistant/tool history. It:

1. Loads canonical messages for the school-bound conversation.
2. Rejects duplicate message ids and concurrent active generations.
3. Validates stored history plus the new user message against the agent tools.
4. Persists the user message before generation.
5. Streams with `createAgentUIStreamResponse`.
6. Persists complete server-generated assistant/tool parts in `onEnd` and records abort/error separately.
7. Uses stream consumption so disconnects still finalize persistence callbacks.

Refresh reloads canonical history for the bearer token. There is no cross-device retrieval, public transcript-sharing endpoint, or owner transcript UI.

Hard limits:

- Request-body byte limit.
- User-message character limit.
- Maximum 30 messages per conversation.
- One active generation per conversation.
- Maximum output tokens and bounded step count.
- Per-school daily request/token ceiling plus project Gateway spend ceiling.
- Successful booking counts come from the database, not conversation text.

Store privacy-safe request metadata: model, latency/TTFT, usage/cost, step count, finish/abort/error, tool name/result code, and booking/lead outcome. Do not capture prompts, output text, contact data, or tool PII in telemetry.

## 9. Maintenance, abuse, and observability

`GET /api/cron/maintenance` requires a non-empty `CRON_SECRET` and an exact Bearer match; `Bearer undefined` must never authenticate.

Each run:

1. Creates a `cron_runs` heartbeat.
2. Creates due reminder deliveries with unique keys.
3. Claims and sends due email deliveries.
4. Purges expired message parts/conversations while retaining aggregate funnel events.
5. Records sent/failed/purged counts and completion.

Founder alpha checks the run daily. Pilot alerts when no successful maintenance run occurs inside the expected interval or when delivery failures/bounces/complaints are nonzero.

Vercel WAF protects `/api/chat`, `/api/bookings`, `/api/leads`, and `/api/sessions`. Turnstile is required for booking and lead confirmation. Application quotas limit successful reservations and outbound recipients independently of resettable conversation ids. Only manually approved schools may publish or send from the platform domain.

Use Vercel runtime logs, Gateway observability, Supabase database observability, durable delivery state, and structured funnel events. Do not add an APM vendor for V1, and never log raw PII or chat text.

## 10. File map

```text
src/proxy.ts
src/db/index.ts
src/db/schema.ts
src/db/migrate.ts
src/lib/supabase/browser.ts
src/lib/supabase/server.ts
src/lib/auth/current-user.ts
src/lib/auth/current-school.ts
src/lib/site-url.ts
src/lib/slug.ts
src/lib/schedule/constants.ts
src/lib/schedule/occurrences.ts
src/lib/schedule/book-slot.ts
src/lib/email/ics.ts
src/lib/email/resend.ts
src/lib/email/deliveries.ts
src/lib/ai/system-prompt.ts
src/lib/ai/booking-agent.ts
src/lib/security/turnstile.ts
src/lib/security/limits.ts
src/app/sign-in/page.tsx
src/app/auth/callback/route.ts
src/app/auth/error/page.tsx
src/app/onboarding/page.tsx
src/app/dashboard/page.tsx
src/app/dashboard/settings/page.tsx
src/app/dashboard/bookings/page.tsx
src/app/dashboard/leads/page.tsx
src/app/s/[slug]/page.tsx
src/app/api/sessions/route.ts
src/app/api/chat/route.ts
src/app/api/bookings/route.ts
src/app/api/leads/route.ts
src/app/api/webhooks/resend/route.ts
src/app/api/cron/maintenance/route.ts
src/components/booking-chat.tsx
src/components/booking-flow.tsx
src/components/booking-confirmation-form.tsx
drizzle.config.ts
vercel.ts
biome.json
supabase/config.toml
.env.example
```

Server Actions live beside authenticated dashboard pages. Public side effects use explicit Route Handlers so WAF targeting, Turnstile, idempotency, and response contracts remain visible.

## 11. Verification

### Static and unit checks

```bash
bun run check
bun run test
bun run build
```

Vitest covers:

- Recurrence with fixed `now`, at least two timezones, DST gap/fold policy, exact UTC instants, lead-time/horizon bounds, and capacity snapshots.
- ICS escaping, folding, stable UID, sequence, publish, and cancellation output.
- Slug, site URL, validation, prompt boundaries, and privacy-safe event shaping.

### Database integration checks

Run against local Supabase PostgreSQL:

- Two simultaneous identical booking confirmations produce one booking and one occupied spot.
- Replaying an idempotency key returns the original booking.
- The same contact may book two named participants into one occurrence.
- An ineligible participant cannot book an offering.
- Full capacity rejects without drift.
- A simulated transaction error leaves neither booking nor occupancy.
- Double cancellation decrements and enqueues each cancellation delivery once.
- Capacity cannot drop below booked count.
- Structural schedule/timezone/slug mutation guards hold.
- Cross-school ids cannot be linked, read, attended, or cancelled.
- Overlapping maintenance runs do not duplicate email claims.
- The short-lead reminder rule has positive and negative fixtures.

### Browser checks

Playwright covers public publish visibility, direct booking, chat-assisted form preparation, no-match lead capture, confirmation retries, refresh recovery, and generic duplicate behavior. CI uses local Supabase and deterministic test fixtures; it asserts durable email rows rather than contacting Resend.

The founder alpha smoke additionally exercises real integrations:

1. Start local Supabase and apply Drizzle migrations.
2. Sign in through Google OAuth and verify callback/cookie refresh.
3. Create and locally approve one school.
4. Create adult and child offerings plus active windows; preview and publish.
5. Open the public page signed out; verify qualified-session creation and UTM snapshot.
6. Ask a fact question and verify no invented school facts.
7. Book through chat preparation and the editable confirmation form.
8. Verify one booking, one occupancy, prospect confirmation delivery, owner delivery, and valid ICS.
9. Book a sibling through the direct flow into the same occurrence.
10. Trigger a duplicate/retry and verify the existing booking returns without another spot or email.
11. Exhaust capacity and verify the no-match lead path.
12. Cancel once, retry cancellation, verify one reopened spot and one cancellation sequence.
13. Run maintenance twice and verify no duplicate reminder/delivery.
14. Mark Showed then No-show and verify no occupancy/email change.
15. Verify unpublished/unknown slugs 404 and signed-out dashboard access redirects to sign-in.

### Pilot launch gate

Before the first external school:

- Production and preview Supabase projects are isolated and migrated.
- Google OAuth origins, callbacks, consent branding, and redirect allowlists are exact.
- Stable site hostname and verified Resend sending domain are live.
- Bun 1.4 Vercel preview smoke passes AI streaming, OAuth, Supavisor, cron, and webhooks.
- Vercel WAF and Turnstile are enforced.
- Gateway ZDR and spend ceiling are verified.
- Supabase backup/PITR and one restore drill are complete.
- Maintenance heartbeat and email failure/bounce/complaint alerts are observed.
- Transcript notice, 30-day purge, deletion/export procedure, and log redaction are verified.
- A second tenant-isolation smoke passes before inviting the remaining pilot schools.

## Assumptions and non-goals

- One Google-authenticated owner and one school per owner.
- Three to five manually approved pilot schools.
- English and US-default country; IANA timezones.
- Parent/contact and participant are separate; one booking occupies one participant spot.
- A prospect has no account and no cross-device chat recovery.
- Immediate anonymous booking remains possible after Turnstile and quotas; residual determined fake-identity risk is accepted for the approved pilot.
- Public app data is served by Next.js; Supabase Data API, RLS, Realtime, Storage, and Edge Functions are not used for `app.*`.
- Engagement configurability, post-trial conversion/no-show workflows, waitlists, GCal free/busy, SMS, tenant domains, RAG/PDFs, ad management, payments, and waiver e-sign remain unbuilt.
- Future attach points are booking status/events, `email_deliveries`, trial offerings/occurrences, the immutable agent boundary, and the public landing route.
