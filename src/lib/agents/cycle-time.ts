/**
 * Cycle-time capture + aggregation.
 *
 * The Sprint Tracker's "Avg Cycle Time by Status" needs to know how long
 * tasks spend in each status. Nothing recorded that before — this module
 * owns both sides:
 *   - recordStatusTransition(): called from the task PATCH path whenever a
 *     task's status changes. Writes a TaskStatusTransition row carrying the
 *     duration the task spent in the status it just left.
 *   - getCycleTimeByStatus(): averages those durations per status for a
 *     project, returned in DAYS for the chart.
 *
 * Duration is measured from the previous transition's changedAt (or the
 * task's createdAt for the first change) to now.
 */

import { db } from "@/lib/db";

const DONE_STATUSES = new Set(["done", "completed"]);

/** Human label for the chart, keyed off the canonical lowercase status. */
const STATUS_LABEL: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  blocked: "Blocked",
  done: "Done",
};

/**
 * Record a status change for a task. Computes how long the task sat in
 * `fromStatus` (since its last transition, or creation) and stores it.
 * Best-effort: never throws into the caller.
 */
export async function recordStatusTransition(opts: {
  taskId: string;
  projectId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy?: string | null;
}): Promise<void> {
  try {
    const { taskId, projectId, fromStatus, toStatus, changedBy } = opts;
    if (fromStatus && fromStatus === toStatus) return; // no-op change

    // Anchor = the most recent prior transition for this task, else the
    // task's createdAt. The gap to now is the time spent in fromStatus.
    const [lastTransition, task] = await Promise.all([
      db.taskStatusTransition.findFirst({
        where: { taskId },
        orderBy: { changedAt: "desc" },
        select: { changedAt: true },
      }),
      db.task.findUnique({ where: { id: taskId }, select: { createdAt: true } }),
    ]);
    const anchor = lastTransition?.changedAt ?? task?.createdAt ?? new Date();
    const durationMs = Math.max(0, Date.now() - new Date(anchor).getTime());

    await db.taskStatusTransition.create({
      data: {
        taskId,
        projectId,
        fromStatus: fromStatus ?? null,
        toStatus,
        durationMs,
        changedBy: changedBy ?? null,
      },
    });
  } catch (e) {
    console.error("[cycle-time] recordStatusTransition failed:", e);
  }
}

/**
 * Average time-in-status for a project, in DAYS, grouped by the status that
 * was LEFT (fromStatus). Returns `{ status, avg }[]` ordered by the typical
 * workflow, including only statuses that have at least one measured
 * transition. Empty array when nothing has been captured yet.
 */
export async function getCycleTimeByStatus(
  projectId: string,
): Promise<Array<{ status: string; avg: number }>> {
  const rows = await db.taskStatusTransition.groupBy({
    by: ["fromStatus"],
    where: { projectId, fromStatus: { not: null } },
    _avg: { durationMs: true },
    _count: true,
  }).catch(() => [] as any[]);

  const ORDER = ["todo", "in_progress", "in_review", "blocked"];
  const out: Array<{ status: string; avg: number; order: number }> = [];
  for (const r of rows) {
    const key = (r.fromStatus || "").toLowerCase();
    if (DONE_STATUSES.has(key)) continue; // time spent already-done isn't cycle time
    const avgMs = r._avg?.durationMs ?? 0;
    const avgDays = Math.round((avgMs / 86_400_000) * 10) / 10; // 1 dp
    out.push({
      status: STATUS_LABEL[key] || key,
      avg: avgDays,
      order: ORDER.indexOf(key) === -1 ? 99 : ORDER.indexOf(key),
    });
  }
  return out.sort((a, b) => a.order - b.order).map(({ status, avg }) => ({ status, avg }));
}
