import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getAllPhasesCompletion } from "@/lib/agents/phase-completion";

export const dynamic = "force-dynamic";

// GET /api/agents/:id/phase-completion — completion status for all phases
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;

  const agent = await db.agent.findFirst({
    where: { id: agentId, orgId },
    select: { id: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true, currentPhase: true, phaseStatus: true },
  });
  if (!deployment?.projectId) {
    return NextResponse.json({ error: "No active deployment" }, { status: 404 });
  }

  const completion = await getAllPhasesCompletion(deployment.projectId, agentId);

  return NextResponse.json({
    data: {
      currentPhase: deployment.currentPhase,
      phaseStatus: deployment.phaseStatus,
      phases: completion,
    },
  });
}

// POST /api/agents/:id/phase-completion — re-check and advance if ready
// Called when phaseStatus is "blocked_tasks_incomplete" and user has completed tasks
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true, agent: { orgId } },
    include: { project: { select: { id: true, methodology: true } } },
  });

  if (!deployment?.projectId || !deployment.currentPhase) {
    return NextResponse.json({ error: "No active deployment or phase" }, { status: 404 });
  }

  const { getPhaseCompletion } = await import("@/lib/agents/phase-completion");
  const completion = await getPhaseCompletion(deployment.projectId, deployment.currentPhase, agentId);

  if (!completion.canAdvance) {
    return NextResponse.json({
      data: { advanced: false, completion },
      message: `Still blocked: ${completion.blockers.join("; ")}`,
    });
  }

  // Can advance — execute phase transition
  const { getNextPhase } = await import("@/lib/agents/methodology-playbooks");
  const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
  const methodologyId = (deployment.project.methodology || "PRINCE2").toLowerCase().replace("agile_", "");
  const nextPhase = getNextPhase(methodologyId, deployment.currentPhase);

  if (nextPhase) {
    await db.agentDeployment.update({
      where: { id: deployment.id },
      data: { currentPhase: nextPhase, phaseStatus: "active", lastCycleAt: new Date(), nextCycleAt: new Date(Date.now() + 2 * 60_000) },
    });
    await db.phase.updateMany({
      where: { projectId: deployment.projectId, name: deployment.currentPhase },
      data: { status: "COMPLETED" },
    });
    await db.phase.updateMany({
      where: { projectId: deployment.projectId, name: nextPhase },
      data: { status: "ACTIVE" },
    });
    await db.agentActivity.create({
      data: { agentId, type: "approval", summary: `Phase advanced: "${deployment.currentPhase}" → "${nextPhase}". All completion requirements met.` },
    });

    // Generate next-phase artefacts
    generatePhaseArtefacts(agentId, deployment.projectId, nextPhase).catch((e) =>
      console.error("[phase-advance] artefact generation failed:", e)
    );

    return NextResponse.json({
      data: { advanced: true, from: deployment.currentPhase, to: nextPhase, completion },
    });
  } else {
    // Final phase — project complete
    await db.agentDeployment.update({
      where: { id: deployment.id },
      data: { phaseStatus: "complete", isActive: false },
    });
    await db.agentActivity.create({
      data: { agentId, type: "approval", summary: `Final phase complete: "${deployment.currentPhase}". Project lifecycle complete.` },
    });
    return NextResponse.json({
      data: { advanced: true, from: deployment.currentPhase, to: null, projectComplete: true, completion },
    });
  }
}
