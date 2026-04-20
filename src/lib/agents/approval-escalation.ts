import { db } from "@/lib/db";
import { isN8nEnabled, forwardToN8n } from "@/lib/n8n";

const REMINDER_HOURS = 4;
const ESCALATION_HOURS = 24;

export async function checkApprovalTimeouts() {
  // ── n8n forwarding gate ──────────────────────────────────────────
  if (await isN8nEnabled("approval_escalation")) {
    const pending = await db.approval.findMany({
      where: { status: "PENDING" },
      select: { id: true, title: true, type: true, createdAt: true, projectId: true, project: { select: { orgId: true, name: true } } },
    });
    if (pending.length > 0) {
      const forwarded = await forwardToN8n("approval_escalation", {
        pendingApprovals: pending.map((a) => ({
          id: a.id,
          title: a.title,
          type: a.type,
          projectName: a.project?.name,
          orgId: a.project?.orgId,
          hoursWaiting: Math.floor((Date.now() - a.createdAt.getTime()) / 3600000),
        })),
      });
      if (forwarded) return { reminders: 0, escalations: 0, overdue: pending.length, forwardedToN8n: true };
    }
  }

  const now = new Date();
  let reminders = 0, escalations = 0, overdue = 0;

  const pending = await db.approval.findMany({
    where: { status: "PENDING" },
    include: { project: { select: { orgId: true, name: true } } },
  });

  for (const a of pending) {
    const hours = (now.getTime() - a.createdAt.getTime()) / 3600000;
    const orgId = a.project?.orgId;
    if (!orgId || hours < REMINDER_HOURS) continue;
    overdue++;

    const recent = await db.notification.findFirst({
      where: { type: "APPROVAL_REQUEST", createdAt: { gt: new Date(now.getTime() - REMINDER_HOURS * 3600000) }, title: { contains: a.title.slice(0, 20) } },
    });
    if (!recent) {
      const users = await db.user.findMany({ where: { orgId }, select: { id: true } });
      for (const u of users) {
        await db.notification.create({ data: { userId: u.id, type: "APPROVAL_REQUEST", title: "Approval pending: " + a.title, body: "Waiting " + Math.floor(hours) + "h. Agent paused until reviewed.", actionUrl: "/approvals" } });
      }
      reminders++;
    }

    if (hours > ESCALATION_HOURS) {
      const emailed = await db.auditLog.findFirst({ where: { orgId, action: "APPROVAL_EMAIL_ESCALATION", target: a.id, createdAt: { gt: new Date(now.getTime() - ESCALATION_HOURS * 3600000) } } });
      if (!emailed) {
        const org = await db.organisation.findUnique({ where: { id: orgId }, select: { billingEmail: true } });
        if (org?.billingEmail && process.env.RESEND_API_KEY) {
          try {
            await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: "Projectoolbox <notifications@projectoolbox.com>", to: org.billingEmail, subject: "Action Required: " + a.title + " pending " + Math.floor(hours) + "h", html: "<h2>Approval Blocked</h2><p>" + a.title + " has been pending " + Math.floor(hours) + " hours.</p><p><a href='https://projectoolbox.com/approvals'>Review Now</a></p>" }) });
            await db.auditLog.create({ data: { orgId, action: "APPROVAL_EMAIL_ESCALATION", target: a.id } });
            escalations++;
          } catch {}
        }
      }
    }
  }

  // Credit warnings
  const orgs = await db.organisation.findMany({ select: { id: true, creditBalance: true, plan: true } });
  const alloc: Record<string, number> = { FREE: 1000, STARTER: 5000, PROFESSIONAL: 20000, BUSINESS: 60000, ENTERPRISE: 200000 };
  for (const org of orgs) {
    const pct = (org.creditBalance / (alloc[org.plan] || 5000)) * 100;
    if (pct < 20) {
      const recent = await db.notification.findFirst({ where: { type: "BILLING", createdAt: { gt: new Date(now.getTime() - 86400000) }, user: { orgId: org.id } } });
      if (!recent) {
        const users = await db.user.findMany({ where: { orgId: org.id }, select: { id: true } });
        for (const u of users) {
          await db.notification.create({ data: { userId: u.id, type: "BILLING", title: (pct < 5 ? "CRITICAL" : "Low") + " credits: " + Math.floor(pct) + "% remaining", body: org.creditBalance.toLocaleString() + " credits left. Top up to avoid interruption.", actionUrl: "/billing/credits" } });
        }
      }
    }
  }

  return { reminders, escalations, overdue };
}
