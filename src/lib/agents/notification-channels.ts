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
        sendEmail(emails, payload, orgId).catch(e =>
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
    // 6. Automation Rules — fire matching rules via connected integrations / N8N
    fireAutomationRules(orgId, payload).catch(e =>
      console.error("[notification-channels] automation rules failed:", e)
    );
  } catch (e) {
    console.error("[notification-channels] dispatch failed:", e);
  }
}

// ─── Email via Resend ────────────────────────────────────────────────────────

async function sendEmail(recipients: string[], payload: NotificationPayload, orgId?: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY || process.env.RESEND_API_KEY_PROJECTOOLBOX;
  if (!apiKey) return;

  const urgencyBadge = payload.urgency === "critical" ? "🔴 CRITICAL"
    : payload.urgency === "high" ? "🟠 HIGH"
    : payload.urgency === "medium" ? "🟡"
    : "";

  // Sentiment-aware tone hint — check if the primary recipient is a stakeholder
  // with recent negative/concerned sentiment, and inject an HTML comment so
  // future LLM-based comms drafters can soften the tone.
  let toneHint = "";
  if (orgId && recipients[0]) {
    try {
      const recipientStakeholder = await db.stakeholder.findFirst({
        where: { email: recipients[0], project: { orgId } },
        select: { sentiment: true, name: true },
      });
      if (recipientStakeholder?.sentiment === "negative" || recipientStakeholder?.sentiment === "concerned") {
        toneHint = `\n\n<!-- Note: Recipient ${recipientStakeholder.name} has recent ${recipientStakeholder.sentiment} sentiment. Agent should use a conciliatory, careful tone. -->`;
      }
    } catch {}
  }

  const html = `${toneHint}
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

// ─── Automation Rules Engine ────────────────────────────────────────────────

/** Map notification urgency to automation rule triggers */
const URGENCY_TO_TRIGGER: Record<string, string[]> = {
  critical: ["risk_high", "budget_threshold"],
  high: ["risk_high", "approval_pending", "agent_needs_input"],
  medium: ["task_overdue", "approval_pending"],
  low: ["artefact_generated", "sprint_completed", "phase_gate_approved"],
};

/**
 * Fire all matching automation rules for this notification.
 * Checks the payload title/urgency against rule triggers and dispatches
 * via the connected integration (Slack, Teams, webhook, N8N, etc).
 */
async function fireAutomationRules(orgId: string, payload: NotificationPayload): Promise<void> {
  // Determine which triggers this notification matches
  const matchingTriggers = new Set<string>();
  const urgency = payload.urgency || "low";
  const titleLower = (payload.title || "").toLowerCase();

  // Map urgency to triggers
  for (const t of URGENCY_TO_TRIGGER[urgency] || []) matchingTriggers.add(t);

  // Also detect triggers from title keywords
  if (titleLower.includes("overdue")) matchingTriggers.add("task_overdue");
  if (titleLower.includes("risk") && (urgency === "high" || urgency === "critical")) matchingTriggers.add("risk_high");
  if (titleLower.includes("phase gate") || titleLower.includes("phase_gate")) matchingTriggers.add("phase_gate_approved");
  if (titleLower.includes("budget")) matchingTriggers.add("budget_threshold");
  if (titleLower.includes("sprint") && titleLower.includes("complet")) matchingTriggers.add("sprint_completed");
  if (titleLower.includes("artefact") || titleLower.includes("generated")) matchingTriggers.add("artefact_generated");
  if (titleLower.includes("approval") || titleLower.includes("approve")) matchingTriggers.add("approval_pending");
  if (titleLower.includes("input") || titleLower.includes("clarif")) matchingTriggers.add("agent_needs_input");

  if (matchingTriggers.size === 0) return;

  // Fetch active rules that match any of these triggers
  const rules = await db.automationRule.findMany({
    where: {
      orgId,
      isActive: true,
      trigger: { in: Array.from(matchingTriggers) },
    },
    include: { integration: true },
  });

  for (const rule of rules) {
    try {
      const config = (rule.config as any) || {};
      const integration = rule.integration;
      const integrationConfig = (integration?.config as any) || {};

      // Build the event payload for external dispatch
      const eventPayload = {
        event: rule.trigger,
        rule: rule.name,
        agent: payload.agentName,
        project: payload.projectName,
        title: payload.title,
        body: payload.body,
        urgency: payload.urgency,
        actionUrl: payload.actionUrl
          ? `${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}${payload.actionUrl}`
          : undefined,
        timestamp: new Date().toISOString(),
      };

      switch (rule.action) {
        case "send_slack": {
          const url = integrationConfig.webhookUrl || config.webhookUrl;
          if (url) await sendSlack(url, payload);
          break;
        }
        case "send_teams": {
          const url = integrationConfig.webhookUrl || config.webhookUrl;
          if (url) await sendTeamsWebhook(url, payload);
          break;
        }
        case "send_discord": {
          const url = integrationConfig.webhookUrl || config.webhookUrl;
          if (url) await sendDiscordWebhook(url, payload);
          break;
        }
        case "send_email": {
          const recipients = (config.recipients || "").split(",").map((e: string) => e.trim()).filter(Boolean);
          if (recipients.length > 0) await sendEmail(recipients, payload);
          break;
        }
        case "call_webhook":
        case "create_jira_ticket":
        case "create_calendar_event": {
          // For N8N and generic webhooks — POST the event payload
          const url = integrationConfig.webhookUrl || config.url || config.webhookUrl;
          if (url) {
            await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(eventPayload),
            });
          }
          break;
        }
      }

      // Update fire count and last fired time
      await db.automationRule.update({
        where: { id: rule.id },
        data: { fireCount: { increment: 1 }, lastFiredAt: new Date() },
      }).catch(() => {});
    } catch (e) {
      console.error(`[automation-rule] ${rule.name} (${rule.trigger} → ${rule.action}) failed:`, e);
    }
  }
}

// ─── Teams via Webhook ──────────────────────────────────────────────────────

async function sendTeamsWebhook(webhookUrl: string, payload: NotificationPayload): Promise<void> {
  const urgencyColor = payload.urgency === "critical" ? "FF0000"
    : payload.urgency === "high" ? "FF8C00"
    : payload.urgency === "medium" ? "FFD700"
    : "4F46E5";

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      "@type": "MessageCard",
      themeColor: urgencyColor,
      summary: payload.title,
      sections: [{
        activityTitle: payload.title,
        activitySubtitle: `${payload.agentName}${payload.projectName ? ` · ${payload.projectName}` : ""}`,
        text: payload.body,
      }],
      potentialAction: payload.actionUrl ? [{
        "@type": "OpenUri",
        name: "View in Projectoolbox",
        targets: [{ os: "default", uri: `${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}${payload.actionUrl}` }],
      }] : [],
    }),
  });
}

// ─── Discord via Webhook ────────────────────────────────────────────────────

async function sendDiscordWebhook(webhookUrl: string, payload: NotificationPayload): Promise<void> {
  const urgencyColor = payload.urgency === "critical" ? 0xFF0000
    : payload.urgency === "high" ? 0xFF8C00
    : payload.urgency === "medium" ? 0xFFD700
    : 0x4F46E5;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: payload.title,
        description: payload.body,
        color: urgencyColor,
        footer: { text: `${payload.agentName}${payload.projectName ? ` · ${payload.projectName}` : ""}` },
        url: payload.actionUrl
          ? `${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}${payload.actionUrl}`
          : undefined,
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}
