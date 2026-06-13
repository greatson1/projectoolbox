/**
 * One-pass repair for tasks that carry an implausible assigneeName — the
 * "Methodology Scrum Team Charter" class of junk left behind by the old
 * column-misalignment bug in the action-item extractor. The extractor itself
 * is now guarded (see assignee-plausibility), but existing rows need healing.
 *
 * Idempotent: nulls only the assigneeNames that fail the plausibility check,
 * leaving real owners untouched. Safe to call repeatedly (e.g. from Replan).
 */

import { db } from "@/lib/db";
import { isImplausibleAssignee } from "./assignee-plausibility";

export async function cleanupProjectAssignees(
  projectId: string,
): Promise<{ scanned: number; cleared: number; examples: string[] }> {
  const tasks = await db.task.findMany({
    where: { projectId, assigneeName: { not: null } },
    select: { id: true, assigneeName: true },
  });

  const bad = tasks.filter(t => isImplausibleAssignee(t.assigneeName));
  if (bad.length > 0) {
    await db.task.updateMany({
      where: { id: { in: bad.map(t => t.id) } },
      data: { assigneeName: null },
    });
  }

  return {
    scanned: tasks.length,
    cleared: bad.length,
    examples: [...new Set(bad.map(t => t.assigneeName as string))].slice(0, 10),
  };
}
