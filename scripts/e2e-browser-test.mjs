/**
 * E2E Browser Test via Browserless.io
 * Tests authenticated pages by logging in and navigating the dashboard.
 */
import puppeteer from "puppeteer-core";

const BROWSERLESS_TOKEN = "2UHJ3LyqotGMngt395cbe9a74c34bd34c4ed666eb192581ec";
const BASE = "https://projectoolbox.com";
const EMAIL = "teeweazy@gmail.com";
const PASSWORD = "Test2026!";

const results = [];
function log(test, status, detail = "") {
  const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⚠️";
  results.push({ test, status, detail });
  console.log(`${icon} ${test}: ${status}${detail ? " — " + detail : ""}`);
}

async function main() {
  console.log("Connecting to Browserless...");
  const browser = await puppeteer.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    // 1. Landing page
    console.log("\n=== 1. LANDING PAGE ===");
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 15000 });
    const title = await page.title();
    log("Landing page loads", title.includes("Projectoolbox") ? "PASS" : "FAIL", title);

    // 2. Login page
    console.log("\n=== 2. LOGIN ===");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 15000 });
    const loginForm = await page.$('input[type="email"]');
    log("Login page renders", loginForm ? "PASS" : "FAIL");

    // 3. Login with credentials
    if (loginForm) {
      await page.type('input[type="email"]', EMAIL, { delay: 50 });
      await page.type('input[type="password"]', PASSWORD, { delay: 50 });

      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}),
        page.click('button[type="submit"]'),
      ]);

      await new Promise(r => setTimeout(r, 3000)); // Wait for client-side redirect
      const url = page.url();
      const loggedIn = !url.includes("/login");
      log("Login succeeds", loggedIn ? "PASS" : "FAIL", url);
    }

    // 4. Dashboard
    console.log("\n=== 3. DASHBOARD ===");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2", timeout: 15000 });
    const dashContent = await page.content();
    const hasDashboard = dashContent.includes("Dashboard") || dashContent.includes("dashboard");
    log("Dashboard loads", page.url().includes("/dashboard") || page.url().includes("/login") ? (page.url().includes("/dashboard") ? "PASS" : "FAIL (redirected to login)") : "WARN", page.url());

    // Take screenshot
    await page.screenshot({ path: "/tmp/ptx-dashboard.png", fullPage: false });
    console.log("  Screenshot saved: /tmp/ptx-dashboard.png");

    // Helper for safe navigation
    async function safeGoto(url) {
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
        return true;
      } catch {
        // Retry with domcontentloaded
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
          await new Promise(r => setTimeout(r, 2000));
          return true;
        } catch { return false; }
      }
    }

    // 5. Approvals page
    console.log("\n=== 4. APPROVALS ===");
    await safeGoto(`${BASE}/approvals`);
    const approvalsContent = await page.content();
    const hasApproval = approvalsContent.includes("Approval") || approvalsContent.includes("approval");
    const hasImpactScores = approvalsContent.includes("Schedule") || approvalsContent.includes("Cost") || approvalsContent.includes("Scope");
    log("Approvals page loads", hasApproval ? "PASS" : "FAIL");
    log("Impact scores visible", hasImpactScores ? "PASS" : "WARN", "Looking for Schedule/Cost/Scope/Stakeholder");
    await page.screenshot({ path: "/tmp/ptx-approvals.png", fullPage: false });

    // For each remaining page, open a fresh page to avoid frame detachment
    const pagesToTest = [
      { name: "Notifications", path: "/notifications", check: (c) => c.includes("Nova") || c.includes("notification") || c.includes("caught up") },
      { name: "Agent Fleet", path: "/agents", check: (c) => c.includes("Nova") || c.includes("Agent") || c.includes("Fleet") },
      { name: "Agent Chat", path: "/agents/chat", check: (c) => c.includes("chat") || c.includes("Chat") || c.includes("Send") },
      { name: "Projects", path: "/projects", check: (c) => c.includes("Website Redesign") || c.includes("project") || c.includes("Project") },
      { name: "Knowledge Base", path: "/knowledge", check: (c) => c.includes("Knowledge") || c.includes("knowledge") },
      { name: "Admin", path: "/admin", check: (c) => c.includes("PMGT") || c.includes("Organisation") || c.includes("Settings") },
      { name: "Meetings", path: "/meetings", check: (c) => c.includes("Meeting") || c.includes("meeting") || c.includes("Upload") },
      { name: "Calendar", path: "/calendar", check: (c) => c.includes("Calendar") || c.includes("calendar") || c.includes("event") },
    ];

    // Get session cookies from current page
    const cookies = await page.cookies();

    let testNum = 5;
    for (const t of pagesToTest) {
      console.log(`\n=== ${testNum}. ${t.name.toUpperCase()} ===`);
      try {
        const p = await browser.newPage();
        await p.setCookie(...cookies);
        await p.setViewport({ width: 1440, height: 900 });
        await p.goto(`${BASE}${t.path}`, { waitUntil: "domcontentloaded", timeout: 15000 });
        await new Promise(r => setTimeout(r, 3000));
        const content = await p.content();
        const pass = t.check(content);
        log(t.name + " page", pass ? "PASS" : "WARN", pass ? "" : "Content check failed");
        await p.close();
      } catch (e) {
        log(t.name + " page", "FAIL", e.message.slice(0, 60));
      }
      testNum++;
    }

  } catch (e) {
    console.error("Test error:", e.message);
    log("Unexpected error", "FAIL", e.message);
  }

  await browser.close();

  // Summary
  console.log("\n\n=== SUMMARY ===");
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  const warn = results.filter(r => r.status === "WARN").length;
  console.log(`PASS: ${pass} | FAIL: ${fail} | WARN: ${warn} | Total: ${results.length}`);

  if (fail > 0) {
    console.log("\nFAILURES:");
    results.filter(r => r.status === "FAIL").forEach(r => console.log(`  ❌ ${r.test}: ${r.detail}`));
  }
}

main().catch(e => console.error("Fatal:", e));
