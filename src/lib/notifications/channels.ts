/**
 * Unified Notification Dispatch
 *
 * Sends notifications to multiple channels: in-app, email, Slack.
 * Per spec Section 11.2.
 */

import { db } from "@/lib/db";

interface NotifyOptions {
  orgId: string;
  userId?: string;           // specific user, or all admins if omitted
  title: string;
  body: string;
  channels: ("in_app" | "email" | "slack")[];
  priority: "low" | "normal" | "high" | "critical";
  type?: string;             // notification type
  actionUrl?: string;
  metadata?: Record<string, any>;
}

export async function notify(opts: NotifyOptions): Promise<void> {
  const { orgId, title, body, channels, priority, type, actionUrl, metadata } = opts;

  // Determine recipients
  let userIds: string[] = [];
  if (opts.userId) {
    userIds = [opts.userId];
  } else {
    const admins = await db.user.findMany({
      where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true, email: true },
    });
    userIds = admins.map(a => a.id);
  }

  // ── In-App ──
  if (channels.includes("in_app")) {
    for (const userId of userIds) {
      await db.notification.create({
        data: {
          userId,
          type: (type || "SYSTEM") as any,
          title,
          body,
          actionUrl: actionUrl || undefined,
          metadata: metadata || undefined,
        },
      });
    }
  }

  // ── Email (for HIGH and CRITICAL only by default) ──
  if (channels.includes("email") && (priority === "high" || priority === "critical")) {
    try {
      const { EmailService } = await import("@/lib/email");
      const users = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { email: true },
      });

      for (const user of users) {
        if (!user.email) continue;
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: "Projectoolbox <noreply@projectoolbox.com>",
          to: user.email,
          subject: `[${priority.toUpperCase()}] ${title}`,
          html: `
            <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: ${priority === "critical" ? "#EF4444" : "#F59E0B"}; padding: 20px 24px; border-radius: 12px 12px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 18px;">${title}</h1>
              </div>
              <div style="padding: 24px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: 0; border-radius: 0 0 12px 12px;">
                <p style="color: #475569; font-size: 14px; line-height: 1.6;">${body}</p>
                ${actionUrl ? `<a href="https://projectoolbox.com${actionUrl}" style="display: inline-block; margin-top: 16px; background: #6366F1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">View Details</a>` : ""}
              </div>
            </div>
          `,
        });
      }
    } catch (e) {
      console.error("Email notification failed:", e);
    }
  }

  // ── Slack Webhook ──
  if (channels.includes("slack")) {
    try {
      const org = await db.organisation.findUnique({
        where: { id: orgId },
        select: { autoTopUp: true },
      });
      const slackUrl = (org?.autoTopUp as any)?.slackWebhookUrl;

      if (slackUrl) {
        const emoji = priority === "critical" ? "🚨" : priority === "high" ? "⚠️" : priority === "normal" ? "ℹ️" : "📋";
        await fetch(slackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${emoji} *${title}*\n${body}${actionUrl ? `\n<https://projectoolbox.com${actionUrl}|View in Projectoolbox>` : ""}`,
          }),
        });
      }
    } catch (e) {
      console.error("Slack notification failed:", e);
    }
  }
}
