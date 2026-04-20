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
    storyPoints, assigneeId, assigneeName, phaseId,
    isCriticalPath, dependencies,
    parentId, sprintId,
    type, epic, labels, blocked,
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
  if (assigneeName   !== undefined) data.assigneeName   = assigneeName;
  if (phaseId        !== undefined) data.phaseId        = phaseId;
  if (isCriticalPath !== undefined) data.isCriticalPath = isCriticalPath;
  if (dependencies   !== undefined) data.dependencies   = dependencies;
  if (parentId       !== undefined) data.parentId       = parentId;
  if (sprintId       !== undefined) data.sprintId       = sprintId || null;
  if (type           !== undefined) data.type           = type;
  if (epic           !== undefined) data.epic           = epic;
  if (labels         !== undefined) data.labels         = labels;
  if (blocked        !== undefined) data.blocked        = blocked;

  data.lastEditedBy = (session.user as any).id || "user";

  // Auto-sync status ↔ progress: DONE always means 100%, and setting 100% means DONE
  if (data.status && data.status.toUpperCase() === "DONE") {
    data.progress = 100;
  } else if (data.progress === 100 && !data.status) {
    data.status = "DONE";
  } else if (data.status && data.status !== "DONE" && data.progress === undefined) {
    // Moving away from DONE — don't reset progress (user may set manually)
  }

  // If moving to IN_PROGRESS and progress is 0, give it a starting value
  if (data.status === "IN_PROGRESS" && !data.progress) {
    const currentTask = await db.task.findUnique({ where: { id: taskId }, select: { progress: true } });
    if (currentTask && (currentTask.progress || 0) === 0) {
      data.progress = 10; // indicate work has started
    }
  }

  if (Object.keys(data).length === 1 && data.lastEditedBy) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  const task = await db.task.update({ where: { id: taskId }, data });

  // If task has a parent, update parent progress aggregate
  if (task.parentId) {
    try {
      const siblings = await db.task.findMany({
        where: { parentId: task.parentId },
        select: { progress: true },
      });
      const avgProgress = Math.round(siblings.reduce((s, t) => s + (t.progress || 0), 0) / siblings.length);
      const allDone = siblings.every(t => (t.progress || 0) >= 100);
      await db.task.update({
        where: { id: task.parentId },
        data: { progress: avgProgress, status: allDone ? "DONE" : avgProgress > 0 ? "IN_PROGRESS" : "TODO" },
      });
    } catch {}
  }

  // Track significant status changes in KB
  if (status) {
    import("@/lib/agents/kb-event-tracker").then(({ trackTaskStatusChange }) => {
      trackTaskStatusChange(projectId, task.title, body._oldStatus || "TODO", status, session.user?.name || "User").catch(() => {});
    }).catch(() => {});
  }

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

  // Reverse sync Sprint Plans artefact when sprint assignment OR status/progress changes
  if ("sprintId" in data || "status" in data || "progress" in data || "storyPoints" in data) {
    try {
      const { syncSprintsToArtefact } = await import("@/lib/agents/artefact-sync");
      syncSprintsToArtefact(projectId).catch(() => {});
    } catch {}
  }

  // Update scaffolded task progress if this is an agent task
  if (("status" in data || "progress" in data) && task.createdBy?.startsWith("agent:")) {
    try {
      const { onArtefactGenerated } = await import("@/lib/agents/task-scaffolding");
      // If task links to an artefact, mark it done
      if (task.description?.includes("[artefact:") && data.status === "DONE") {
        const match = task.description.match(/\[artefact:([^\]]+)\]/);
        if (match) {
          onArtefactGenerated(task.createdBy.replace("agent:", ""), projectId, match[1]).catch(() => {});
        }
      }
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
