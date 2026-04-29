/**
 * Task-filter helpers — keep PM-overhead scaffolded tasks out of delivery views.
 *
 * The agent's task scaffolder seeds governance/overhead pseudo-tasks at
 * deployment time (e.g. "Generate Project Brief", "Conduct clarification
 * Q&A", "Submit Phase Gate approval"). They carry a "[scaffolded]" marker
 * in description and exist purely to drive the PM Tracker — they're not
 * real units of work and should never appear in:
 *
 *   - Org Dashboard (totalTasks / completedTasks counts)
 *   - Project Metrics (status counts, story-point totals)
 *   - Gantt
 *   - Resources / People allocation
 *   - EVM (Earned Value)
 *   - Forecast
 *   - Scorecard
 *   - Critical Path
 *   - Overdue list
 *   - CSV / JSON Export
 *
 * Real delivery tasks the agent scaffolded before a full WBS existed are
 * tagged "[scaffolded:delivery]" — those should pass through. The filter
 * matches the literal substring "[scaffolded]" only, so [scaffolded:delivery]
 * is unaffected.
 *
 * Usage:
 *   db.task.findMany({ where: { projectId, ...EXCLUDE_PM_OVERHEAD } })
 *   db.task.count({ where: { project: { orgId }, ...EXCLUDE_PM_OVERHEAD } })
 */
export const EXCLUDE_PM_OVERHEAD = {
  NOT: { description: { contains: "[scaffolded]" } },
} as const;
