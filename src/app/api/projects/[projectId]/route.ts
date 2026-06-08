import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

// GET /api/projects/[projectId] — Project detail with related counts
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      phases: { orderBy: { order: "asc" } },
      agents: { where: { isActive: true }, include: { agent: true } },
      _count: { select: { tasks: true, risks: true, issues: true, changeRequests: true, stakeholders: true, approvals: true, meetings: true } },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Verify org membership
  const orgId = (session.user as any).orgId;
  if (project.orgId !== orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ data: project });
}

// PATCH /api/projects/[projectId] — Update project
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const allowedFields = ["name", "description", "startDate", "endDate", "budget", "priority", "category", "methodology", "status"];
  const updateData: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) updateData[key] = body[key];
  }

  if (updateData.startDate && typeof updateData.startDate === "string") updateData.startDate = new Date(updateData.startDate as string);
  if (updateData.endDate && typeof updateData.endDate === "string") updateData.endDate = new Date(updateData.endDate as string);

  const project = await db.project.update({
    where: { id: projectId },
    data: updateData,
    include: {
      agents: { include: { agent: true } },
      _count: { select: { tasks: true, risks: true, issues: true, approvals: true, meetings: true } },
    },
  });

  return NextResponse.json({ data: project });
}

// DELETE /api/projects/[projectId] — Soft-archive project
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const project = await db.project.update({
    where: { id: projectId },
    data: { status: "ARCHIVED" },
  });

  return NextResponse.json({ data: project });
}
