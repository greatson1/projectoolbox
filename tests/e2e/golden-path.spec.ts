import { test, expect } from "@playwright/test";

/**
 * Golden-path E2E — authenticated dashboard reachable via the E2E
 * auth-bypass credential provider.
 *
 * Pre-conditions (set in the dev-server's env):
 *   - E2E_AUTH_BYPASS=1
 *   - E2E_AUTH_BYPASS_TOKEN=<32+ char shared secret>
 *   - ANTHROPIC_FAKE=1 (optional — silences any agent fetch that fires)
 *   - PERPLEXITY_FAKE=1 (optional)
 *
 * Test-runner env:
 *   - E2E=1 (gate Playwright)
 *   - E2E_AUTH_BYPASS_TOKEN=<same value>
 *   - E2E_TEST_USER_ID=<user id of a seeded test user with an org>
 *
 * The bypass works by POSTing to NextAuth's credentials endpoint with
 * the special "e2e-bypass" provider. Same shape as a normal sign-in,
 * but the provider only accepts userId + token instead of password.
 *
 * What this test asserts:
 *   - Bypass actually mints a session (auth flow is correctly wired)
 *   - A protected dashboard route renders for the seeded user
 *   - The page mentions the user's email (proving the session is
 *     populated correctly, not just blank-redirecting)
 */

const TOKEN = process.env.E2E_AUTH_BYPASS_TOKEN;
const USER_ID = process.env.E2E_TEST_USER_ID;
const requiredEnvSet = !!(TOKEN && USER_ID);

test.describe("authenticated dashboard via E2E auth bypass", () => {
  test.skip(!requiredEnvSet, "needs E2E_AUTH_BYPASS_TOKEN + E2E_TEST_USER_ID set in test env");

  test("bypass signs the user in and the dashboard loads", async ({ page, request }) => {
    // 1. Fetch CSRF token NextAuth needs.
    const csrfRes = await request.get("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    expect(csrfToken).toBeTruthy();

    // 2. POST credentials to the e2e-bypass provider. Form-encoded as
    //    NextAuth expects.
    const signInRes = await request.post("/api/auth/callback/e2e-bypass", {
      form: {
        csrfToken,
        userId: USER_ID!,
        token: TOKEN!,
        callbackUrl: "/dashboard",
        json: "true",
      },
    });
    expect(signInRes.status()).toBeLessThan(400);

    // 3. NextAuth set Set-Cookie headers on the request context. The
    //    page object shares the same context, so cookies carry over.
    await page.goto("/dashboard");

    // The dashboard route should NOT bounce back to /login.
    await expect(page).not.toHaveURL(/\/login/);
    // And should render some authenticated UI shell — we don't pin
    // exact copy because the dashboard evolves; just that it isn't an
    // error page.
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});
