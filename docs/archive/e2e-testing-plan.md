> Archived. Not current instructions. See docs/README.md.

# End-to-End Browser Testing Plan

**Project:** fillthemat  
**Date:** 2025-08-29  
**Scope:** Implement comprehensive e2e browser testing for the Next.js application

---

## 1. Executive Summary

The project already has Playwright installed with a minimal smoke test (`e2e/smoke.spec.ts`). This plan describes how to evolve that into a full e2e testing suite that covers the two primary user flows:

1. **Prospect flow** — anonymous users visiting a public school landing page (`/s/:slug`) and interacting with the AI booking chat.
2. **Owner flow** — authenticated users signing in via Google OAuth, onboarding a school, and managing it through the dashboard.

**Recommendation:** A **hybrid approach** — Playwright as the deterministic, fast, zero-cost foundation for known regression flows, with **TesterArmy** as a powerful complement for auth-heavy flows, AI chat widget testing, and PR exploratory testing. Either tool alone can work; the combination covers the most ground for the least cost.

---

## 2. Tool Evaluation

### 2.1. Playwright (current)

| Aspect                | Assessment                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**        | Code-first browser automation framework. You write TypeScript/JavaScript specs that use selectors, assertions, and browser APIs.                        |
| **Speed**             | Very fast — local runs complete in seconds. Millisecond-level control over timeouts.                                                                    |
| **Cost**              | Free / open source. Only infrastructure cost (CI compute).                                                                                              |
| **Determinism**       | Highly deterministic — the same test runs the exact same way every time.                                                                                |
| **Auth support**      | Requires manual workarounds for OAuth (cookie injection, dev-only routes, or intercepting redirects). No native Google OAuth handling.                  |
| **AI chat testing**   | Must mock `/api/chat` with deterministic responses, or the test becomes flaky waiting for an LLM. Cannot naturally interact with a streaming AI widget. |
| **Maintenance**       | Tests break when selectors change. Requires ongoing maintenance as UI evolves.                                                                          |
| **CI integration**    | Excellent. Native GitHub Actions, Vercel preview URL support, trace viewer, screenshots on failure.                                                     |
| **Offline**           | Works fully offline. No SaaS dependency.                                                                                                                |
| **Next.js alignment** | Officially recommended by Next.js 16 App Router docs.                                                                                                   |

**Verdict:** ✅ **Keep as the primary foundation.** Already installed, fast, free, deterministic, and aligned with Next.js. Best for: smoke tests, API assertions, known regression flows, and fast local feedback loops.

### 2.2. TesterArmy

| Aspect                | Assessment                                                                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**        | AI-agent testing automation. You write natural-language steps (e.g., "Log in with the admin account, open Settings, verify the plan shows Pro"). AI agents with computer vision execute them in a real browser, clicking UI like a human. |
| **Speed**             | Slower — cloud runs take 30s to several minutes per test. Local runs (`--local`) are faster but still agent-driven.                                                                                                                       |
| **Cost**              | SaaS with a free tier. Beyond that, pay-per-run or subscription. Exact pricing not published; likely scales with run volume.                                                                                                              |
| **Determinism**       | Lower — AI agents make vision-based decisions, so the exact click path may vary between runs. Steps are natural language, not code.                                                                                                       |
| **Auth support**      | **Excellent.** Native support for Google OAuth, password login, MFA/TOTP (authenticator secrets), email OTP (via agent mail inboxes), SMS verification, and custom auth flows. No hacks needed.                                           |
| **AI chat testing**   | **Excellent.** The agent can literally read and type into the chat widget like a user. No need to mock `/api/chat` — it exercises the real LLM integration.                                                                               |
| **Maintenance**       | Claimed to be near-zero. No selectors to break. UI redesigns don't break tests because the agent uses vision, not DOM queries.                                                                                                            |
| **CI integration**    | Excellent. Native GitHub App, Vercel/Netlify/Coolify integrations, group webhooks, PR comments with results, and merge blocking.                                                                                                          |
| **Offline**           | ❌ Requires internet. Cloud runs run on TesterArmy infrastructure. Local runs (`--local`) still need API connectivity.                                                                                                                    |
| **Exploration**       | Unique feature: an AI agent reads PR diffs, writes a tailored test plan for that change, and executes it. Catches issues nobody wrote a test for.                                                                                         |
| **Next.js alignment** | Not specifically endorsed by Next.js, but has first-class Vercel preview integration.                                                                                                                                                     |
| **Migration**         | Has explicit migration guides from Playwright, Cypress, Selenium, and Appium.                                                                                                                                                             |

