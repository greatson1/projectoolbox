/**
 * Approval Timeout & Escalation
 *
 * Called from the cron tick. Checks all PENDING approvals against their
 * escalation timeout and creates reminder/urgent notifications.
 *
 * Timeline per spec Section 4.4:
 *   50% of timeout → reminder notification
 *   100% of timeout → URGENT escalation notification
 *   150% of timeout → OVERDUE flag (no auto-approve — safety design)
 */

import { db } from "@/lib/db";

export async function checkApprovalTimeouts(): Promise<{ reminders: number; escalations: number; overdue: number }> {
  const now = new Date();
  let reminders = 0;
  let escalations = 0;
  let overdue = 0;

  // Get all PENDING approvals that have an expiresAt set
  const pendingApprovals = await db.approval.findMany({
    where: {
      status: "PENDING",
      expiresAt: { not: null },
    },
    include: {
      project: { select: { orgId: true, name: true } },
      decision: { include: { agent: { select: { name: true } } } },
    },
  });

  for (const approval of pendingApprovals) {
    if (!approval.expiresAt) continue;

    const createdAt = approval.createdAt.getTime();
    const expiresAt = approval.expiresAt.getTime();
    const totalWindow = expiresAt - createdAt;
    const elapsed = now.getTime() - createdAt;
    const pctElapsed = elapsed / totalWindow;

    const orgId = approval.project.orgId;
    const agentName = approval.decision?.agent?.name || "Agent";

    // Get admins for notifications
    const admins = await db.user.findMany({
      where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true },
    });

    // Check if we already sent this type of notification
    const alreadySent = async (keyword: string) => {
      const count = await db.notification.count({
        where: {
          title: { contains: keyword },
          metadata: { path: ["approvalId"], equals: approval.id },
          createdAt: { gte: approval.createdAt },
        },
      });
      return count > 0;
    };

    if (pctElapsed >= 1.5) {
      // OVERDUE (150%)
      if (!(await alreadySent("OVERDUE"))) {
        for (const admin of admins) {
          await db.notification.create({
            data: {
              userId: admin.id,
              type: "APPROVAL_REQUEST",
              title: `OVERDUE: ${approval.title}`,
              body: `${agentName}'s request has been waiting ${Math.round(elapsed / 3600000)}h. The agent cannot proceed without your decision.`,
              actionUrl: "/approvals",
              metadata: { approvalId: approval.id, escalation: "overdue" },
            },
          });
        }
        overdue++;
      }
    } else if (pctElapsed >= 1.0) {
      // URGENT (100%)
      if (!(await alreadySent("URGENT"))) {
        for (const admin of admins) {
          await db.notification.create({
            data: {
              userId: admin.id,
              type: "APPROVAL_REQUEST",
              title: `URGENT: ${approval.title} needs your decision`,
              body: `${agentName} on ${approval.project.name} has been waiting for approval. Escalation timeout reached.`,
              actionUrl: "/approvals",
              metadata: { approvalId: approval.id, escalation: "urgent" },
            },
          });
        }
        escalations++;
      }
    } else if (pctElapsed >= 0.5) {
      // Reminder (50%)
      if (!(await alreadySent("Reminder"))) {
        for (const admin of admins) {
          await db.notification.create({
            data: {
              userId: admin.id,
              type: "APPROVAL_REQUEST",
              title: `Reminder: ${approval.title} awaiting approval`,
              body: `${agentName} submitted this ${Math.round(elapsed / 3600000)}h ago. ${Math.round((expiresAt - now.getTime()) / 3600000)}h until escalation.`,
              actionUrl: "/approvals",
              metadata: { approvalId: approval.id, escalation: "reminder" },
            },
          });
        }
        reminders++;
      }
    }
  }

  return { reminders, escalations, overdue };
}
