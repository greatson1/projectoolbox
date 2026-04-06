import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

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
