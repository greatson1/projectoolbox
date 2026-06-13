/**
 * POST /api/projects/[projectId]/tasks/cleanup-assignees
 *
 * Nulls out implausible Task.assigneeName values (e.g. "Methodology Scrum
 * Team Charter") left by the old column-misalignment bug. Idempotent.
 * Also runs automatically as part of the sprint Replan flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  // Verify project + org access (mirrors the replan route).
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, orgId: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const member = await db.userOrganisation.findFirst({
    where: { orgId: project.orgId, userId: (session.user as any).id },
  });
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const { cleanupProjectAssignees } = await import("@/lib/agents/assignee-cleanup");
  const result = await cleanupProjectAssignees(projectId);

  return NextResponse.json({
    success: true,
    ...result,
    message: result.cleared > 0
      ? `Cleared ${result.cleared} invalid assignee(s) of ${result.scanned} scanned.`
      : `No invalid assignees found (${result.scanned} scanned).`,
  });
}
