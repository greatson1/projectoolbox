import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/agents/[id]/artefacts — List artefacts for an agent
// Queries by both agentId AND the agent's deployed projectId to catch all artefacts
// regardless of which field was populated during generation.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: agentId } = await params;

  // Look up the project this agent is deployed to
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });

  // Include artefacts by agentId OR by projectId (some are stored project-scoped)
  const whereClause = deployment?.projectId
    ? { OR: [{ agentId }, { projectId: deployment.projectId }] }
    : { agentId };

  const artefacts = await db.agentArtefact.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
  });

  // Resolve phase names for grouping (AgentArtefact has no Prisma relation to Phase)
  const phaseIds = [...new Set(artefacts.map((a: any) => a.phaseId).filter(Boolean))] as string[];
  const phases = phaseIds.length > 0
    ? await db.phase.findMany({ where: { id: { in: phaseIds } }, select: { id: true, name: true } })
    : [];
  const phaseNameById: Record<string, string> = Object.fromEntries(phases.map(p => [p.id, p.name]));

  const normalised = artefacts.map((a: any) => ({
    ...a,
    phaseName: a.phaseId ? (phaseNameById[a.phaseId] || "General") : "General",
  }));

  return NextResponse.json({ data: normalised });
}
