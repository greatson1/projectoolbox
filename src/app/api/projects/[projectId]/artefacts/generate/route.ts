import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Claude API calls take 30-90s per batch

/**
 * POST /api/projects/[projectId]/artefacts/generate
 * Triggers artefact generation for the current phase of the active deployment.
 * Skips artefacts that already exist. Safe to call multiple times.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  // Find active deployment for this project
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    orderBy: { deployedAt: "desc" },
    select: { id: true, agentId: true, currentPhase: true },
  });

  if (!deployment) {
    return NextResponse.json({ error: "No active deployment found for this project" }, { status: 404 });
  }

  try {
    // If currentPhase is null the lifecycle init never completed (e.g. Vercel killed the
    // async IIFE after the deploy response was sent). Run full init to create phases,
    // seed risks, and generate artefacts — all in one shot.
    if (!deployment.currentPhase) {
      const { runLifecycleInit } = await import("@/lib/agents/lifecycle-init");
      await runLifecycleInit(deployment.agentId, deployment.id);
      // Re-fetch to get updated currentPhase after init
      const updated = await db.agentDeployment.findUnique({
        where: { id: deployment.id },
        select: { currentPhase: true },
      });
      // Return in same shape as generatePhaseArtefacts so the UI toasts correctly
      const arts = await db.agentArtefact.findMany({
        where: { projectId, agentId: deployment.agentId },
        select: { name: true },
      });
      return NextResponse.json({ data: { generated: arts.length, skipped: 0, phase: updated?.currentPhase ?? "Pre-Project" } });
    }

    const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
    const result = await generatePhaseArtefacts(deployment.agentId, projectId, deployment.currentPhase);
    return NextResponse.json({ data: result });
  } catch (e: any) {
    console.error("[artefacts/generate] Failed:", e);
    return NextResponse.json({ error: e.message || "Generation failed" }, { status: 500 });
  }
}
