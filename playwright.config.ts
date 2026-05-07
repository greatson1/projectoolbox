import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — tier-3 E2E tests.
 *
 * These tests run a full user journey in a real browser against a real
 * Next.js dev server (or a deployed preview), with LLM endpoints mocked
 * via tests/e2e/helpers/llm-mock.ts so runs are deterministic.
 *
 * Tests are SKIPPED by default unless E2E=1 in env. Reason: a full E2E
 * run takes minutes, needs a running database, and needs the Next.js
 * dev server. CI gates them on the merge queue, not on every commit.
 *
 * Run with:
 *   E2E=1 BASE_URL=http://localhost:3000 npx playwright test
 *
 * First run (one-time):
 *   npm install --save-dev @playwright/test
 *   npx playwright install chromium
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  // Skip-by-default: only run when E2E=1 set explicitly.
  testIgnore: process.env.E2E ? undefined : ["**/*"],
  fullyParallel: false,
  // 1 retry on flake — full retries hide real bugs.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Optional dev-server bootstrap — uncomment when you want Playwright
  // to start `next dev` itself instead of expecting one running.
  // webServer: {
  //   command: "npm run dev",
  //   port: 3000,
  //   reuseExistingServer: !process.env.CI,
  // },
});
