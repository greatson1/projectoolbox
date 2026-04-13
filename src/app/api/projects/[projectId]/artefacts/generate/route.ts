import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getMethodology } from "@/lib/methodology-definitions";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Claude API calls take 30-90s per batch

/**
 * POST /api/projects/[projectId]/artefacts/generate
 *
 * Generates artefacts for a specific phase or the current phase.
 * NEVER auto-advances phases — phase advancement is a separate explicit action.
 *
 * Body (optional): { phase?: string }
 * - If `phase` is provided, generate artefacts for that specific phase
 * - Otherwise generate for the deployment's currentPhase
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  // Optional explicit phase from body
  let requestedPhase: string | undefined;
  try {
    const body = await req.json();
    requestedPhase = body?.phase;
  } catch { /* no body — fine */ }

  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    orderBy: { deployedAt: "desc" },
    select: { id: true, agentId: true, currentPhase: true },
  });

  if (!deployment) {
    return NextResponse.json({ error: "No active deployment found for this project" }, { status: 404 });
  }

  try {
    // If currentPhase is null → run full lifecycle init first
    if (!deployment.currentPhase && !requestedPhase) {
      const { runLifecycleInit } = await import("@/lib/agents/lifecycle-init");
      await runLifecycleInit(deployment.agentId, deployment.id);
      const updated = await db.agentDeployment.findUnique({
        where: { id: deployment.id },
        select: { currentPhase: true },
      });
      const arts = await db.agentArtefact.findMany({
        where: { projectId, agentId: deployment.agentId },
        select: { name: true },
      });
      return NextResponse.json({ data: { generated: arts.length, skipped: 0, phase: updated?.currentPhase ?? "Pre-Project" } });
    }

    // Determine target phase — use deployment's current phase only.
    // If caller explicitly requests a phase that differs from the current deployment phase,
    // reject with 409 rather than silently auto-advancing. Phase advancement must happen
    // explicitly via the approve-artefacts flow (handleApprove in the artefacts page).
    const targetPhase = deployment.currentPhase;

    if (requestedPhase && requestedPhase !== deployment.currentPhase) {
      return NextResponse.json({
        error: `Phase mismatch: deployment is currently at "${deployment.currentPhase}" but "${requestedPhase}" was requested. Advance the phase explicitly by approving all current-phase artefacts before generating the next phase.`,
      }, { status: 409 });
    }

    const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
    const result = await generatePhaseArtefacts(deployment.agentId, projectId, targetPhase ?? undefined);
    return NextResponse.json({ data: result });
  } catch (e: any) {
    console.error("[artefacts/generate] Failed:", e?.message, e?.stack?.slice(0, 500));
    return NextResponse.json({ error: e.message || "Generation failed" }, { status: 500 });
  }
}
