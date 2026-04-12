import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/agents/[id] — Agent detail
// Accepts: browser session cookie OR Authorization: Bearer ptx_live_<key>
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const agent = await db.agent.findUnique({
    where: { id },
    include: {
      deployments: {
        include: {
          project: {
            include: {
              phases: { orderBy: { order: "asc" }, select: { id: true, name: true, status: true, order: true } },
            },
          },
        },
      },
      activities: { orderBy: { createdAt: "desc" }, take: 200 },
      decisions: { orderBy: { createdAt: "desc" }, take: 50, include: { approval: true } },
      chatMessages: { orderBy: { createdAt: "desc" }, take: 5 },
      _count: { select: { activities: true, decisions: true, chatMessages: true } },
    },
  });

  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Find active deployment's projectId for cross-scoped queries
  const activeDeployment = (agent.deployments as any[]).find((d: any) => d.isActive) || agent.deployments[0];
  const projectId = activeDeployment?.projectId || null;

  // Artefact count — query by both agentId and projectId so we catch all artefacts
  const artefactWhereClause = projectId
    ? { OR: [{ agentId: id }, { projectId }] }
    : { agentId: id };
  const artefactCount = await db.agentArtefact.count({ where: artefactWhereClause });

  // Credit usage for this agent
  const creditUsage = await db.creditTransaction.aggregate({
    where: { agentId: id, type: "USAGE" },
    _sum: { amount: true },
    _count: true,
  });

  return NextResponse.json({
    data: {
      ...agent,
      artefactCount,
      creditsUsed: Math.abs(creditUsage._sum.amount || 0),
      actionCount: creditUsage._count,
    },
  });
}

// PATCH /api/agents/[id] — Update agent config
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const updated = await db.agent.update({
    where: { id },
    data: body,
  });

  await db.agentActivity.create({
    data: { agentId: id, type: "config_change", summary: `Configuration updated by ${caller.userId ? "user" : "API key"}` },
  });

  return NextResponse.json({ data: updated });
}

// DELETE /api/agents/[id] — Decommission (soft) or hard-purge agent
//
// Query params:
//   ?hard=true          — permanently deletes agent + all related data
//   ?deleteProject=true — (only with hard=true) also deletes the deployed project
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const hard = searchParams.get("hard") === "true";
  const deleteProject = searchParams.get("deleteProject") === "true";

  // ── Verify agent exists and belongs to this org ──
  const agent = await db.agent.findUnique({
    where: { id },
    select: { id: true, name: true, orgId: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (agent.orgId !== caller.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!hard) {
    // ── SOFT DECOMMISSION — archives the agent, stops all activity ──
    await db.agent.update({
      where: { id },
      data: { status: "DECOMMISSIONED", decommissionedAt: new Date() },
    });
    await db.agentDeployment.updateMany({
      where: { agentId: id },
      data: { isActive: false },
    });
    await db.agentActivity.create({
      data: { agentId: id, type: "decommissioned", summary: `Agent decommissioned via ${caller.userId ? "dashboard" : "API"}` },
    });
    return NextResponse.json({ success: true, mode: "decommissioned" });
  }

  // ── HARD PURGE — deletes everything, in FK-safe order ──
  // Collect project IDs before we delete deployments
  const deployments = await db.agentDeployment.findMany({
    where: { agentId: id },
    select: { id: true, projectId: true },
  });
  const projectIds = [...new Set(deployments.map(d => d.projectId).filter(Boolean))] as string[];

  // 1. Agent-scoped tables
  await db.agentJob.deleteMany({ where: { agentId: id } });
  await db.agentDecision.deleteMany({ where: { agentId: id } });
  await db.agentActivity.deleteMany({ where: { agentId: id } });
  await db.agentArtefact.deleteMany({ where: { agentId: id } });
  await db.chatMessage.deleteMany({ where: { agentId: id } });
  await db.knowledgeBaseItem.deleteMany({ where: { agentId: id } });
  await db.agentEmail.deleteMany({ where: { agentId: id } });
  await db.agentDeployment.deleteMany({ where: { agentId: id } });

  // 2. Delete the agent itself
  await db.agent.delete({ where: { id } });

  // 3. Optionally purge the project(s) and all project-scoped data
  const projectsDeleted: string[] = [];
  if (deleteProject && projectIds.length > 0) {
    for (const projectId of projectIds) {
      // Check no other active agents are still using this project
      const otherDeployments = await db.agentDeployment.count({
        where: { projectId, isActive: true },
      });
      if (otherDeployments > 0) continue; // Leave it — another agent owns it

      await db.phase.deleteMany({ where: { projectId } });
      await db.risk.deleteMany({ where: { projectId } });
      await db.approval.deleteMany({ where: { projectId } });
      await db.task.deleteMany({ where: { projectId } });
      await db.issue.deleteMany({ where: { projectId } });
      await db.stakeholder.deleteMany({ where: { projectId } });
      await db.changeRequest.deleteMany({ where: { projectId } });
      await db.agentArtefact.deleteMany({ where: { projectId } }); // catch any orphans
      await db.project.delete({ where: { id: projectId } });
      projectsDeleted.push(projectId);
    }
  }

  return NextResponse.json({
    success: true,
    mode: "purged",
    agentId: id,
    projectsDeleted: projectsDeleted.length,
  });
}
