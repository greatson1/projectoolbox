/**
 * Sprint-start gate.
 *
 * Enforces the task-status ↔ sprint-status relationship that the rest of the
 * platform assumed but never checked: a task may only enter an *active-work*
 * status (IN_PROGRESS / IN_REVIEW / DONE) once the sprint it belongs to has
 * actually started.
 *
 * Without this, three independent write paths could (and did) mark tasks
 * in-progress inside a sprint still in PLANNING:
 *   1. the task PATCH route (UI drag / inline edits),
 *   2. action-executor TASK_ASSIGNMENT proposals,
 *   3. change-proposals status / milestone updates.
 * The visible symptom was "work underway in a future sprint that hasn't
 * started" — e.g. an IN_PROGRESS task in Sprint 8 (PLANNING).
 *
 * This module is the single source of truth all three call before writing.
 */

import { db } from "@/lib/db";

// Statuses that represent work actively underway. A task may only enter these
// once its sprint is ACTIVE — or already COMPLETED, so we never retroactively
// rewrite the history of a finished sprint.
export const ACTIVE_WORK_STATUSES = new Set(["IN_PROGRESS", "IN_REVIEW", "DONE"]);

export type SprintStartViolation = {
  reason: "sprint_not_started";
  sprintId: string;
  sprintName: string;
  sprintStatus: string;
  attemptedStatus: string;
};

/**
 * Returns a violation describing why `nextStatus` may not be applied, or null
 * when the transition is allowed.
 *
 * Out of scope (returns null — allowed):
 *  - target statuses that aren't active work (BACKLOG / TODO / CANCELLED)
 *  - sprint-less tasks (backlog & Sprint-Zero governance work live here)
 *  - scaffolded non-delivery PM/governance tasks (same carve-out the DoD/DoR
 *    gates use — these are process meta-tasks, not sprint-bound delivery)
 *  - sprints that are ACTIVE or COMPLETED
 *
 * Only a task bound to a PLANNING (or CANCELLED) sprint and moving into an
 * active-work status is blocked.
 */
export async function checkSprintStartGate(opts: {
  nextStatus?: string | null;
  sprintId?: string | null;
  description?: string | null;
}): Promise<SprintStartViolation | null> {
  const next = opts.nextStatus?.toUpperCase();
  if (!next || !ACTIVE_WORK_STATUSES.has(next)) return null;
  if (!opts.sprintId) return null;

  const desc = opts.description || "";
  if (desc.includes("[scaffolded]") && !desc.includes("[scaffolded:delivery]")) return null;

  const sprint = await db.sprint.findUnique({
    where: { id: opts.sprintId },
    select: { id: true, name: true, status: true },
  });
  if (!sprint) return null;
  if (sprint.status === "ACTIVE" || sprint.status === "COMPLETED") return null;

  return {
    reason: "sprint_not_started",
    sprintId: sprint.id,
    sprintName: sprint.name,
    sprintStatus: sprint.status,
    attemptedStatus: next,
  };
}
