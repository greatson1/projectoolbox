import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/reset-account
 * Wipes all agents, projects and their related data for the authenticated org.
 * Protected by session auth + a confirm token.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "RESET_ACCOUNT") {
    return NextResponse.json({ error: "Must pass confirm: 'RESET_ACCOUNT'" }, { status: 400 });
  }

  const wipAgents = body.wipAgents !== false;
  const wipProjects = body.wipProjects !== false;
  const wipActivity = body.wipActivity !== false;

  let deletedAgents: string[] = [];
  let deletedProjects: string[] = [];

  try {
    // ── 1. Wipe agents ──
    if (wipAgents) {
      const agents = await db.agent.findMany({ where: { orgId }, select: { id: true, name: true } });
      const agentIds = agents.map(a => a.id);
      if (agentIds.length > 0) {
        await db.agentJob.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        await db.agentDecision.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        await db.agentActivity.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        await db.agentArtefact.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        await db.chatMessage.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        await db.knowledgeBaseItem.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        await db.agentInboxMessage.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        await db.agentEmail.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        await db.agentDeployment.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        await db.commsLog.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
        // Null out agent FK on meetings/calendar events before deleting agents
        await db.meeting.updateMany({ where: { agentId: { in: agentIds } }, data: { agentId: null } }).catch(() => {});
        await db.calendarEvent.updateMany({ where: { agentId: { in: agentIds } }, data: { agentId: null } }).catch(() => {});
        await db.agent.deleteMany({ where: { id: { in: agentIds } } });
      }
      deletedAgents = agents.map(a => a.name);
    }

    // ── 2. Wipe projects ──
    if (wipProjects) {
      const projects = await db.project.findMany({ where: { orgId }, select: { id: true, name: true } });
      const projectIds = projects.map(p => p.id);
      if (projectIds.length > 0) {
        // Deep children first (grandchildren of project)
        await db.documentVersion.deleteMany({ where: { report: { projectId: { in: projectIds } } } }).catch(() => {});
        await db.reviewLink.deleteMany({ where: { approval: { projectId: { in: projectIds } } } }).catch(() => {});
        await db.meetingActionItem.deleteMany({ where: { meeting: { projectId: { in: projectIds } } } }).catch(() => {});

        // Direct FK children
        await db.agentDeployment.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.phase.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.costEntry.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.task.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await (db as any).sprint.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.risk.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.issue.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.approval.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.changeRequest.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.stakeholder.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.agentArtefact.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.reportSchedule.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.report.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.metricsSnapshot.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.commsLog.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.knowledgeBaseItem.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.meeting.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.calendarEvent.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.decision.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
        await db.project.deleteMany({ where: { id: { in: projectIds } } });
      }
      deletedProjects = projects.map(p => p.name);
    }

    // ── 3. Wipe activity / audit log ──
    if (wipActivity) {
      await db.auditLog.deleteMany({ where: { orgId } }).catch(() => {});
      // Notification has no orgId — delete via users belonging to this org
      await db.notification.deleteMany({ where: { user: { orgId } } }).catch(() => {});
    }

  } catch (err: any) {
    console.error("[reset-account] error:", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Reset failed" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    deleted: {
      agents: deletedAgents,
      projects: deletedProjects,
    },
  });
}
