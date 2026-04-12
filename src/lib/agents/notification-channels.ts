/**
 * Notification Channel Dispatcher
 *
 * Routes agent notifications to the user's configured channels:
 * - In-app (always on — db.notification)
 * - Email (via Resend)
 * - Slack (via webhook URL)
 * - Telegram (via Bot API)
 *
 * Channels are configured per-deployment and can be updated anytime
 * from the Agent Configuration tab (not just during deploy).
 */

import { db } from "@/lib/db";

interface NotificationPayload {
  agentId: string;
  agentName: string;
  projectName?: string;
  title: string;
  body: string;
  actionUrl?: string;
  urgency?: "low" | "medium" | "high" | "critical";
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

/**
 * Send a notification through all configured channels.
 * Always creates an in-app notification. Optionally sends email/slack/telegram.
 * Non-blocking — errors in external channels don't affect in-app delivery.
 */
export async function dispatchNotification(
  orgId: string,
  payload: NotificationPayload,
): Promise<void> {
  // 1. Always create in-app notification for all org admins
  try {
    const admins = await db.user.findMany({
      where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true, email: true },
    });
    for (const admin of admins) {
      await db.notification.create({
        data: {
          userId: admin.id,
          type: "AGENT_ALERT",
          title: payload.title,
          body: payload.body,
          actionUrl: payload.actionUrl || `/agents/${payload.agentId}`,
          metadata: { agentId: payload.agentId, urgency: payload.urgency } as any,
        },
      }).catch(() => {});
    }

    // 2. Get deployment config for channel settings
    const deployment = await db.agentDeployment.findFirst({
      where: { agentId: payload.agentId, isActive: true },
      select: { config: true },
    });
    const config = (deployment?.config as any) || {};

    // 3. Email — send to all org admins if enabled
    if (config.notifEmail) {
      const emails = admins.map(a => a.email).filter(Boolean) as string[];
      if (emails.length > 0) {
        sendEmail(emails, payload).catch(e =>
          console.error("[notification-channels] email failed:", e)
        );
      }
    }

    // 4. Slack — post to webhook if configured
    if (config.notifSlack && config.slackWebhookUrl) {
      sendSlack(config.slackWebhookUrl, payload).catch(e =>
        console.error("[notification-channels] slack failed:", e)
      );
    }

    // 5. Telegram — send via bot if configured
    if (config.notifTelegram && config.telegramBotToken && config.telegramChatId) {
      sendTelegram(config.telegramBotToken, config.telegramChatId, payload).catch(e =>
        console.error("[notification-channels] telegram failed:", e)
      );
    }
  } catch (e) {
    console.error("[notification-channels] dispatch failed:", e);
  }
}

// ─── Email via Resend ────────────────────────────────────────────────────────

async function sendEmail(recipients: string[], payload: NotificationPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY || process.env.RESEND_API_KEY_PROJECTOOLBOX;
  if (!apiKey) return;

  const urgencyBadge = payload.urgency === "critical" ? "🔴 CRITICAL"
    : payload.urgency === "high" ? "🟠 HIGH"
    : payload.urgency === "medium" ? "🟡"
    : "";

  const html = `
    <div style="font-family: 'Segoe UI', Calibri, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1e3a5f, #4f46e5); padding: 24px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; font-size: 18px; margin: 0;">Projectoolbox</h1>
        <p style="color: rgba(255,255,255,0.7); font-size: 12px; margin: 4px 0 0;">Agent Notification</p>
      </div>
      <div style="background: #f8fafc; padding: 24px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="font-size: 11px; color: #6b7280; margin: 0 0 8px;">
          ${urgencyBadge} From <strong>${payload.agentName}</strong>${payload.projectName ? ` · ${payload.projectName}` : ""}
        </p>
        <h2 style="font-size: 16px; color: #1a1a2e; margin: 0 0 12px;">${payload.title}</h2>
        <p style="font-size: 14px; color: #374151; line-height: 1.6; margin: 0 0 20px;">${payload.body}</p>
        ${payload.actionUrl ? `
          <a href="${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}${payload.actionUrl}"
            style="display: inline-block; background: #4f46e5; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">
            View in Projectoolbox →
          </a>
        ` : ""}
        <p style="font-size: 11px; color: #9ca3af; margin: 20px 0 0; border-top: 1px solid #e2e8f0; padding-top: 12px;">
          You're receiving this because you have email notifications enabled for this agent.
          <a href="${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}/agents/${payload.agentId}?tab=configuration" style="color: #4f46e5;">Manage preferences</a>
        </p>
      </div>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Projectoolbox <notifications@projectoolbox.com>",
      to: recipients,
      subject: `${urgencyBadge ? urgencyBadge + " " : ""}${payload.agentName}: ${payload.title}`,
      html,
    }),
  });
}

// ─── Slack via Webhook ───────────────────────────────────────────────────────

async function sendSlack(webhookUrl: string, payload: NotificationPayload): Promise<void> {
  const urgencyEmoji = payload.urgency === "critical" ? ":red_circle:"
    : payload.urgency === "high" ? ":large_orange_circle:"
    : ":large_blue_circle:";

  const actionUrl = payload.actionUrl
    ? `${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}${payload.actionUrl}`
    : "";

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${urgencyEmoji} *${payload.title}*\n_${payload.agentName}${payload.projectName ? ` · ${payload.projectName}` : ""}_\n\n${payload.body}`,
          },
        },
        ...(actionUrl ? [{
          type: "actions",
          elements: [{
            type: "button",
            text: { type: "plain_text", text: "View in Projectoolbox" },
            url: actionUrl,
            style: "primary",
          }],
        }] : []),
      ],
    }),
  });
}

// ─── Telegram via Bot API ────────────────────────────────────────────────────

async function sendTelegram(botToken: string, chatId: string, payload: NotificationPayload): Promise<void> {
  const urgencyIcon = payload.urgency === "critical" ? "🔴"
    : payload.urgency === "high" ? "🟠"
    : payload.urgency === "medium" ? "🟡"
    : "🔵";

  const actionUrl = payload.actionUrl
    ? `${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}${payload.actionUrl}`
    : "";

  const text = [
    `${urgencyIcon} *${payload.title}*`,
    `_${payload.agentName}${payload.projectName ? ` · ${payload.projectName}` : ""}_`,
    "",
    payload.body,
    ...(actionUrl ? ["", `[View in Projectoolbox](${actionUrl})`] : []),
  ].join("\n");

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}
