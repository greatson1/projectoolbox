/**
 * Cloudflare Email Worker — Projectoolbox Agent Email Router
 *
 * Acts as the zone-wide catch-all for projectoolbox.com:
 *   - Mail to *@agents.projectoolbox.com → POST to inbound-email webhook
 *     (the Vercel-hosted Next.js app stores it in the right agent's inbox
 *     and posts a verification card to the chat).
 *   - All other mail → message.forward(env.FORWARD_TO) to preserve the
 *     previous "catch-all forwards to Gmail" behaviour without needing a
 *     separate Cloudflare routing rule.
 *
 * Deploy: GitHub Action (.github/workflows/deploy-email-worker.yml) or
 * locally via `wrangler deploy`.
 *
 * Routing: in Cloudflare → Email → Email Routing → Catch-all → Worker →
 * projectoolbox-email-worker.
 */

import PostalMime from "postal-mime";

const AGENT_DOMAIN_SUFFIX = "@agents.projectoolbox.com";

export default {
  async email(message, env, ctx) {
    const webhookUrl = env.WEBHOOK_URL || "https://projectoolbox.com/api/webhooks/inbound-email";
    const webhookSecret = env.WEBHOOK_SECRET || "";
    const forwardTo = env.FORWARD_TO || "pmgtsolutionsuk@gmail.com";

    // Discriminate by recipient. Mail addressed to the agent subdomain is
    // app-handled; everything else preserves the prior Gmail-forward
    // behaviour so the existing inbox isn't silently broken when this
    // worker becomes the zone catch-all.
    const recipient = (message.to || "").toLowerCase();
    const isAgentMail = recipient.endsWith(AGENT_DOMAIN_SUFFIX);

    if (!isAgentMail) {
      try {
        await message.forward(forwardTo);
        return;
      } catch (e) {
        console.error(`forward-to-${forwardTo} failed:`, e);
        // Fall through — we prefer to drop than to bounce.
        return;
      }
    }

    try {
      // Read the raw email stream
      const rawEmail = await streamToArrayBuffer(message.raw, message.rawSize);
      const parser = new PostalMime();
      const parsed = await parser.parse(rawEmail);

      // Build webhook payload
      const payload = {
        from: message.from,
        to: message.to,
        subject: parsed.subject || "(no subject)",
        text: parsed.text || "",
        html: parsed.html || "",
        date: parsed.date,
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        headers: Object.fromEntries(
          (parsed.headers || []).map(h => [h.key, h.value])
        ),
        attachments: (parsed.attachments || []).map(a => ({
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.content?.byteLength || 0,
        })),
        // Cloudflare metadata
        _source: "cloudflare-email-worker",
        _rawSize: message.rawSize,
      };

      // POST to Projectoolbox webhook
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(webhookSecret && { "x-webhook-secret": webhookSecret }),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Webhook returned ${response.status}: ${await response.text()}`);
        // Don't reject — email was received, just processing failed
      }
    } catch (error) {
      console.error("Email Worker error:", error);
      // Don't reject the email — it was received successfully
    }
  },
};

async function streamToArrayBuffer(stream, streamSize) {
  const result = new Uint8Array(streamSize);
  let offset = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}
