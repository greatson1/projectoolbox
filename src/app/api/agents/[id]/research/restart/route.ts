import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // research fans out multiple Perplexity/Claude calls

/**
 * POST /api/agents/:id/research/restart — recover a stalled phase research.
 *
 * Phase research runs inline during deploy/phase-advance. If that process
 * dies mid-run (server restart, upstream API failure), the deployment is
 * stranded at phaseStatus="researching", which hard-blocks artefact
 * generation with no user-visible way out. This endpoint re-runs the same
 * research the advance would have run, then moves phaseStatus forward:
 *   - research produced approval bundles → "awaiting_research_approval"
 *   - otherwise → research marked complete, phaseStatus "active"
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string | undefined;
  const { id: agentId } = await params;

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    include: { project: { select: { id: true, name: true, orgId: true } } },
  });
  if (!deployment?.project) {
    return NextResponse.json({ error: "No active deployment for this agent" }, { status: 404 });
  }
  if (orgId && deployment.project.orgId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const phaseName = deployment.currentPhase;
  if (!phaseName) {
    return NextResponse.json({ error: "Deployment has no current phase" }, { status: 400 });
  }
  // Restartable when the deployment is parked in "researching" OR when the
  // phase's research never completed at all (advanced via a path that
  // skipped it) — in both cases nothing else will ever run the research.
  const phaseRow = await db.phase.findFirst({
    where: { projectId: deployment.project.id, name: phaseName },
    select: { researchCompletedAt: true },
  });
  if (deployment.phaseStatus !== "researching" && phaseRow?.researchCompletedAt) {
    return NextResponse.json(
      { error: `Research for "${phaseName}" is already complete — nothing to restart.` },
      { status: 409 },
    );
  }

  const projectId = deployment.project.id;
  try {
    // Same routing as phase-advance: front phases get web research,
    // execution/closing phases get project-data scans.
    const { classifyPhase } = await import("@/lib/agents/phase-class");
    const phaseClass = classifyPhase(phaseName);
    let research;
    if (phaseClass === "execution") {
      const { runExecutionProgressScan } = await import("@/lib/agents/execution-progress-scan");
      research = await runExecutionProgressScan(agentId, projectId, phaseName);
    } else if (phaseClass === "closing") {
      const { runClosureScan } = await import("@/lib/agents/closure-scan");
      research = await runClosureScan(agentId, projectId, phaseName);
    } else {
      const { runPhaseResearch } = await import("@/lib/agents/feasibility-research");
      research = await runPhaseResearch(agentId, projectId, deployment.project.orgId ?? orgId ?? "", phaseName);
    }

    // Did the research create approval bundles the user must review?
    const pendingResearchApprovals = await db.approval.count({
      where: {
        projectId,
        status: "PENDING",
        type: "CHANGE_REQUEST",
        impact: { path: ["subtype"], equals: "research_finding" },
      },
    }).catch(() => 0);

    let nextStatus: string;
    if (pendingResearchApprovals > 0) {
      nextStatus = "awaiting_research_approval";
    } else {
      const { markResearchComplete } = await import("@/lib/agents/phase-next-action");
      await markResearchComplete(projectId, phaseName);
      nextStatus = "active";
    }
    const { transitionPhaseStatus } = await import("@/lib/agents/lifecycle-machine");
    await transitionPhaseStatus({
      deploymentId: deployment.id,
      to: nextStatus,
      source: "research-restart",
      reason: `${phaseName}: research restarted by user — ${research.factsDiscovered} fact(s) found`,
    });

    await db.agentActivity.create({
      data: {
        agentId,
        type: "research",
        summary: `${phaseName}: research restarted by user — ${research.factsDiscovered} fact(s) found, phase now ${nextStatus.replace(/_/g, " ")}.`,
      },
    }).catch(() => {});

    return NextResponse.json({
      data: {
        phase: phaseName,
        factsDiscovered: research.factsDiscovered,
        pendingResearchApprovals,
        phaseStatus: nextStatus,
      },
    });
  } catch (e: any) {
    console.error(`[research/restart] failed for agent=${agentId} phase=${phaseName}:`, e);
    return NextResponse.json({ error: e?.message || "Research restart failed" }, { status: 500 });
  }
}
