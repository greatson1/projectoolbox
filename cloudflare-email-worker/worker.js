/**
 * Cloudflare Email Worker — Projectoolbox Agent Email Router
 *
 * Receives emails sent to *@agents.projectoolbox.com,
 * parses them, and POSTs to the Projectoolbox inbound webhook.
 *
 * Deploy: wrangler deploy
 * Bind: Cloudflare Dashboard → Email Routing → Route to Worker
 */

import PostalMime from "postal-mime";

export default {
  async email(message, env, ctx) {
    const webhookUrl = env.WEBHOOK_URL || "https://projectoolbox.com/api/webhooks/inbound-email";
    const webhookSecret = env.WEBHOOK_SECRET || "";

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
