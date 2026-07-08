import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.orgId !== orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let reactivateAgent = true;
  try {
    const body = await req.json();
    if (typeof body?.reactivateAgent === "boolean") reactivateAgent = body.reactivateAgent;
  } catch { /* no body — default applies */ }

  const updated = await db.project.update({
    where: { id: projectId },
    data: {
      status: "ACTIVE",
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
    },
  });

  // Archive cascades: it deactivates every deployment and archives the agent.
  // Unarchiving used to restore only the project row, leaving the user with
  // an "active" project where chat, generate and regenerate all fail with
  // "No active deployment" and no visible cause. Reverse the cascade by
  // default; pass { reactivateAgent: false } for reference-only unarchive.
  let agentsReactivated = 0;
  if (reactivateAgent) {
    const deployments = await db.agentDeployment.findMany({
      where: { projectId, isActive: false },
      orderBy: { deployedAt: "desc" },
      take: 1, // only the most recent deployment — older ones were superseded
      select: { id: true, agentId: true },
    });
    for (const dep of deployments) {
      await db.agentDeployment.update({ where: { id: dep.id }, data: { isActive: true } });
      await db.agent.update({
        where: { id: dep.agentId },
        data: { status: "ACTIVE" },
      }).catch(() => {});
      await db.agentActivity.create({
        data: { agentId: dep.agentId, type: "lifecycle", summary: "Project unarchived — agent reactivated." },
      }).catch(() => {});
      agentsReactivated++;
    }
  }

  return NextResponse.json({ data: { ...updated, agentsReactivated } });
}