**Verdict:** ✅ **Strong complement** for this specific project. Its native handling of Google OAuth and ability to test the AI chat widget without mocking are game-changers. Best for: auth flows, chat widget testing, PR exploratory testing, and visual regression catching. Use as a **secondary layer** on top of Playwright, not a replacement.

### 2.3. Other tools

| Tool                       | Verdict  | Rationale                                                                                                                                                                 |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cypress**                | ❌ Skip  | Slower than Playwright; inferior handling of async Server Components (Next.js docs note this); no native multi-tab/multi-origin support for Supabase OAuth.               |
| **Vitest Browser Mode**    | ⚠️ Later | Good for component-level browser testing, but not a replacement for full-page e2e flows. Consider only if we later need to test individual React components in isolation. |
| **Puppeteer + Mocha/Jest** | ❌ Skip  | Lower-level than Playwright; requires more boilerplate; no built-in test runner, fixtures, or trace viewer.                                                               |
| **Selenium / WebDriver**   | ❌ Skip  | Legacy, slower, more complex setup. No advantage over Playwright for a modern Next.js app.                                                                                |
| **Maestro**                | ❌ Skip  | Mobile-focused (React Native). Not relevant for a web-only Next.js app.                                                                                                   |

---

## 3. Recommended Architecture: Playwright + TesterArmy

```
┌─────────────────────────────────────────────────────────────┐
│                     E2E Testing Stack                        │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Playwright (primary, fast, deterministic, free)    │
│  ├── Smoke tests (homepage, 404s, navigation)              │
│  ├── API route tests (request fixture)                     │
│  ├── Dashboard static assertions (stats, forms, nav)         │
│  ├── Onboarding form validation                            │
│  └── Settings updates, booking management                    │
│                                                             │
│  Layer 2: TesterArmy (complement, AI-powered, SaaS)         │
│  ├── Google OAuth sign-in flow (real browser)              │
│  ├── AI chat widget booking flow (real LLM responses)      │
│  ├── PR exploration agent (auto-generated per-PR tests)    │
│  └── Visual regression / cross-browser checks              │
└─────────────────────────────────────────────────────────────┘
```

### Why both?

| Scenario                                                 | Playwright                      | TesterArmy                                   |
| -------------------------------------------------------- | ------------------------------- | -------------------------------------------- |
| "Does the dashboard render stats after seeding?"         | ✅ Fast, deterministic          | ⚠️ Overkill, slower, costs a run             |
| "Does the booking API reject double-booking?"            | ✅ Request fixture, instant     | ❌ Not designed for API-only assertions      |
| "Can a user sign in via Google OAuth?"                   | ❌ Hard to automate reliably    | ✅ Native support, no hacks                  |
| "Can a prospect complete a booking through the AI chat?" | ❌ Must mock LLM, loses realism | ✅ Tests the real AI integration             |
| "What if this PR broke something we didn't test?"        | ❌ Only tests what you wrote    | ✅ Exploration agent reads diffs, finds gaps |
| "Run 50 tests in 2 minutes on CI"                        | ✅                              | ❌ Too slow and expensive                    |
| "Run on a plane without WiFi"                            | ✅                              | ❌                                           |

---

## 4. Current State

