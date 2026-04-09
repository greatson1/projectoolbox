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
  const { agentId, projectId, phaseName, phase } = body as {
    agentId?: string; projectId: string; phaseName?: string; phase?: string;
  };
  const resolvedPhase = phaseName || phase;

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
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
