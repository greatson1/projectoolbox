import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// GET /api/projects/:projectId/defects — defect/snag log, newest first
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const defects = await db.defect.findMany({
    where: { projectId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { task: { select: { id: true, title: true } } },
  });
  return NextResponse.json({ data: defects });
}

// POST /api/projects/:projectId/defects
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const body = await req.json();
  const title = (body.title || "").toString().trim();
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const severity = SEVERITIES.includes((body.severity || "").toUpperCase()) ? body.severity.toUpperCase() : "MEDIUM";

  const defect = await db.defect.create({
    data: {
      projectId,
      title: title.slice(0, 255),
      description: body.description ? String(body.description) : null,
      severity,
      taskId: body.taskId || null,
      raisedBy: `user:${(session.user as any).id || "?"}`,
    },
  });
  return NextResponse.json({ data: defect }, { status: 201 });
}