```
e2e/
  smoke.spec.ts          # 1 test: checks homepage heading says "trial classes"
playwright.config.ts     # basic config: dev server, baseURL, parallel
package.json             # scripts: test:e2e = playwright test
vitest.config.ts         # unit tests (node env, src/**/*.test.ts)
vitest.integration.config.ts  # integration tests against real DB
```

**What works today:**

- Playwright runs against the dev server (`bun run dev`).
- Smoke test renders the signed-out homepage.

**What is missing:**

- No test database isolation.
- No authenticated test fixtures.
- No coverage of the prospect booking chat or the owner dashboard.
- No headless/CI-optimized configuration.
- No visual regression or mobile viewport testing.
- No TesterArmy project or tests configured.

---

## 5. Testing Strategy

### 5.1. Guiding Principles

1. **Test what the user does, not what the code does.** Favor e2e over unit tests for async Server Components and page-level integration (per Next.js recommendation).
2. **Never hit real Google OAuth in Playwright CI.** Use a Supabase auth bypass or seed a test session directly into browser storage for Playwright tests. Let TesterArmy handle real OAuth.
3. **Isolate test data.** Each Playwright test run should operate against a dedicated test schema or a freshly reset database snapshot. TesterArmy runs should target staging or preview environments with seeded data.
4. **Fail fast locally, run full in CI.** Use `grep`/`project` tags to run subsets locally; CI runs the full Playwright suite. TesterArmy runs on PRs and scheduled monitoring.
5. **Mock external APIs that are non-deterministic in Playwright.** The AI chat (`/api/chat`) should be stubbed in Playwright unless we are explicitly testing the integration — but let TesterArmy exercise the real LLM.

### 5.2. Test Pyramid for This Project

| Layer                    | Tool                         | Coverage                                                                        |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------------- |
| **Unit**                 | Vitest                       | Pure functions, utilities, schedule math, ICS generation, slug validation       |
| **Integration**          | Vitest + Postgres            | DB queries, Drizzle ORM logic, API route handlers (mocked AI/Resend)            |
| **E2E (Deterministic)**  | Playwright                   | Smoke tests, static page assertions, API routes, form validation, dashboard nav |
| **E2E (Realistic / AI)** | TesterArmy                   | OAuth flows, AI chat booking, visual regression, PR exploration                 |
| **Contract / API**       | Playwright `request` fixture | REST API assertions for `/api/bookings`, `/api/slots`, `/api/leads`             |

---

## 6. Playwright: Auth Testing Strategy

The application uses **Supabase Auth with Google OAuth**. OAuth redirects are hostile to deterministic e2e testing.

### 6.1. Preferred Approach: Dev-Only Auth Bypass Route

Add a hidden `POST /api/e2e/auth` route (only in `development`/`test` env) that accepts a `userId` and sets the Supabase auth cookie:

```ts
// src/app/api/e2e/auth/route.ts (guarded by NODE_ENV)
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
    return new Response("Forbidden", { status: 403 });
  }
  const { userId, email, name } = await req.json();
  // Use Supabase service-role client to mint a session
  const { data } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  // Or directly create a session and set the cookie
  // ...implementation details...
  return new Response("OK", { status: 200 });
}
```

Playwright tests navigate to this URL once per worker to log in, then use `storageState` to share the authenticated context across tests.

### 6.2. Fallback: Storage-State Injection

Pre-seed a test user in the test DB, generate a valid Supabase JWT + refresh token via the service-role key, and write it to a `storageState.json` file that Playwright loads per test.

> **TesterArmy bypasses this problem entirely** — it handles Google OAuth natively by using real browser automation with stored credentials.

---

## 7. Playwright: Database State Management

E2E tests must start from a **known, reproducible database state**.

### 7.1. Option A: Dedicated Test Schema (Recommended)

Use a separate Postgres schema or database for e2e tests:

```env
# .env.test.local
DATABASE_URL=postgres://localhost:5432/fillthemat_test
```

Before each test run:

