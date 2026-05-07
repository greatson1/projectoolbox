import { test, expect } from "@playwright/test";
import { stubLLM } from "./helpers/llm-mock";

/**
 * Golden-path smoke test — minimal user journey.
 *
 * Skipped unless E2E=1. Pre-conditions:
 *   - Next.js dev server running at BASE_URL (default localhost:3000)
 *   - Test user seeded in TEST_DATABASE_URL with cookie-based auth
 *     bypass (see tests/e2e/README.md for setup).
 *   - LLM endpoints intercepted via stubLLM() — no real API calls.
 *
 * What this test asserts:
 *   - Landing page loads
 *   - Status bar renders without conflicting with the pipeline panel
 *     (the bug from this session: banner saying "Writing documents"
 *     while pipeline said "Researching")
 *   - Documents page shows X/Y matching the methodology total when
 *     an artefact is missing (regression for the 3 vs 4 artefact bug)
 *
 * This is a SHAPE test — keep it tight, focused on the cross-surface
 * disagreements that break the user's mental model. Deep functional
 * coverage belongs in tier 2.
 */

test.describe("golden path — agent deployment lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await stubLLM(page);
  });

  test("status bar and pipeline page agree on phase status", async ({ page }) => {
    test.skip(!process.env.E2E_DEPLOYMENT_URL, "needs E2E_DEPLOYMENT_URL pointing at a seeded agent");
    const url = process.env.E2E_DEPLOYMENT_URL!;
    await page.goto(url);

    // Wait for the floating status bar (footer) to render.
    const statusBar = page.locator("[data-agent-status-bar]").first();
    await expect(statusBar).toBeVisible({ timeout: 10_000 });
    const banner = await statusBar.textContent();

    // Pipeline panel may or may not be on this page; the assertion is
    // that IF both render, their state markers align — banner shouldn't
    // say "writing" while pipeline says "researching".
    const pipelineBadge = page.locator("[data-pipeline-status-badge]").first();
    if (await pipelineBadge.count()) {
      const pipelineText = (await pipelineBadge.textContent())?.toLowerCase() || "";
      const bannerText = banner?.toLowerCase() || "";

      // If pipeline says RESEARCHING, banner must NOT say "writing".
      // If pipeline says GENERATING, banner must NOT say "researching".
      if (pipelineText.includes("researching")) {
        expect(bannerText).not.toContain("writing");
      }
      if (pipelineText.includes("generating") || pipelineText.includes("review")) {
        expect(bannerText).not.toContain("researching");
      }
    }
  });

  test("Documents page artefact total matches methodology when one is missing", async ({ page }) => {
    test.skip(!process.env.E2E_PROJECT_ID, "needs E2E_PROJECT_ID for a seeded project with missing Project Brief");
    const projectId = process.env.E2E_PROJECT_ID!;
    await page.goto(`/projects/${projectId}/artefacts`);

    // Banner copy contains "X/Y approved" — Y must be 4 for Pre-Project,
    // not 3 (the bug we fixed in commit 2c636ff).
    const banner = page.locator("[data-artefacts-banner]").first();
    await expect(banner).toBeVisible({ timeout: 10_000 });
    const text = await banner.textContent();
    expect(text).toMatch(/\d+\s*\/\s*4/);
    expect(text).not.toMatch(/3\s*\/\s*3 approved/);
  });
});
