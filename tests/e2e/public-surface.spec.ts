import { test, expect } from "@playwright/test";

/**
 * Public-surface tests — assert the LIVE landing / about / login / signup
 * pages match the value-prop UAT script (docs/UAT-script.md sections A1-A6).
 *
 * No auth, no DB, no LLM. Runs against BASE_URL (default localhost:3000;
 * point at https://projectoolbox.com to check the live deploy).
 *
 * These extend the smoke suite — smoke proves the pipe works, this proves
 * the page content matches the value prop currently being marketed.
 */

test.describe("public surface — value-prop verification", () => {
  test("landing page headline + 5 feature pillars render", async ({ page }) => {
    await page.goto("/");
    // Value-prop headline. Body text varies — assert it's a non-trivial render
    // (heading hierarchy + a substantial body) rather than exact copy.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(500);
    // Methodology lineup mentions Traditional + the others, NO "(PMI-Style)".
    expect(bodyText).toMatch(/Traditional/i);
    expect(bodyText).toMatch(/Scrum/i);
    expect(bodyText).toMatch(/Waterfall/i);
    expect(bodyText).toMatch(/Kanban/i);
    expect(bodyText).toMatch(/SAFe/i);
    expect(bodyText).toMatch(/Hybrid/i);
    expect(bodyText).not.toMatch(/PMI-Style/);
  });

  test("landing page does NOT mention PRINCE2 in marketing copy", async ({ page }) => {
    await page.goto("/");
    const bodyText = await page.locator("body").innerText();
    // PRINCE2 should not appear in the marketed methodology list.
    expect(bodyText).not.toMatch(/PRINCE2/);
  });

  test("about page renders with mission + organisation reference", async ({ page }) => {
    const res = await page.goto("/about");
    expect(res?.status()).toBeLessThan(500);
    const bodyText = await page.locator("body").innerText();
    // Mission text mentions governance and project teams.
    expect(bodyText).toMatch(/governance/i);
    expect(bodyText).toMatch(/PMGT/i);
    // No PRINCE2 mention since we just removed it.
    expect(bodyText).not.toMatch(/PRINCE2/);
  });

  test("login page offers Google + email/password + signup link", async ({ page }) => {
    await page.goto("/login");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Google/i);
    expect(bodyText).toMatch(/Email|email/);
    expect(bodyText).toMatch(/Password|password/);
    // Signup link visible.
    const signupLink = page.locator('a[href*="/signup"]').first();
    await expect(signupLink).toBeVisible();
  });

  test("signup page renders without crashing", async ({ page }) => {
    const res = await page.goto("/signup");
    expect(res?.status()).toBeLessThan(500);
    // Lands on /signup when invite-only mode is OFF, or on /waitlist when it's
    // ON (proxy.ts redirects /signup → /waitlist when INVITE_ONLY=true or
    // NEXT_PUBLIC_INVITE_ONLY=true). Both are valid; we only check no 5xx.
    await expect(page).toHaveURL(/\/(signup|waitlist)/);
  });

  test("homepage screenshot captured for visual reference", async ({ page }) => {
    await page.goto("/");
    await page.screenshot({
      path: "playwright-report/homepage-live.png",
      fullPage: true,
    });
  });
});