1. Drop and recreate the test schema.
2. Run `drizzle-kit migrate` against the test DB.
3. Seed minimal fixtures (one approved school, one owner, one trial offering, one window).

### 7.2. Seed Data Contract

Create a shared seed module for e2e + integration tests:

```ts
// e2e/fixtures/seed.ts
export async function seedTestSchool(db: Db) {
  const user = await db.insert(users).values({ ... }).returning();
  const school = await db.insert(schools).values({
    ownerUserId: user[0].id,
    slug: `test-school-${nanoid(6)}`,
    name: "Test Dojo",
    approvedAt: new Date(),      // pre-approved
    publishedAt: new Date(),     // pre-published
    ...
  }).returning();
  const offering = await db.insert(trialOfferings).values({ ... }).returning();
  const window = await db.insert(trialWindows).values({ ... }).returning();
  // Generate trial_occurrences for today + next 7 days
  return { user, school, offering, window };
}
```

---

## 8. Playwright Configuration Evolution

### 8.1. `playwright.config.ts` — Target State

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // 1. Setup: create authenticated state once
    { name: "setup", testMatch: /.*\.setup\.ts/, teardown: "teardown" },

    // 2. Desktop Chrome (default)
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/state.json",
      },
      dependencies: ["setup"],
    },

    // 3. Mobile Safari
    {
      name: "mobile-safari",
      use: {
        ...devices["iPhone 14"],
        storageState: "e2e/.auth/state.json",
      },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: process.env.CI
      ? "bun run --bun next build && bun run --bun next start"
      : "bun run --bun next dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  globalSetup: require.resolve("./e2e/global-setup.ts"),
  globalTeardown: require.resolve("./e2e/global-teardown.ts"),
});
```

### 8.2. File Structure

```
e2e/
  fixtures/
    auth.ts              # helpers to mint Supabase sessions via bypass route
    seed.ts              # shared DB seeding for tests
  pages/
    landing-page.ts      # Page Object Model for /s/:slug
    dashboard-page.ts    # Page Object Model for /dashboard/*
    sign-in-page.ts      # Page Object Model for /sign-in
  specs/
    smoke.spec.ts        # (existing) homepage renders
    landing.spec.ts      # prospect views landing page, chat widget loads
    booking.spec.ts      # prospect booking via chat (mocked AI in Playwright)
    auth.spec.ts         # sign-in redirect, onboarding form validation, logout
    dashboard.spec.ts    # owner views stats, publishes school, manages bookings
    settings.spec.ts     # owner updates school settings
    api.spec.ts          # direct REST API assertions (no browser UI)
  global-setup.ts        # reset DB, start dev server, seed base fixtures
  global-teardown.ts     # optional: dump logs, stop services
  .auth/
    state.json           # gitignored: Playwright storageState for authenticated tests
```

---

## 9. TesterArmy Setup & Integration

### 9.1. Install CLI

```bash
npm install -g testerarmy
# or
npx testerarmy --help
```

Authenticate:

```bash
ta auth --api-key $TESTERARMY_API_KEY
```

### 9.2. Create Project

```bash
echo '{"name":"fillthemat","url":"https://staging.fillthemat.com","projectType":"web"}' | ta projects create --json
```

### 9.3. Add Project Memory

Memories give the AI agent durable context about the app structure:

```bash
# Auth route memory
echo '{"category":"site_structure","title":"Auth route","content":"Sign-in is at /sign-in using Google OAuth. Onboarding is at /onboarding. Dashboard is at /dashboard. Public school pages are at /s/:slug.","importance":"high"}' | ta memories create --project <projectId> --json

# Chat widget memory
echo '{"category":"site_structure","title":"AI chat widget","content":"The booking chat widget on /s/:slug accepts natural language. Users can ask about trial classes, select an offering, pick a time slot, and provide contact info to book. The chat streams responses from an AI backend.","importance":"high"}' | ta memories create --project <projectId> --json

