/**
 * Internal-only route for triggering artefact generation without a browser session.
 * Protected by INTERNAL_SECRET header — never expose this route in production.
 * Only active when NODE_ENV !== "production".
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== (process.env.INTERNAL_SECRET || "dev-only-secret-2026")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { projectId, phaseName } = body as { projectId: string; phaseName?: string };

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  // Find active deployment
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    orderBy: { deployedAt: "desc" },
  });
  if (!deployment) {
    return NextResponse.json({ error: "No active deployment" }, { status: 404 });
  }

  // Debug: report key status
  const keyValue = process.env.ANTHROPIC_API_KEY;
  const dbUrl = process.env.DATABASE_URL;
  const keyStatus = !keyValue
    ? "missing"
    : keyValue.startsWith("sk-ant")
    ? `valid-format (${keyValue.slice(0, 18)}...)`
    : `present-unexpected: ${JSON.stringify(keyValue.slice(0, 12))}`;
  const dbStatus = dbUrl ? `set (${dbUrl.slice(0, 20)}...)` : "missing";
  // Find all env keys that might match
  const anthropicKeys = Object.keys(process.env).filter(k => k.toLowerCase().includes("anthropic"));
  const rawValue = process.env.ANTHROPIC_API_KEY;
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const debugInfo = { keyStatus, dbStatus, nodeEnv: process.env.NODE_ENV, rawLength: rawValue?.length ?? -1, rawFirst10: JSON.stringify(rawValue?.slice(0,10) ?? "UNDEF"), baseUrl: baseUrl || "not-set" };

  try {
    const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
    const result = await generatePhaseArtefacts(deployment.agentId, projectId, phaseName);
    return NextResponse.json({ data: result, debug: debugInfo });
  } catch (e: any) {
    console.error("[internal/generate-artefacts]", e);
    return NextResponse.json({ error: e.message, debug: debugInfo }, { status: 500 });
  }
}
