import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { cancelAgentJobs } from "@/lib/agents/job-queue";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const reason: string = (body.reason || "completed").toString().slice(0, 200);

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, orgId: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.orgId !== orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const archivedAt = new Date();
  const archivedBy = session.user.id || session.user.email || null;

  const updated = await db.project.update({
    where: { id: projectId },
    data: {
      status: "ARCHIVED",
      archivedAt,
      archivedBy,
      archiveReason: reason,
    },
  });

  // Cascade: archive every agent deployed on this project so the audit trail
  // is consistent (an archived project can't have a live agent).
  const deployments = await db.agentDeployment.findMany({
    where: { projectId, isActive: true },
    select: { id: true, agentId: true },
  });
  for (const dep of deployments) {
    await cancelAgentJobs(dep.agentId);
    await db.agent.update({
      where: { id: dep.agentId },
      data: {
        status: "ARCHIVED",
        archivedAt,
        archivedBy,
        archiveReason: `project archived (${reason})`,
      },
    });
    await db.agentActivity.create({
      data: {
        agentId: dep.agentId,
        type: "archived",
        summary: `Auto-archived because project "${project.name}" was archived`,
      },
    });
  }
  await db.agentDeployment.updateMany({
    where: { projectId, isActive: true },
    data: { isActive: false },
  });

  return NextResponse.json({ data: updated, archivedAgents: deployments.length });
}