# Dashboard memory
echo '{"category":"site_structure","title":"Dashboard publish flow","content":"The dashboard has a Preview button (marks school previewed) and a Publish button. Publishing requires: approvedAt set, previewedAt set, at least one active offering, at least one active window, and location/contact facts filled in.","importance":"high"}' | ta memories create --project <projectId> --json
```

### 9.4. Add Test Credentials

For the owner flow, add a Google OAuth test credential:

```bash
# In the TesterArmy dashboard: Project → Test Accounts → Add Credential
# Label: "owner"
# Auth method: Google OAuth
# Username: your-test-google-email@gmail.com
# Password: (if applicable)
# When to use: "School owner account. Exists on staging and production."
```

For prospect flows, no credential is needed — the agent tests as an anonymous user.

### 9.5. Create Tests (Natural Language Steps)

**Test 1: Owner Onboarding**

```text
Log in with the saved owner account via Google OAuth.
Verify the onboarding page is shown or the dashboard is visible.
If on onboarding, create a school named "Test Dojo" with slug "test-dojo".
Verify the dashboard shows the school name "Test Dojo".
```

**Test 2: AI Chat Booking**

```text
Navigate to the public school page at /s/test-dojo.
Verify the school name and chat widget are visible.
In the chat widget, ask about booking a trial class.
Follow the agent's prompts to select an offering, pick a time slot, and provide a parent name, email, and child name/age.
Verify the booking confirmation appears with the correct date and time.
```

**Test 3: Dashboard Publish Flow**

```text
Log in with the saved owner account.
Navigate to the dashboard.
Verify the school shows as "Unpublished".
Click Preview landing page and verify the preview loads.
Return to the dashboard and verify the Publish button is enabled.
Click Publish and verify the school status changes to "Published".
```

Create via CLI:

```bash
echo '{"title":"AI Chat Booking","description":"Prospect books a trial through the AI chat widget","steps":[{"title":"Navigate to /s/test-dojo","type":"act"},{"title":"Verify school name and chat widget are visible","type":"assert"},{"title":"Ask the chat about booking a trial class and follow the prompts","type":"act"},{"title":"Verify booking confirmation appears with correct date and time","type":"assert"}]}' | ta tests create --project <projectId> --json
```

### 9.6. Local Dev Testing

```bash
# Set target to local dev server
export TESTERARMY_TARGET_URL="http://localhost:3000"

# Run a test locally against the dev server
ta tests run <testId> --local --headed

# Run with debug output
mkdir -p .testerarmy
ta tests run <testId> --local --debug
```

### 9.7. CI / PR Integration

**Regression testing:** Organize tests into a group and trigger on every PR:

```bash
# Create a group
echo '{"name":"Critical flows","testIds":["<testId1>","<testId2>"]}' | ta groups create --project <projectId> --json

