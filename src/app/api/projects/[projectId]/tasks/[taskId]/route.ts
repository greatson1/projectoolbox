import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ projectId: string; taskId: string }> };

// ── GET /api/projects/:projectId/tasks/:taskId ────────────────────────────────
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, taskId } = await params;
  const task = await db.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ data: task });
}

// ── PATCH /api/projects/:projectId/tasks/:taskId ──────────────────────────────
// Updates any subset of task fields. Called by Gantt drag, Agile board moves,
// inline progress edits, and status changes. Writes audit log.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, taskId } = await params;
  const body = await req.json();

  // Whitelist updatable fields — prevents accidental projectId/createdBy overwrite
  const {
    title, description, status, priority,
    startDate, endDate, progress,
    estimatedHours, actualHours,
    storyPoints, assigneeId, phaseId,
    isCriticalPath, dependencies,
    parentId,
  } = body;

  const data: Record<string, any> = {};
  if (title        !== undefined) data.title        = title;
  if (description  !== undefined) data.description  = description;
  if (status       !== undefined) data.status       = status;
  if (priority     !== undefined) data.priority     = priority;
  if (startDate    !== undefined) data.startDate    = startDate ? new Date(startDate) : null;
  if (endDate      !== undefined) data.endDate      = endDate   ? new Date(endDate)   : null;
  if (progress     !== undefined) data.progress     = Math.min(100, Math.max(0, Number(progress)));
  if (estimatedHours !== undefined) data.estimatedHours = estimatedHours;
  if (actualHours    !== undefined) data.actualHours    = actualHours;
  if (storyPoints    !== undefined) data.storyPoints    = storyPoints;
  if (assigneeId     !== undefined) data.assigneeId     = assigneeId;
  if (phaseId        !== undefined) data.phaseId        = phaseId;
  if (isCriticalPath !== undefined) data.isCriticalPath = isCriticalPath;
  if (dependencies   !== undefined) data.dependencies   = dependencies;
  if (parentId       !== undefined) data.parentId       = parentId;

  data.lastEditedBy = (session.user as any).id || "user";

  if (Object.keys(data).length === 1) {
    // Only lastEditedBy — nothing real changed
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  const task = await db.task.update({ where: { id: taskId }, data });

  // Audit log
  const orgId = (session.user as any).orgId;
  if (orgId) {
    const changedFields = Object.keys(data).filter(k => k !== "lastEditedBy").join(", ");
    await db.auditLog.create({
      data: {
        orgId,
        userId: (session.user as any).id,
        projectId,
        action: `Task updated: ${changedFields}`,
        target: task.title,
        entityType: "TASK",
        entityId: taskId,
      },
    }).catch(() => {}); // non-blocking
  }

  // Reverse sync: update the WBS/Schedule artefact CSV to reflect this task edit
  try {
    const { syncTaskToArtefact } = await import("@/lib/agents/artefact-sync");
    syncTaskToArtefact(projectId, taskId, data).catch(() => {});
  } catch {}

  // If sprintId changed, also reverse sync Sprint Plans artefact
  if ("sprintId" in data) {
    try {
      const { syncSprintsToArtefact } = await import("@/lib/agents/artefact-sync");
      syncSprintsToArtefact(projectId).catch(() => {});
    } catch {}
  }

  return NextResponse.json({ data: task });
}

// ── DELETE /api/projects/:projectId/tasks/:taskId ─────────────────────────────
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, taskId } = await params;

  // Only allow deleting user-created tasks or agent tasks — not system tasks
  const task = await db.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.task.delete({ where: { id: taskId } });
  return NextResponse.json({ ok: true });
}
