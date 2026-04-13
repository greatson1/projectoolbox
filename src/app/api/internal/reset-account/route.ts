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

        // Helper: delete with logging on failure
        const del = async (table: string, fn: () => Promise<any>) => {
          try { await fn(); } catch (e: any) { console.error(`[reset] ${table}:`, e?.message?.slice(0, 80)); }
        };

        // FK ordering: unassign tasks from sprints BEFORE deleting sprints
        await del("task.sprintId→null", () => db.task.updateMany({ where: { projectId: { in: projectIds }, sprintId: { not: null } }, data: { sprintId: null } }));
        // Unlink task parent references to avoid self-referential FK issues
        await del("task.parentId→null", () => db.task.updateMany({ where: { projectId: { in: projectIds }, parentId: { not: null } }, data: { parentId: null } }));

        // Direct FK children — order: deepest dependencies first
        await del("agentDeployment", () => db.agentDeployment.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("projectMember", () => db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("sprint", () => (db as any).sprint.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("task", () => db.task.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("phase", () => db.phase.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("costEntry", () => db.costEntry.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("risk", () => db.risk.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("issue", () => db.issue.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("approval", () => db.approval.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("changeRequest", () => db.changeRequest.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("stakeholder", () => db.stakeholder.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("agentArtefact", () => db.agentArtefact.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("reportSchedule", () => db.reportSchedule.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("report", () => db.report.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("metricsSnapshot", () => db.metricsSnapshot.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("commsLog", () => db.commsLog.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("knowledgeBaseItem", () => db.knowledgeBaseItem.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("meeting", () => db.meeting.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("calendarEvent", () => db.calendarEvent.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("decision", () => db.decision.deleteMany({ where: { projectId: { in: projectIds } } }));
        await del("project", () => db.project.deleteMany({ where: { id: { in: projectIds } } }));
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
