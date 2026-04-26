import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getNextRequiredStep } from "@/lib/agents/phase-next-action";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/next-action
 *
 * Returns the single phase-next-action resolver result for the active
 * deployment's current phase. Drives:
 *   - The chat-page "next required step" banner
 *   - The agent's system-prompt context (consumed via this endpoint to
 *     keep one source of truth)
 *
 * Returns null when the agent has no active deployment — the client treats
 * that as "nothing to surface".
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;

  const agent = await db.agent.findFirst({
    where: { id: agentId, orgId },
    select: { id: true, status: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true, currentPhase: true, phaseStatus: true },
  });

  if (!deployment?.projectId || !deployment.currentPhase) {
    return NextResponse.json({
      data: {
        agentStatus: agent.status,
        currentPhase: null,
        phaseStatus: null,
        nextAction: null,
      },
    });
  }

  const nextAction = await getNextRequiredStep({
    agentId,
    projectId: deployment.projectId,
    phaseName: deployment.currentPhase,
  });

  return NextResponse.json({
    data: {
      agentStatus: agent.status,
      currentPhase: deployment.currentPhase,
      phaseStatus: deployment.phaseStatus,
      nextAction,
    },
  });
}
