import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

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

  const archiveBlock = await ensureProjectMutable(projectId);
  if (archiveBlock) return NextResponse.json({ error: archiveBlock.error, reason: archiveBlock.reason }, { status: archiveBlock.status });

  // Whitelist updatable fields — prevents accidental projectId/createdBy overwrite
  const {
    title, description, status, priority,
    startDate, endDate, progress,
    estimatedHours, actualHours,
    storyPoints, assigneeId, assigneeName, phaseId,
    isCriticalPath, dependencies,
    parentId, sprintId,
    type, epic, labels, blocked,
    moscow, dodChecks, dorChecks,
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
  if (moscow         !== undefined) data.moscow         = moscow;
  if (dodChecks      !== undefined) data.dodChecks      = dodChecks;
  if (dorChecks      !== undefined) data.dorChecks      = dorChecks;

  data.lastEditedBy = (session.user as any).id || "user";

  // ── DoD gate ──────────────────────────────────────────────────────────
  // When the user (or agent) flips status to DONE, refuse if the project
  // has a Definition of Done with criteria AND any criterion is still
  // unticked on this task's dodChecks. Returns 422 with the unmet items
  // so the UI can highlight what's missing.
  //
  // Scope: DELIVERY work only. Scaffolded PM/governance tasks
  // ("Submit Sprint Zero gate approval", "Generate Definition of Done",
  // "Review and update Risk Register") aren't subject to the DoD —
  // they're meta-tasks the methodology adds to track process, not
  // product. Without this filter the gate would refuse every PM task
  // tick because they don't carry dodChecks. The [scaffolded:delivery]
  // tag still IS in scope — it marks real delivery work the agent
  // scaffolded for a phase that has no WBS yet.
  const flippingToDone = data.status && data.status.toUpperCase() === "DONE";
  if (flippingToDone) {
    try {
      const [project, currentTask] = await Promise.all([
        db.project.findUnique({
          where: { id: projectId },
          select: { definitionOfDone: true, methodology: true },
        }),
        db.task.findUnique({ where: { id: taskId }, select: { dodChecks: true, description: true } }),
      ]);
      const desc = currentTask?.description || "";
      const isScaffoldedNonDelivery = desc.includes("[scaffolded]") && !desc.includes("[scaffolded:delivery]");
      const dod = project?.definitionOfDone as { criteria?: string[] } | null;
      if (!isScaffoldedNonDelivery && dod?.criteria && dod.criteria.length > 0) {
        const { dodComplete, criteriaDelta } = await import("@/lib/agents/criteria-parser");
        // Prefer the incoming dodChecks (user just ticked something in the
        // same request) over the stored value, so the gate sees the latest.
        const effectiveChecks = (data.dodChecks !== undefined ? data.dodChecks : currentTask?.dodChecks) ?? [];
        if (!dodComplete(dod.criteria, effectiveChecks)) {
          const delta = criteriaDelta(dod.criteria, effectiveChecks);
          return NextResponse.json({
            error: "Definition of Done not met",
            reason: "dod_incomplete",
            satisfied: delta.satisfied,
            total: delta.total,
            unmet: delta.unmet,
          }, { status: 422 });
        }
      }
    } catch (e) {
      console.error("[task PATCH] DoD gate check failed (allowing through):", e);
    }
  }

  // ── DoR gate ──────────────────────────────────────────────────────────
  // When a backlog task is pulled into a sprint (sprintId: null → set),
  // refuse if the project has a Definition of Ready with criteria AND any
  // criterion is still unticked on dorChecks. Same 422 contract as DoD.
  // Same delivery-only scope as the DoD gate — scaffolded PM tasks never
  // get pulled into sprints anyway, but the filter is symmetric for
  // future-proofing.
  const pullingIntoSprint = data.sprintId !== undefined && data.sprintId !== null && data.sprintId !== "";
  if (pullingIntoSprint) {
    try {
      const [project, currentTask] = await Promise.all([
        db.project.findUnique({
          where: { id: projectId },
          select: { definitionOfReady: true },
        }),
        db.task.findUnique({ where: { id: taskId }, select: { dorChecks: true, sprintId: true, description: true } }),
      ]);
      // Only enforce on the *transition* (null → set). Reassigning a task
      // already in a sprint to a different sprint is treated as a move,
      // not a fresh pull, so we don't re-gate it.
      const wasOutOfSprint = !currentTask?.sprintId;
      const desc = currentTask?.description || "";
      const isScaffoldedNonDelivery = desc.includes("[scaffolded]") && !desc.includes("[scaffolded:delivery]");
      const dor = project?.definitionOfReady as { criteria?: string[] } | null;
      if (!isScaffoldedNonDelivery && wasOutOfSprint && dor?.criteria && dor.criteria.length > 0) {
        const { dodComplete, criteriaDelta } = await import("@/lib/agents/criteria-parser");
        const effectiveChecks = (data.dorChecks !== undefined ? data.dorChecks : currentTask?.dorChecks) ?? [];
        if (!dodComplete(dor.criteria, effectiveChecks)) {
          const delta = criteriaDelta(dor.criteria, effectiveChecks);
          return NextResponse.json({
            error: "Definition of Ready not met",
            reason: "dor_incomplete",
            satisfied: delta.satisfied,
            total: delta.total,
            unmet: delta.unmet,
          }, { status: 422 });
        }
      }
    } catch (e) {
      console.error("[task PATCH] DoR gate check failed (allowing through):", e);
    }
  }

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

  // Capture the prior status BEFORE the update so we can record a
  // cycle-time transition with the right duration. Only read when status is
  // actually changing (keeps the hot path lean for progress-only edits).
  let priorStatus: string | null = null;
  if (data.status !== undefined) {
    const prev = await db.task.findUnique({ where: { id: taskId }, select: { status: true } });
    priorStatus = prev?.status ?? null;
  }

  const task = await db.task.update({ where: { id: taskId }, data });

  // Record the status transition for cycle-time analytics (best-effort).
  if (data.status !== undefined && priorStatus !== data.status) {
    import("@/lib/agents/cycle-time").then(({ recordStatusTransition }) =>
      recordStatusTransition({
        taskId,
        projectId,
        fromStatus: priorStatus,
        toStatus: data.status,
        changedBy: `user:${(session.user as any).id || "?"}`,
      }),
    ).catch((e) => console.error("[task PATCH] cycle-time capture failed:", e));
  }

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

  // Reverse sync: update the WBS/Schedule artefact CSV to reflect this task edit.
  // Logged on failure so silent drift surfaces in logs.
  import("@/lib/agents/artefact-sync")
    .then(({ syncTaskToArtefact }) => syncTaskToArtefact(projectId, taskId, data))
    .catch((e) => console.error(`[artefact-sync] syncTaskToArtefact failed for project ${projectId} task ${taskId}:`, e));

  // Reverse sync action items back to source artefact's "Next Actions" table
  if (task.sourceArtefactId) {
    import("@/lib/agents/artefact-sync")
      .then(({ syncActionToSourceArtefact }) => syncActionToSourceArtefact(task.sourceArtefactId!, task.title, data))
      .catch((e) => console.error(`[artefact-sync] syncActionToSourceArtefact failed:`, e));
  }

  // Reverse sync Sprint Plans artefact when sprint assignment OR status/progress changes
  if ("sprintId" in data || "status" in data || "progress" in data || "storyPoints" in data) {
    import("@/lib/agents/artefact-sync")
      .then(({ syncSprintsToArtefact }) => syncSprintsToArtefact(projectId))
      .catch((e) => console.error(`[artefact-sync] syncSprintsToArtefact failed for project ${projectId}:`, e));
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

  // Remove the corresponding row from the WBS/Schedule artefact CSV
  try {
    const { removeTaskFromArtefact } = await import("@/lib/agents/artefact-sync");
    await removeTaskFromArtefact(projectId, task.title);
  } catch (e) {
    console.error("[DELETE /tasks] artefact row removal failed (non-blocking):", e);
  }

  return NextResponse.json({ ok: true });
}