# Trigger via webhook in CI
# See: https://tester.army/docs/run/group-webhooks
```

**Exploration agent:** Enable in the TesterArmy dashboard under **PR Testing**. The agent reads PR diffs and generates tailored tests automatically. Zero test authoring required.

**Vercel integration:** Connect the TesterArmy GitHub App and Vercel integration. Tests run automatically against preview deployments. No webhook configuration needed for Vercel.

---

## 10. Implementation Phases

### Phase 1: Playwright Infrastructure (Week 1)

1. **Add test environment plumbing**
   - Create `.env.test.local` with a dedicated `DATABASE_URL`.
   - Ensure local Postgres is available (or Docker container).
2. **Implement global setup / teardown**
   - `global-setup.ts`: connect to test DB, run `drizzle-kit migrate`, seed base data.
   - `global-teardown.ts`: truncate all tables or drop the test schema.
3. **Create auth bypass**
   - Implement `POST /api/e2e/auth` dev-only route.
   - Verify a Playwright test can load `storageState` and visit `/dashboard` directly.
4. **Refactor `playwright.config.ts`** to the target state above.
5. **Add first real tests:**
   - `smoke.spec.ts` — expanded: homepage, 404 for unpublished school, sign-in redirect.
   - `api.spec.ts` — `POST /api/bookings`, `GET /api/slots`, rejection of double-booking.

**Deliverable:** `e2e/global-setup.ts`, `e2e/global-teardown.ts`, updated `playwright.config.ts`, 5–6 Playwright specs.

### Phase 2: Playwright Core Flows (Week 2)

1. **Build Page Object Models**
   - `LandingPage`, `DashboardPage`, `SignInPage`, `BookingChatPage`.
2. **Prospect flow tests (non-authenticated)**
   - `landing.spec.ts`: public school page renders; 404 for unpublished; owner preview works.
   - `booking.spec.ts`: mock `/api/chat` with deterministic tool-call sequence to simulate a booking completion. Assert confirmation page shows correct data.
3. **Auth flow tests**
   - `auth.spec.ts`: sign-in redirect, onboarding form validation, slug uniqueness errors, logout.
4. **Owner dashboard tests**
   - `dashboard.spec.ts`: stats cards, publish button states, preview marks school previewed.
   - `settings.spec.ts`: update school name, timezone, notification email.
   - `bookings.spec.ts`: list upcoming bookings, cancel flow.

**Deliverable:** 12–15 Playwright specs covering all happy paths and key edge cases.

### Phase 3: TesterArmy Integration (Week 3)

1. **Create TesterArmy project**
   - Set target URL to staging or local tunnel (`ngrok` / `cloudflared` for local dev).
   - Add project memories for auth routes, chat widget, and dashboard publish flow.
2. **Add test credentials**
   - Google OAuth test account for owner flows.
3. **Create 3–5 natural-language tests**
   - Owner sign-in → onboarding → dashboard.
   - AI chat booking flow (real LLM, no mocking).
   - Dashboard preview → publish flow.
   - Public school page navigation and chat interaction.
4. **Verify local execution**
   - `ta tests run --local --headed` to watch the agent execute.
   - Debug any failures and refine steps or memories.
5. **Enable PR exploration agent**
   - Connect GitHub App.
   - Connect Vercel integration (if on Vercel).
   - Enable exploration agent for PRs.

**Deliverable:** TesterArmy project with working tests, PR integration enabled, exploration agent active.

### Phase 4: CI & Optimization (Week 4)

1. **Playwright CI workflow**
   - Add GitHub Actions workflow that spins up Postgres, runs `bun run test:e2e`, uploads traces/screenshots on failure.
2. **TesterArmy CI workflow**
   - Add workflow step that triggers TesterArmy group runs on deployment via webhook.
   - Or rely on the native Vercel integration if applicable.
3. **Mobile viewport testing**
   - Playwright: ensure landing page chat and dashboard sidebar work on `iPhone 14` and `Pixel 7` viewports.
   - TesterArmy: run tests at mobile viewport size.
4. **Performance baseline**
   - Playwright: add a homepage cold-start performance assertion (< 3s).

**Deliverable:** Two CI workflow files, mobile project configs, performance baselines.

---

## 11. Specific Test Cases

### Playwright Test Cases

| #   | Test                                                             | Mocking / Setup                 |
| --- | ---------------------------------------------------------------- | ------------------------------- |
| 1   | Homepage renders for signed-out user.                            | None                            |
| 2   | Unpublished school returns 404 for anonymous visitor.            | None                            |
| 3   | Owner can preview unpublished school via `?preview=1`.           | Auth bypass + seeded school     |
| 4   | Landing session POSTs to `/api/sessions` with UTM params.        | Check network                   |
| 5   | `POST /api/bookings` creates a booking with valid payload.       | Request fixture + seeded data   |
| 6   | `POST /api/bookings` rejects double-booking same occurrence.     | Request fixture + seeded data   |
| 7   | `GET /api/slots?schoolId=...` returns available occurrences.     | Request fixture + seeded data   |
| 8   | Signed-out user redirected from `/dashboard` to `/sign-in`.      | None                            |
| 9   | Signed-in user without school redirected to `/onboarding`.       | Auth bypass + no school seed    |
| 10  | Onboarding form creates school and redirects to `/dashboard`.    | Auth bypass + no school seed    |
| 11  | Dashboard shows 0 stats for a new school.                        | Auth bypass + fresh school seed |
| 12  | Dashboard "Preview" button marks school previewed.               | Auth bypass                     |
| 13  | Dashboard "Publish" button disabled until prerequisites met.     | Auth bypass + incomplete school |
| 14  | Settings page updates school name, timezone, notification email. | Auth bypass                     |
| 15  | Bookings page lists upcoming trial bookings.                     | Auth bypass + seeded bookings   |
| 16  | Leads page displays captured leads.                              | Auth bypass + seeded leads      |
| 17  | Mocked AI chat booking flow completes end-to-end.                | Mock `/api/chat` responses      |
| 18  | Homepage renders within 3s on cold start.                        | Performance assertion           |

### TesterArmy Test Cases

| #   | Test                                                              | Notes                           |
| --- | ----------------------------------------------------------------- | ------------------------------- |
| 19  | Owner signs in via Google OAuth and reaches dashboard.            | Real OAuth, no mocks            |
| 20  | AI chat widget: prospect asks about trials and completes booking. | Real LLM responses, no mocking  |
| 21  | Dashboard: owner previews landing page, then publishes school.    | Real browser, visual assertions |
| 22  | Public school page: prospect views school info and starts chat.   | Anonymous user, no auth         |
| 23  | PR exploration: agent reads PR and finds un-tested edge case.     | Auto-generated per PR           |

---

## 12. CI Workflows

### 12.1. Playwright CI

```yaml
# .github/workflows/playwright.yml
name: Playwright E2E
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx playwright install --with-deps
      - run: bun run db:migrate
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/fillthemat_test
      - run: bun run test:e2e
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/fillthemat_test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

