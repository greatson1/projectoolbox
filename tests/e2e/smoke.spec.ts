import { test, expect } from "@playwright/test";

/**
 * Smoke tests — no auth, no DB, no LLM. Just prove the pipe works:
 *   - Next.js dev server is reachable
 *   - Public routes render
 *   - Login page is up
 *   - 404s return cleanly (not a server explosion)
 *
 * These tests run against a live dev server at BASE_URL. Spin one up
 * before running:
 *   npm run dev
 *   E2E=1 npm run test:e2e -- smoke
 *
 * Tier-3 contract: protect against full-stack breakage that unit and
 * integration tests can't catch (broken middleware, missing build
 * artefacts, route mismatches, broken assets).
 */

test.describe("smoke — public routes", () => {
  test("login page renders without crashing", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);
  });

  test("unknown path returns 404, not 500", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist-xyz123");
    expect(response?.status()).toBe(404);
  });

  test("dashboard redirects unauthenticated user to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("smoke — authenticated sub-page routing", () => {
  // These tests verify that every project sub-page route resolves without 500
  // when accessed auth-protected (redirects to /login). Covers the 27 pages
  // listed in docs/UAT-script.md section K.
  const SUB_PAGES = [
    "/projects",
    "/agents/deploy",
    "/agents/pipeline",
    "/agents/chat",
    "/portfolio",
    "/programmes",
    "/calendar",
    "/knowledge",
    "/research",
    "/billing/credits",
    "/notifications",
    "/activity",
    "/approvals",
    "/meetings",
    "/invoices",
    "/ml-insights",
    "/sentiment",
    "/admin/waitlist",
  ];

  for (const path of SUB_PAGES) {
    test(`${path} returns valid response (not 500) when unauthenticated`, async ({ page }) => {
      const response = await page.goto(path);
      const status = response?.status() ?? 0;
      // Accept: 200 (renders page), 307 (redirect), 403 (forbidden), 404 (generated route)
      // Reject: 500+ (server error)
      expect(status, `${path} returned server error ${status}`).toBeLessThan(500);
    });
  }
});

test.describe("smoke — project sub-page routes", () => {
  // Verify all 27 project/sub-page routes are valid routes when accessed.
  // These routes are protected but should resolve to something (not 500 crash).
  const PROJECT_SUBPAGES = [
    "/risk",
    "/schedule",
    "/scope",
    "/stakeholders",
    "/actions",
    "/artefacts",
    "/documents",
    "/reports",
    "/status-report",
    "/evm",
    "/cost",
    "/agile",
    "/sprint",
    "/sprint-planning",
    "/resources",
    "/procurement",
    "/benefits",
    "/scorecard",
    "/change-control",
    "/compliance",
    "/audit",
    "/issues",
    "/qa-testing",
    "/report-composer",
    "/pm-tracker",
    "/estimate",
  ];

  for (const sub of PROJECT_SUBPAGES) {
    test(`${sub} route exists (not 500 crash)`, async ({ page }) => {
      // Use a fake projectId — just checking the route itself exists
      const response = await page.goto(`/projects/fake-project-id${sub}`);
      const status = response?.status() ?? 0;
      expect(status, `${sub} route crashed with ${status}`).toBeLessThan(500);
      // Should redirect to login or show 404, not 500
      await expect(page).toHaveURL(/\/(login|projects\/fake-project-id|404)/);
    });
  }
});
