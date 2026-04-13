import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects/[projectId]/phases/revert
 *
 * Reverts the project to a previous phase. This is a governance action:
 * - Creates a Change Request documenting why
 * - Creates an Approval record (HITL — requires sign-off)
 * - On approval: reverts phases, re-opens artefacts, logs activity
 *
 * Body: { targetPhase: string, reason: string, immediate?: boolean }
 * - targetPhase: name of the phase to revert TO
 * - reason: why the reversion is needed
 * - immediate: if true, revert immediately without approval (for admins)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();
  const { targetPhase, reason, immediate } = body;

  if (!targetPhase || !reason) {
    return NextResponse.json({ error: "targetPhase and reason are required" }, { status: 400 });
  }

  // Load project phases
  const phases = await db.phase.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });

  const currentPhase = phases.find(p => p.status === "ACTIVE");
  const target = phases.find(p => p.name === targetPhase);

  if (!currentPhase) return NextResponse.json({ error: "No active phase found" }, { status: 400 });
  if (!target) return NextResponse.json({ error: `Phase "${targetPhase}" not found` }, { status: 404 });
  if (target.order >= currentPhase.order) {
    return NextResponse.json({ error: "Can only revert to a previous phase" }, { status: 400 });
  }

  // Get deployment and agent
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    include: { agent: { select: { id: true, name: true, orgId: true } } },
  });

  const orgId = (session.user as any).orgId || deployment?.agent?.orgId;
  const agentId = deployment?.agentId;
  const agentName = deployment?.agent?.name || "Agent";

  // Phases that will be reverted (everything between target and current, inclusive of current)
  const revertedPhases = phases.filter(p => p.order > target.order && p.order <= currentPhase.order);
  const revertedNames = revertedPhases.map(p => p.name);

  if (immediate) {
    // Admin override — revert immediately
    await executeReversion(projectId, target, currentPhase, revertedPhases, phases, agentId, agentName, reason, deployment?.id);

    return NextResponse.json({
      data: {
        reverted: true,
        from: currentPhase.name,
        to: target.name,
        phasesReverted: revertedNames,
      },
    });
  }

  // Normal flow: create Change Request + Approval for HITL governance
  const cr = await db.changeRequest.create({
    data: {
      projectId,
      title: `Phase Reversion: ${currentPhase.name} → ${target.name}`,
      description: `**Reason:** ${reason}\n\n**Current Phase:** ${currentPhase.name}\n**Revert To:** ${target.name}\n**Phases Affected:** ${revertedNames.join(", ")}\n\nThis will re-open artefacts in the ${target.name} phase for revision and pause all work in later phases.`,
      status: "SUBMITTED",
      requestedBy: (session.user as any).id,
      impact: {
        type: "PHASE_REVERSION",
        from: currentPhase.name,
        to: target.name,
        revertedPhases: revertedNames,
        reason,
      } as any,
    },
  });

  const approval = await db.approval.create({
    data: {
      projectId,
      requestedById: agentId || (session.user as any).id,
      type: "SCOPE_CHANGE",
      title: `Phase Reversion: ${currentPhase.name} → ${target.name}`,
      description: `Requested by ${(session.user as any).name || "user"}. Reason: ${reason}. This will revert ${revertedNames.length} phase(s) and re-open artefacts for revision.`,
      status: "PENDING",
      urgency: "HIGH",
      impactScores: { schedule: 3, cost: 2, scope: 3, stakeholder: 2 } as any,
      reasoningChain: reason,
      affectedItems: revertedPhases.map(p => ({
        type: "phase",
        id: p.id,
        title: p.name,
        field: "status",
        from: p.status,
        to: p.order === target.order ? "ACTIVE" : "REVERTED",
      })) as any,
    },
  });

  // Log activity
  if (agentId) {
    await db.agentActivity.create({
      data: {
        agentId,
        type: "approval",
        summary: `Phase reversion requested: ${currentPhase.name} → ${target.name}. Reason: ${reason}. Awaiting approval.`,
      },
    }).catch(() => {});
  }

  // Notify admins
  if (orgId) {
    const admins = await db.user.findMany({
      where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true },
    });
    for (const admin of admins) {
      await db.notification.create({
        data: {
          userId: admin.id,
          type: "AGENT_ALERT",
          title: `Phase Reversion Requested`,
          body: `${currentPhase.name} → ${target.name}: ${reason}`,
          actionUrl: "/approvals",
        },
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    data: {
      reverted: false,
      pendingApproval: true,
      approvalId: approval.id,
      changeRequestId: cr.id,
      from: currentPhase.name,
      to: target.name,
    },
  });
}

