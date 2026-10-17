import { defineConfig } from "@playwright/test";

/**
 * Each worktree owns the origin `bun run setup` wrote into `.env.local`, so the
 * suite follows that instead of assuming :3000.
 */
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";

const isCI = Boolean(process.env.CI);
const port = new URL(baseURL).port || "80";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI
    ? [
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["github"],
        ["json", { outputFile: "test-results/results.json" }],
        ["list"],
      ]
    : [["html", { open: "never" }], ["list"]],
  use: {
    baseURL,
    // CI captures a screenshot and trace for every test so the hosted HTML
    // report shows the UI without downloading artifacts.
    trace: isCI ? "on" : "retain-on-failure",
    screenshot: isCI ? "on" : "only-on-failure",
    video: isCI ? "retain-on-failure" : "off",
  },
  webServer: {
    command: isCI ? `bun run --bun next start --hostname 127.0.0.1 --port ${port}` : "bun run dev",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
