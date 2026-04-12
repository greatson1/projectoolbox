import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/agents/[id]/config — Update deployment config (notification channels, etc.)
 * Merges the provided fields into the existing deployment config JSON.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const body = await req.json();

  // Find the active deployment for this agent
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { id: true, config: true },
  });

  if (!deployment) {
    return NextResponse.json({ error: "No active deployment" }, { status: 404 });
  }

  // Merge new config into existing
  const existingConfig = (deployment.config as any) || {};
  const updatedConfig = { ...existingConfig, ...body };

  await db.agentDeployment.update({
    where: { id: deployment.id },
    data: { config: updatedConfig as any },
  });

  return NextResponse.json({ data: { config: updatedConfig } });
}
