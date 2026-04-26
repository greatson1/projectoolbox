#!/usr/bin/env node
/**
 * Smoke-test the inbound-email webhook end-to-end without sending a real
 * email. Posts a synthetic payload identical to what the Cloudflare
 * Email Worker would forward and reports whether it landed.
 *
 * Run AFTER:
 *   1. Vercel has deployed the latest code
 *   2. Cloudflare Email Worker is deployed (wrangler deploy)
 *   3. Email Routing catch-all rule is set to the worker
 *
 * Usage:
 *   node scripts/verify-inbound-email.mjs <agent-email>
 *   # e.g. node scripts/verify-inbound-email.mjs iris.acme@agents.projectoolbox.com
 *
 * If you set INBOUND_EMAIL_SECRET in Vercel, also export it locally:
 *   INBOUND_EMAIL_SECRET=... node scripts/verify-inbound-email.mjs ...
 */

const target = process.argv[2];
if (!target || !target.includes("@")) {
  console.error("Usage: node scripts/verify-inbound-email.mjs <agent-email>");
  console.error('Example: node scripts/verify-inbound-email.mjs iris.acme@agents.projectoolbox.com');
  process.exit(1);
}

const url = process.env.WEBHOOK_URL || "https://projectoolbox.com/api/webhooks/inbound-email";
const secret = process.env.INBOUND_EMAIL_SECRET;

const payload = {
  from: "verify-script@projectoolbox.test",
  to: target,
  subject: "Inbound webhook verification — " + new Date().toISOString(),
  text: "This is a synthetic test from scripts/verify-inbound-email.mjs.\n\nIf you see this in the agent's Inbox tab and a verification card in the Chat tab, the inbound pipeline is fully wired.",
  _source: "verify-script",
};

console.log(`POST ${url}`);
console.log(`  to: ${target}`);
console.log(`  secret: ${secret ? "set" : "not set"}\n`);

try {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-webhook-secret": secret } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = body; }

  console.log(`Response: ${res.status} ${res.statusText}`);
  console.log(parsed);

  if (res.status === 401) {
    console.error("\n❌ 401 — webhook is rejecting the secret. Either unset INBOUND_EMAIL_SECRET on Vercel, or pass the same value here.");
    process.exit(1);
  }
  if (res.status === 400) {
    console.error("\n❌ 400 — webhook accepted the request but rejected the payload. Check 'to' matches a real agent address.");
    process.exit(1);
  }
  if (!res.ok) {
    console.error("\n❌ Webhook returned non-OK status. Check Vercel function logs.");
    process.exit(1);
  }

  console.log("\n✅ Webhook accepted the payload. Now check:");
  console.log("   - Iris page → Inbox tab (should show a new row)");
  console.log("   - Iris page → Chat tab (should show '📧 New email — please verify')");
  console.log("   - If both appear, the in-app pipeline is correct.");
  console.log("   - Once the Cloudflare Email Worker is live, real emails will follow the same path.");
} catch (e) {
  console.error("\n❌ Request failed:", e.message);
  process.exit(1);
}