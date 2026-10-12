import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  bunVersion: "1.4.x",
  // Production builds migrate, check schema readiness, then build the app.
  // Preview builds and the application runtime never apply migrations.
  buildCommand: "bun run build:vercel",
  framework: "nextjs",
  // Playwright HTML reports live on GitHub Pages (`gh-pages`). Vercel must not
  // build that branch: each report push is a full copy of the accumulated
  // tree (~361MB and growing) and was the deployment-storage spike.
  git: {
    deploymentEnabled: {
      "gh-pages": false,
    },
  },
  // Exit 0 skips docs-only Preview builds; Production and uncertain diffs build.
  ignoreCommand: "bun run vercel:ignore-build",
  crons: [
    { path: "/api/cron/maintenance", schedule: "0 14 * * *" },
    // Hobby-safe: Vercel's free tier only allows daily cron intervals. The
    // fast path is `after()` in the inbound webhook; this daily tick is the
    // sweeper for retries/backoff and stuck-claim recovery.
    { path: "/api/cron/whatsapp", schedule: "0 5 * * *" },
  ],
};
