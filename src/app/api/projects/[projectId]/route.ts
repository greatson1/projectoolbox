import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/projects/[projectId] — Full project detail
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      phases: { orderBy: { order: "asc" } },
      agents: { where: { isActive: true }, include: { agent: true } },
      _count: { select: { tasks: true, risks: true, issues: true, changeRequests: true, stakeholders: true, approvals: true } },
    },
  });

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ data: project });
}

// PATCH /api/projects/[projectId] — Update project
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const updated = await db.project.update({ where: { id: projectId }, data: body });
  return NextResponse.json({ data: updated });
}

// DELETE /api/projects/[projectId] — Hard delete project + all related data
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const { projectId } = await params;

  // Verify project belongs to this org
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, orgId: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.orgId !== orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Delete all related data in FK-safe order
  await db.agentDeployment.deleteMany({ where: { projectId } });
  await db.phase.deleteMany({ where: { projectId } });
  await db.risk.deleteMany({ where: { projectId } });
  await db.approval.deleteMany({ where: { projectId } });
  await db.task.deleteMany({ where: { projectId } });
  await db.issue.deleteMany({ where: { projectId } });
  await db.stakeholder.deleteMany({ where: { projectId } });
  await db.changeRequest.deleteMany({ where: { projectId } });
  await db.agentArtefact.deleteMany({ where: { projectId } }).catch(() => {});
  await db.project.delete({ where: { id: projectId } });

  return NextResponse.json({ success: true, name: project.name });
}