### 12.2. TesterArmy CI (Trigger via webhook)

```yaml
# .github/workflows/testerarmy.yml
name: TesterArmy AI Tests
on:
  deployment_status:

jobs:
  test:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST "https://tester.army/api/v1/webhooks/groups/$GROUP_ID" \
            -H "Authorization: Bearer ${{ secrets.TESTERARMY_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "targetUrl": "${{ github.event.deployment_status.target_url }}",
              "environment": "preview"
            }'
```

> For Vercel, the native integration handles this automatically — no custom workflow needed.

---

## 13. Risks & Mitigations

| Risk                                                    | Mitigation                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Supabase auth cookie format changes**                 | Use the dev-only `/api/e2e/auth` route rather than hard-coding cookie shapes. For TesterArmy, this is irrelevant — it handles OAuth natively.    |
| **Non-deterministic AI chat responses in Playwright**   | Mock `/api/chat` in Playwright; exercise the real LLM only in TesterArmy.                                                                        |
| **TesterArmy costs scale with run volume**              | Use TesterArmy selectively: auth flows, chat widget, and PR exploration. Run Playwright for the bulk of regression tests.                        |
| **TesterArmy flakiness due to AI vision**               | Iterate on step wording and project memories. Use `assert` steps with specific visible labels. TesterArmy retries failed steps automatically.    |
| **Test data leaks between parallel Playwright workers** | Use `workers: 1` in CI until unique seeding per worker is implemented. Use random slugs/emails.                                                  |
| **Local dev server conflicts**                          | Playwright `reuseExistingServer` handles this. TesterArmy local runs need the dev server running on a known port.                                |
| **Flaky tests due to network / animation**              | Use `toHaveURL`, `toBeVisible`, and `expect.poll` instead of arbitrary `waitForTimeout`. Disable CSS animations in test mode.                    |
| **Vercel preview deployment testing**                   | Playwright: lightweight smoke job against preview URL. TesterArmy: native Vercel integration handles this.                                       |
| **TesterArmy requires internet**                        | Playwright runs fully offline. If TesterArmy is down, Playwright still provides baseline coverage.                                               |
| **Migration cost if leaving TesterArmy**                | Playwright tests are standard code — fully portable. TesterArmy tests are natural language — easy to convert back to Playwright specs if needed. |

