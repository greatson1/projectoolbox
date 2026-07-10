import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

const STATUSES = ["OPEN", "IN_REVIEW", "FIXED", "CLOSED", "WONT_FIX"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const RESOLVED = new Set(["FIXED", "CLOSED", "WONT_FIX"]);

// PATCH /api/projects/:projectId/defects/:defectId
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string; defectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, defectId } = await params;
  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const existing = await db.defect.findFirst({ where: { id: defectId, projectId }, select: { id: true, status: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const data: Record<string, any> = {};
  if (body.title !== undefined) data.title = String(body.title).slice(0, 255);
  if (body.description !== undefined) data.description = body.description ? String(body.description) : null;
  if (body.severity !== undefined && SEVERITIES.includes(String(body.severity).toUpperCase())) {
    data.severity = String(body.severity).toUpperCase();
  }
  if (body.resolutionNote !== undefined) data.resolutionNote = body.resolutionNote ? String(body.resolutionNote) : null;
  if (body.taskId !== undefined) data.taskId = body.taskId || null;
  if (body.status !== undefined && STATUSES.includes(String(body.status).toUpperCase())) {
    data.status = String(body.status).toUpperCase();
    // resolvedAt tracks the first transition into a terminal state; clears
    // if the defect is reopened.
    data.resolvedAt = RESOLVED.has(data.status) ? new Date() : null;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });

  const defect = await db.defect.update({ where: { id: defectId }, data });
  return NextResponse.json({ data: defect });
}

// DELETE /api/projects/:projectId/defects/:defectId
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ projectId: string; defectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, defectId } = await params;
  const existing = await db.defect.findFirst({ where: { id: defectId, projectId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.defect.delete({ where: { id: defectId } });
  return NextResponse.json({ ok: true });
}
