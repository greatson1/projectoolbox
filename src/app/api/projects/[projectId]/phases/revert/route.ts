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

  // 5. Re-open scaffolded [artefact:X] PM tasks whose linked artefact just
  //    went DRAFT — without this they stay DONE and the PM Tracker shows
  //    "Generate Project Brief: ✓" while the actual Project Brief is back
  //    to DRAFT, which is the misalignment the user reported.
  const reopenedArtefactNames = new Set(targetArtefacts.map(a => a.name.toLowerCase()));
  let pmArtefactTasksReopened = 0;
  if (agentId && reopenedArtefactNames.size > 0) {
    const artefactTasks = await db.task.findMany({
      where: {
        projectId,
        createdBy: `agent:${agentId}`,
        description: { contains: "[artefact:" },
        OR: [{ phaseId: target.name }, { phaseId: target.id }],
      },
      select: { id: true, description: true, status: true },
    });
    const toReopen: string[] = [];
    for (const t of artefactTasks) {
      const m = (t.description || "").match(/\[artefact:([^\]]+)\]/);
      const linkedName = m ? m[1].toLowerCase() : null;
      if (linkedName && reopenedArtefactNames.has(linkedName) && t.status === "DONE") {
        toReopen.push(t.id);
      }
    }
    if (toReopen.length > 0) {
      const out = await db.task.updateMany({
        where: { id: { in: toReopen } },
        data: { status: "TODO", progress: 0 },
      }).catch(() => ({ count: 0 }));
      pmArtefactTasksReopened = out.count;
    }
  }

  // 6. Re-open [event:phase_advanced] and [event:gate_request] PM tasks
  //    for the reverted-from phases — those events have logically un-happened.
  let pmEventTasksReopened = 0;
  if (agentId && revertedPhases.length > 0) {
    const phaseIdMatches: any[] = [];
    for (const p of revertedPhases) {
      phaseIdMatches.push({ phaseId: p.name }, { phaseId: p.id });
    }
    const eventTasks = await db.task.findMany({
      where: {
        projectId,
        createdBy: `agent:${agentId}`,
        OR: phaseIdMatches,
        description: { contains: "[event:" },
        status: "DONE",
      },
      select: { id: true, description: true },
    });
    const toReopen: string[] = [];
    for (const t of eventTasks) {
      const desc = t.description || "";
      if (desc.includes("[event:phase_advanced]") || desc.includes("[event:gate_request]")) {
        toReopen.push(t.id);
      }
    }
    if (toReopen.length > 0) {
      const out = await db.task.updateMany({
        where: { id: { in: toReopen } },
        data: { status: "TODO", progress: 0 },
      }).catch(() => ({ count: 0 }));
      pmEventTasksReopened = out.count;
    }
  }

  // 7. Sweep PENDING PHASE_GATE approvals — any whose phase is no longer
  //    advance-ready (which now includes every reverted-from phase) gets
  //    auto-deferred with a clear comment.
  let gatesDeferred = 0;
  if (agentId) {
    try {
      const { sweepStalePhaseGateApprovals } = await import("@/lib/agents/phase-gate-guard");
      const sweep = await sweepStalePhaseGateApprovals(projectId, agentId);
      gatesDeferred = sweep.deferred;
    } catch (e) {
      console.error("[phase-revert] gate sweep failed:", e);
    }
  }

  // 8. End any active clarification session for the reverted-from phases.
  //    Without this the bottom banner keeps saying "Questions waiting" even
  //    though the questions belong to a phase we just walked back out of.
  let clarificationsEnded = 0;
  if (agentId) {
    try {
      const sessions = await db.knowledgeBaseItem.findMany({
        where: {
          agentId,
          projectId,
          title: "__clarification_session__",
          tags: { has: "active" },
        },
        select: { id: true, content: true, tags: true },
      });
      for (const s of sessions) {
        // Session JSON carries the artefactNames it's gathering for.
        // Treat ANY active session as belonging to the reverted-from phases
        // by default — clarification only runs in the current phase.
        await db.knowledgeBaseItem.update({
          where: { id: s.id },
          data: {
            tags: { set: (s.tags || []).filter(t => t !== "active").concat("abandoned_by_phase_reversion") },
          },
        }).catch(() => {});
        clarificationsEnded += 1;
      }
    } catch (e) {
      console.error("[phase-revert] clarification end failed:", e);
    }
  }

  // 9. Defer PENDING research-finding approvals for the reverted-from
  //    phases. Their KB rows stay where they are (already user_confirmed
  //    or pending — we don't touch trust on existing approvals).
  let researchApprovalsDeferred = 0;
  try {
    const pendingResearch = await db.approval.findMany({
      where: {
        projectId,
        type: "CHANGE_REQUEST",
        status: "PENDING",
      },
      select: { id: true, impact: true },
    });
    const revertedPhaseNames = new Set(revertedPhases.map(p => p.name.toLowerCase()));
    const toDefer: string[] = [];
    for (const a of pendingResearch) {
      const meta = (a.impact as Record<string, unknown> | null) || {};
      if (meta.subtype !== "research_finding") continue;
      const queryStr = typeof meta.query === "string" ? meta.query.toLowerCase() : "";
      // Heuristic: defer if the query label mentions one of the reverted phases.
      if ([...revertedPhaseNames].some(n => queryStr.includes(n))) {
        toDefer.push(a.id);
      }
    }
    if (toDefer.length > 0) {
      const out = await db.approval.updateMany({
        where: { id: { in: toDefer } },
        data: {
          status: "DEFERRED",
          comment: `Auto-deferred — phase reversion to ${target.name} invalidated this research bundle's phase context.`,
        },
      });
      researchApprovalsDeferred = out.count;
    }
  } catch (e) {
    console.error("[phase-revert] research approval sweep failed:", e);
  }

  // 10. Log activity
  if (agentId) {
    const sideEffects: string[] = [];
    if (targetArtefacts.length > 0) sideEffects.push(`${targetArtefacts.length} artefact(s) re-opened`);
    if (pmArtefactTasksReopened > 0) sideEffects.push(`${pmArtefactTasksReopened} PM task(s) re-opened`);
    if (pmEventTasksReopened > 0) sideEffects.push(`${pmEventTasksReopened} event task(s) re-opened`);
    if (gatesDeferred > 0) sideEffects.push(`${gatesDeferred} stale gate(s) deferred`);
    if (clarificationsEnded > 0) sideEffects.push(`${clarificationsEnded} clarification session(s) closed`);
    if (researchApprovalsDeferred > 0) sideEffects.push(`${researchApprovalsDeferred} research approval(s) deferred`);
    await db.agentActivity.create({
      data: {
        agentId,
        type: "document",
        summary: `Phase reverted: ${current.name} → ${target.name}. Reason: ${reason}. ${sideEffects.join(" · ") || "no side effects"}.`,
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
