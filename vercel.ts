import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  bunVersion: "1.4.x",
  // Refuse to release production code ahead of its database schema. Hosted migrations
  // remain an explicit operator action, never a build/runtime write.
  buildCommand:
    'if [ "$VERCEL_ENV" = "production" ]; then bun run db:check; fi && bun run build',
  framework: "nextjs",
  // Playwright HTML reports live on GitHub Pages (`gh-pages`). Vercel must not
  // build that branch: each report push is a full copy of the accumulated
  // tree (~361MB and growing) and was the deployment-storage spike.
  git: {
    deploymentEnabled: {
      "gh-pages": false,
    },
  },
  // Belt-and-suspenders if a gh-pages deployment is created anyway (exit 0 =
  // skip). See docs/decisions/vercel-gh-pages-deployments.md.
  ignoreCommand: '[ "$VERCEL_GIT_COMMIT_REF" = "gh-pages" ]',
  crons: [
    { path: "/api/cron/maintenance", schedule: "0 14 * * *" },
    // Hobby-safe: Vercel's free tier only allows daily cron intervals. The
    // fast path is `after()` in the inbound webhook; this daily tick is the
    // sweeper for retries/backoff and stuck-claim recovery.
    { path: "/api/cron/whatsapp", schedule: "0 5 * * *" },
  ],
};
