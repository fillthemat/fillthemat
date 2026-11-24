# Local development

## Prerequisites

- mise (for the project’s Bun version).
- A **Docker Engine** reachable via `docker info` — OrbStack, Docker Desktop, or Colima.

## Quickstart

```bash
bun install
bun setup      # start Supabase, write .env.local, migrate, seed
bun dev        # http://127.0.0.1:3000 (see worktree contract below)
```

If something fails, run `bun run doctor` for a read-only probe of Bun, Docker, Supabase, `.env.local`, and the signing origin.

Stop this checkout's frontend with `bun run dev:stop`.

## Optional integrations

All optional. The app degrades cleanly without them.

| Capability                   | How                                                                                                                                                  | Without it                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real email                   | Set `RESEND_API_KEY` (+ `RESEND_FROM=onboarding@resend.dev` for owner-only test mail) in `.env.local`                                                | Deliveries are recorded and logged instead of sent                                                                                                                                                                  |
| Real assistant model         | `bunx vercel env pull` (provides `VERCEL_OIDC_TOKEN`) or `AI_GATEWAY_API_KEY`, and a free-tier-allowed `BOOKING_AGENT_MODEL`                         | Web chat and WhatsApp run the assistant with a scripted local model: it calls the "list trial offerings" tool, then replies naming the active trial offerings. It never proposes a booking, so book with Book Trial |
| Continue with Google         | Replace the placeholders in `supabase/.env` with a real Web client (callback `http://127.0.0.1:54321/auth/v1/callback`), then re-run `bun run setup` | Email sign-in still works; Google is disabled                                                                                                                                                                       |
| Real WhatsApp sends          | Set `WHATSAPP_SYSTEM_USER_TOKEN` (and optionally `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN`)                                                    | Webhook + worker use dev-stub values; outbound send is a no-op log                                                                                                                                                  |
| Langfuse traces of each turn | Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` (plus `LANGFUSE_BASE_URL` outside the EU region) for a Langfuse project of your own              | Nothing is traced or exported                                                                                                                                                                                       |

`bun run build` / `bun run start` also load `.env.production.local`; if that file holds the production Langfuse keys, a local production server traces to production Langfuse.

## Checks

### WhatsApp Embedded Signup

Set `WHATSAPP_APP_ID`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, `WHATSAPP_APP_SECRET`
and `WHATSAPP_TOKEN_ENCRYPTION_KEY` in `.env.local` (and the deployment environment).
The encryption key must be 32 cryptographically random bytes, base64-encoded
(for example, `openssl rand -base64 32`). Keep it stable and backed up; losing it
makes stored business tokens and registration PINs unreadable. Never prefix these
variables with `NEXT_PUBLIC_`; only the app/config IDs are passed as client props.
Without this configuration the settings Connect button is disabled.

Manual Meta setup: create a **Facebook Login for Business** configuration for
WhatsApp Embedded Signup and copy its `config_id` into
`WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`. Add the deployment's domain to the app's
allowed domains and login configuration. Assign the testing user an app role
while the Meta app is in development mode. Configure the existing WhatsApp
webhook URL, app secret and verify token. Fill the Mat must manually rent the
school's phone number before the owner completes signup/verification. The school
owns its business portfolio and WABA. Connect requires an approved, published
school; no payment-method pre-check is performed.

See [CODING_STANDARDS.md](/CODING_STANDARDS.md#quality-checks).

For the native Supabase declarative schema workflow, see
[supabase/schemas/README.md](../supabase/schemas/README.md).

## Worktrees

Create and remove worktrees using `bun wt`. When working with worktrees in this project, it is true that:

- It has its own supabase stack
- It has its own port to run Next.js

Start the Next server with `bun dev`. Exit by killing that thread, or run `bun dev:stop`.