// ─── Execute the actual reversion ────────────────────────────────────────────

async function executeReversion(
  projectId: string,
  target: any,
  current: any,
  revertedPhases: any[],
  allPhases: any[],
  agentId: string | null | undefined,
  agentName: string,
  reason: string,
  deploymentId: string | null | undefined,
) {
  // 1. Set target phase to ACTIVE
  await db.phase.update({
    where: { id: target.id },
    data: { status: "ACTIVE" },
  });

  // 2. Set current and intermediate phases to REVERTED
  for (const phase of revertedPhases) {
    await db.phase.update({
      where: { id: phase.id },
      data: { status: "REVERTED" as any },
    });
  }

  // 3. Update deployment
  if (deploymentId) {
    await db.agentDeployment.update({
      where: { id: deploymentId },
      data: {
        currentPhase: target.name,
        phaseStatus: "active",
      },
    });
  }

  // 4. Re-open artefacts in the target phase (APPROVED → DRAFT for revision)
  const targetArtefacts = await db.agentArtefact.findMany({
    where: {
      projectId,
      OR: [
        { phaseId: target.name },
        { phaseId: target.id },
      ],
    },
  });
  for (const art of targetArtefacts) {
    await db.agentArtefact.update({
      where: { id: art.id },
      data: { status: "DRAFT", feedback: `Re-opened for revision due to phase reversion: ${reason}` },
    });
  }

  // 5. Log activity
  if (agentId) {
    await db.agentActivity.create({
      data: {
        agentId,
        type: "document",
        summary: `Phase reverted: ${current.name} → ${target.name}. Reason: ${reason}. ${targetArtefacts.length} artefact(s) re-opened for revision.`,
      },
    }).catch(() => {});

    // Post to agent chat
    await db.chatMessage.create({
      data: {
        agentId,
        role: "agent",
        content: `**Phase Reversion Executed**\n\nReverted from **${current.name}** back to **${target.name}**.\n\n**Reason:** ${reason}\n\n**What happened:**\n- ${target.name} phase is now ACTIVE again\n- ${targetArtefacts.length} artefact(s) have been re-opened as DRAFT for your revision\n- Phases ${revertedPhases.map(p => p.name).join(", ")} are paused\n\nPlease review and update the artefacts, then approve them to proceed again.\n\n[Review Artefacts](/projects/${projectId}/artefacts)`,
      },
    }).catch(() => {});
  }
}

// ─── Hook: execute reversion when approval is granted ────────────────────────
// This is exported so the approval handler can call it

export async function executePhaseReversion(approvalId: string): Promise<void> {
  const approval = await db.approval.findUnique({
    where: { id: approvalId },
    include: { project: true },
  });
  if (!approval) return;

  const impact = approval.impact as any;
  if (!impact?.type || impact.type !== "PHASE_REVERSION") return;

  const projectId = approval.projectId;
  const phases = await db.phase.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });

  const target = phases.find(p => p.name === impact.to);
  const current = phases.find(p => p.name === impact.from);
  if (!target || !current) return;

  const revertedPhases = phases.filter(p => p.order > target.order && p.order <= current.order);

  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    include: { agent: { select: { id: true, name: true } } },
  });

  await executeReversion(
    projectId, target, current, revertedPhases, phases,
    deployment?.agentId, deployment?.agent?.name || "Agent",
    impact.reason || "Approved phase reversion",
    deployment?.id,
  );
}