---

## 14. Immediate Next Steps

1. **Playwright:** Create `e2e/global-setup.ts` and `e2e/global-teardown.ts`.
2. **Playwright:** Add `e2e/fixtures/auth.ts` with the dev-only auth bypass helper.
3. **Playwright:** Add `e2e/fixtures/seed.ts` with shared seeding utilities.
4. **Playwright:** Refactor `playwright.config.ts` to support projects, setup dependencies, and CI optimization.
5. **Playwright:** Write the first real authenticated test: `dashboard.spec.ts` — verify owner with seeded school can see stats.
6. **Playwright:** Add `.github/workflows/playwright.yml`.
7. **TesterArmy:** Create a free account, install `ta` CLI, authenticate.
8. **TesterArmy:** Create a project, add memories for auth routes and chat widget.
9. **TesterArmy:** Write and run the first natural-language test: owner Google OAuth sign-in → dashboard.
10. **TesterArmy:** Enable GitHub App and Vercel integration for PR exploration.

---

## Appendix A: Playwright Mocking the AI Chat

The `/api/chat` route uses `ai` SDK streaming. In Playwright tests, intercept it to return a deterministic tool-call sequence:

```ts
await page.route("**/api/chat", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "text/plain",
    body: `data: ${JSON.stringify({
      type: "tool-call",
      toolCallId: "1",
      toolName: "bookTrial",
      args: {
        offeringId: offering.id,
        occurrenceId: occurrence.id,
        contactName: "Test Parent",
        contactEmail: "parent@test.com",
        participantName: "Test Kid",
        participantAge: 8,
      },
    })}\n\n`,
  });
});
```

Alternatively, implement a `TEST_MODE` env var in the application that short-circuits the AI stream and returns a canned response.

## Appendix B: Deterministic Turnstile for Playwright Tests

The app uses `@marsidev/react-turnstile`. In test mode, set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to a **test key** (Cloudflare provides `1x00000000000000000000AA` which always passes visible validation).

## Appendix C: TesterArmy Step Reference

| Step Type    | Use For         | Example                                                |
| ------------ | --------------- | ------------------------------------------------------ |
| `act`        | User actions    | `Open the billing settings page.`                      |
| `assert`     | Verifying state | `Verify the billing page shows the current plan.`      |
| `login`      | Authentication  | `Log in with the saved admin account.`                 |
| `files`      | Uploading files | `Upload the sample invoice PDF.`                       |
| `screenshot` | Visual evidence | `Capture a screenshot of the completed checkout page.` |

TesterArmy steps should be 3–10 per test. Each step gets one time budget. Tests cannot exceed 30 steps. Good steps read like instructions to a teammate — no selectors, no waits, no internal component names.

## Appendix D: TesterArmy vs Playwright Concept Mapping

| Playwright                                   | TesterArmy                                                           |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `test()` in a spec file                      | A test with natural-language steps                                   |
| `test.describe()` block                      | A test group                                                         |
| `page.goto()`, `page.click()`, `page.fill()` | `act` steps (`"Navigate to /pricing"`, `"Click the upgrade button"`) |
| `expect(locator).toBeVisible()`              | `assert` steps (`"The dashboard shows the new project"`)             |
| Login fixtures / `storageState`              | `login` step + project credentials                                   |
| `playwright.config.ts` `baseURL`             | Project URL (override with `--url`)                                  |
| Selectors (`getByTestId`, CSS, XPath)        | **Not needed** — agent finds elements visually                       |
| Retries and `waitFor` calls                  | **Not needed** — agent waits like a human                            |
| CI workflow running `npx playwright test`    | `ta tests run --group <groupId>` or group webhooks                   |
