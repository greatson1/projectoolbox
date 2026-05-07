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
    // Login page should always have a sign-in form OR a Google button.
    // We don't assert exact copy because pages evolve — but the route
    // must not 500.
    await expect(page).toHaveURL(/\/login/);
  });

  test("unknown path returns 404, not 500", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist-xyz123");
    // Next.js renders a 404 page. Just make sure the server didn't
    // crash trying to do it.
    expect(response?.status()).toBe(404);
  });

  test("dashboard redirects unauthenticated user to login", async ({ page }) => {
    await page.goto("/dashboard");
    // Could be /login or /login?callbackUrl=...
    await expect(page).toHaveURL(/\/login/);
  });
});
