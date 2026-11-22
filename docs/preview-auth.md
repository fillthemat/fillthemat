# Sign in to a Vercel preview

For a reusable review login, point **all Preview deployments** at one dedicated staging Supabase project with the app migrations applied. Use its `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel's Preview scope, then redeploy. For reviewers creating their own school through onboarding, also set staging's server-only `SUPABASE_SECRET_KEY`.

Enable the Email provider in staging. From a trusted terminal, set `PREVIEW_SUPABASE_URL`, `PREVIEW_SUPABASE_SECRET_KEY`, and `PREVIEW_OWNER_PASSWORD` (a review-team password, at least 12 characters) and run `bun run seed:preview` once. These provisioning variables are not needed in the Vercel build. The seed creates a confirmed `reviewer@open-mat.example` owner and an unpublished **Open Mat (Preview)** school. Every deployment using that backend sees the same edits. Rerunning with the same credentials keeps the school and its data.

Open `/sign-in` on any preview and use that email and password. No Google redirect or verification email is needed for the seeded account. New owners can use **Create an account**; enable email confirmation and configure SMTP on hosted Supabase for real signups.

## Google and email redirects

- In Google Cloud, the authorized redirect URI is **staging Supabase's** `https://<staging-ref>.supabase.co/auth/v1/callback`. Google returns to Supabase, not to the Vercel branch directly.
- In **Supabase Auth → URL Configuration → Redirect URLs**, allow the app callback on the approved preview hosts. For this Vercel team, `https://fillthemat-*-fillthemat.vercel.app/auth/callback**` covers branch and deployment aliases, including the `next` query. Keep production's allowlist separate. For email confirmation, use the Supabase confirmation link template that respects the requested redirect.
- Enable Google and **manual identity linking** in hosted Supabase Auth for **Dashboard → Account → Link Google account**. Google-first owners can set a password on that same screen. Both methods sign in to the same owner and school.
