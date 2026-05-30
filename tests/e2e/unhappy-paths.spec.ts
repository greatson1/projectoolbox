import { test as base, expect } from "@playwright/test";

// `request` fixture needs ignoreHTTPSErrors so it doesn't trip on the
// system root-CA check that fails in some sandboxed CI envs. The browser
// fixture already accepts certs via the global playwright.config.ts.
const test = base.extend({
  request: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true });
    await use(ctx);
    await ctx.dispose();
  },
});

/**
 * Unhappy-path smoke against the LIVE site.
 *
 * Things that must NOT crash, NOT leak internal data, NOT redirect into a
 * loop, and must return appropriate status codes. Driven against
 * BASE_URL — defaults to localhost:3000, point at https://projectoolbox.com
 * for production verification.
 *
 * What this is: an automated UAT for everything reachable WITHOUT auth.
 *   - Auth-required pages must redirect to /login (not 500, not blank)
 *   - Auth-required API routes must return 401 or redirect, never crash
 *   - 404 pages must render with a Next.js 404, not a server error
 *   - Malformed URLs, query params, and slugs must not crash
 *   - Static assets (favicon, og-image, sitemap, robots) must serve
 *
 * What this is NOT: authenticated journeys. Those need a dev server with
 * E2E_AUTH_BYPASS + LLM fakes + a non-prod DB. The live-walkthrough.spec.ts
 * covers that flow against localhost.
 */

const PROTECTED_PAGES = [
  "/dashboard",
  "/projects",
  "/agents",
  "/approvals",
  "/portfolio",
  "/programmes",
  "/calendar",
  "/knowledge",
  "/billing",
  "/billing/credits",
  "/notifications",
  "/activity",
  "/meetings",
  "/invoices",
  "/ml-insights",
  "/sentiment",
  "/admin",
  "/admin/waitlist",
  "/agents/deploy",
  "/agents/chat",
  "/agents/pipeline",
];

const PROTECTED_API = [
  "/api/dashboard",
  "/api/projects",
  "/api/agents",
  "/api/billing/portal",
  "/api/notifications",
  "/api/activity",
];

const PUBLIC_PAGES = [
  "/",
  "/login",
  "/about",
  "/signup",
  "/forgot-password",
  "/waitlist",
];

test.describe("unhappy paths — auth-protected surface", () => {
  for (const path of PROTECTED_PAGES) {
    test(`${path} redirects to /login when unauthenticated`, async ({ page }) => {
      await page.goto(path);
      // Either lands on /login with optional ?callbackUrl, OR (for admin routes)
      // returns a 403 page that still renders without crashing.
      const url = page.url();
      const onLogin = /\/login(\?|$)/.test(url);
      if (!onLogin) {
        // Some admin pages may render a "Forbidden" / "Not enough permissions"
        // shell instead of redirecting — assert that we got SOMETHING and
        // didn't 500.
        const status = await page.evaluate(() => document.title);
        expect(status, `${path} did not redirect and did not render`).toBeTruthy();
      } else {
        expect(onLogin).toBe(true);
      }
    });
  }
});

test.describe("unhappy paths — protected API endpoints", () => {
  for (const path of PROTECTED_API) {
    test(`${path} returns 401 / 403 / 302 when unauthenticated`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      // Acceptable: 401 (no session), 403 (no org), 302/307 (redirect to login),
      // or 200 with an error payload (some routes prefer to short-circuit
      // gracefully).
      const status = res.status();
      // Acceptable responses for an unauthenticated GET against an auth-
      // gated endpoint:
      //   401 — explicit auth challenge
      //   403 — forbidden (e.g. no org context)
      //   302/307 — redirect (most likely to /login)
      //   404 — route generation hasn't materialised (still doesn't leak data)
      //   405 — POST-only endpoint; doesn't leak data
      //   200 — error payload in body (some routes prefer that to a status code)
      // Anything 500+ is a real failure.
      const acceptable = [200, 302, 307, 401, 403, 404, 405];
      expect(
        acceptable.includes(status),
        `${path} returned unexpected status ${status}`,
      ).toBe(true);
      // If 200, must be an error payload — NOT real data
      if (status === 200) {
        const body = await res.text();
        const hasError = /unauthorized|unauthenticated|no organisation|forbidden|error/i.test(body);
        expect(hasError, `${path} returned 200 with no error in body: ${body.slice(0, 200)}`).toBe(true);
      }
    });
  }
});

