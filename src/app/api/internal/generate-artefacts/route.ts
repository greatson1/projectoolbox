/**
 * Internal route for triggering artefact generation from the VPS agent backend.
 * Protected by shared INTERNAL_API_KEY header — works in all environments.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Authenticate via shared secret (VPS sends x-internal-key header)
  const secret = (req.headers.get("x-internal-key") || req.headers.get("x-internal-secret") || "").trim();
  const expectedKey = (process.env.INTERNAL_API_KEY || process.env.INTERNAL_SECRET || "ptx-internal-2026").trim();
  if (!secret || secret !== expectedKey) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  // Accept both "phaseName" and "phase" for compatibility with VPS caller
  // Pass fullInit: true to run the complete lifecycle init (research → clarification → artefacts)
  const { agentId, projectId, phaseName, phase, fullInit } = body as {
    agentId?: string; projectId?: string; phaseName?: string; phase?: string; fullInit?: boolean;
    deploymentId?: string;
  };
  const deploymentId = (body as any).deploymentId as string | undefined;
  const resolvedPhase = phaseName || phase;

  // fullInit mode: run the complete lifecycle init for a new deployment
  if (fullInit && deploymentId) {
    try {
      const { runLifecycleInit } = await import("@/lib/agents/lifecycle-init");
      const dep = await db.agentDeployment.findUnique({ where: { id: deploymentId } });
      if (!dep) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
      await runLifecycleInit(dep.agentId, deploymentId);
      return NextResponse.json({ data: { ok: true, mode: "full_init", agentId: dep.agentId, deploymentId } });
    } catch (e: any) {
      console.error("[internal/generate-artefacts] full_init failed:", e);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  if (!projectId) {
    return NextResponse.json({ error: "projectId required", v: 2 }, { status: 400 });
  }

  // Find active deployment — prefer agentId if provided, otherwise find by projectId
  const deployment = agentId
    ? await db.agentDeployment.findFirst({
        where: { agentId, projectId, isActive: true },
        orderBy: { deployedAt: "desc" },
      })
    : await db.agentDeployment.findFirst({
        where: { projectId, isActive: true },
        orderBy: { deployedAt: "desc" },
      });
  if (!deployment) {
    return NextResponse.json({ error: "No active deployment" }, { status: 404 });
  }

  try {
    const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
    const result = await generatePhaseArtefacts(deployment.agentId, projectId, resolvedPhase);
    return NextResponse.json({ data: result });
  } catch (e: any) {
    console.error("[internal/generate-artefacts]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