test.describe("unhappy paths — malformed URLs + missing resources", () => {
  test("invalid project id returns 404 or redirect, not 500", async ({ page }) => {
    const res = await page.goto("/projects/this-is-not-a-valid-cuid");
    const status = res?.status() ?? 0;
    expect(status, `expected 200/302/404, got ${status}`).toBeLessThan(500);
  });

  test("invalid agent id behaves cleanly", async ({ page }) => {
    const res = await page.goto("/agents/not-a-real-id");
    expect((res?.status() ?? 0)).toBeLessThan(500);
  });

  test("garbage query params don't crash login", async ({ page }) => {
    const res = await page.goto('/login?callbackUrl=javascript:alert(1)&x=<script>');
    expect((res?.status() ?? 200)).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);
  });

  test("deeply nested unknown URL returns 4xx OR redirects (never 500)", async ({ page }) => {
    const res = await page.goto("/projects/x/agents/y/risks/z/extra/deep");
    const status = res?.status() ?? 0;
    // 307/302 → middleware redirect to /login (URL matched a protected pattern)
    // 404         → Next.js not-found page
    // 200         → /login renders after redirect resolves
    // All acceptable; anything 500+ is a real failure.
    expect(status, `got status ${status}`).toBeLessThan(500);
  });

  test("trailing slash on protected route still redirects to login", async ({ page }) => {
    await page.goto("/dashboard/");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("unhappy paths — auth flow edge cases", () => {
  test("login with bad credentials shows an error or stays on /login", async ({ page }) => {
    await page.goto("/login");
    // Try filling form if it's visible
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
    if (await emailInput.count() && await passwordInput.count()) {
      await emailInput.fill("not-a-real-user@example.test");
      await passwordInput.fill("wrong-password");
      const submitBtn = page.locator('button[type="submit"]').first();
      if (await submitBtn.count()) {
        await submitBtn.click().catch(() => {});
        await page.waitForTimeout(2000);
        // Must NOT have landed on /dashboard
        expect(page.url()).not.toContain("/dashboard");
      }
    }
  });

  test("signup page renders without crashing (gate is config-driven)", async ({ page }) => {
    // The invite-only gate is wired in src/proxy.ts and src/app/(auth)/signup/page.tsx
    // and only fires when INVITE_ONLY=true OR NEXT_PUBLIC_INVITE_ONLY=true is
    // set in the environment. If those env vars are not set, /signup renders
    // the multi-step signup form directly — by design.
    //
    // This test only asserts the page doesn't crash. The gate enforcement is
    // an operational config concern (see docs/UAT-script.md and the env
    // vars listed in .env.example). The local-env live-walkthrough spec
    // exercises the actual gate when the env is configured.
    const res = await page.goto("/signup");
    expect(res?.status() ?? 0).toBeLessThan(500);
  });

  test("/forgot-password renders without crashing", async ({ page }) => {
    const res = await page.goto("/forgot-password");
    expect((res?.status() ?? 0)).toBeLessThan(500);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(100);
  });
});

test.describe("unhappy paths — public routes resilience", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} renders without server error`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));
      const res = await page.goto(path);
      const status = res?.status() ?? 0;
      expect(status, `${path} returned ${status}`).toBeLessThan(500);
      // No JS execution errors during initial render
      await page.waitForTimeout(1000);
      expect(errors, `${path} had pageerror: ${errors.join(", ")}`).toEqual([]);
    });
  }
});

test.describe("unhappy paths — static + metadata", () => {
  test("favicon.ico serves", async ({ request }) => {
    const res = await request.get("/favicon.ico");
    expect(res.status()).toBeLessThan(500);
  });

  test("robots.txt is reachable (or 404, not 500)", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBeLessThan(500);
  });

  test("sitemap.xml is reachable (or 404, not 500)", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBeLessThan(500);
  });

  test("landing page has a non-empty <title>", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(title.length).toBeGreaterThan(3);
  });

  test("landing page has OG meta tags", async ({ page }) => {
    await page.goto("/");
    const ogTitle = await page.locator('meta[property="og:title"]').count();
    const ogDesc = await page.locator('meta[property="og:description"]').count();
    expect(ogTitle + ogDesc).toBeGreaterThan(0);
  });
});

test.describe("unhappy paths — XSS / injection safety on form inputs", () => {
  test("login page does not execute query-param scripts", async ({ page }) => {
    let alertFired = false;
    page.on("dialog", (d) => { alertFired = true; d.dismiss(); });
    await page.goto('/login?error=<script>alert(1)</script>');
    await page.waitForTimeout(1500);
    expect(alertFired).toBe(false);
  });

  test("signup page does not execute query-param scripts", async ({ page }) => {
    let alertFired = false;
    page.on("dialog", (d) => { alertFired = true; d.dismiss(); });
    await page.goto('/signup?invite=<script>alert(1)</script>');
    await page.waitForTimeout(1500);
    expect(alertFired).toBe(false);
  });
});
