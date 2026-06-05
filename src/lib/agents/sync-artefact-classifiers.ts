/**
 * Pure predicates that classify artefact names for the sync backfill.
 *
 * Kept in a db-free module so they can be unit-tested without standing up
 * a Postgres connection (the rest of sync-project-tasks-from-artefacts.ts
 * pulls in @/lib/db at import time).
 *
 * The name lists here MUST stay in lock-step with:
 *   - src/lib/agents/artefact-seeders.ts (which seeder runs on each name)
 *   - src/lib/agents/schedule-parser.ts (which artefacts the WBS/Schedule
 *     parser handles)
 *   - src/app/api/agents/artefacts/[id]/route.ts PATCH handler (the live
 *     auto-seed path)
 *
 * If you add a new artefact category to any of those, add it here too or
 * the backfill will silently skip it on projects that bypassed the PATCH
 * hook.
 */

/** Names that the schedule parser handles. */
export function isScheduleOrWBS(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("schedule") || n.includes("wbs") || n.includes("work breakdown");
}

/** Names that produce sprint-scoped or backlog tasks via seedArtefactData. */
export function isBacklogOrSprintPlan(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("sprint plan") ||
    n.includes("iteration plan") ||
    n.includes("sprint backlog") ||
    n.includes("iteration backlog") ||
    n.includes("product backlog") ||
    n.includes("initial backlog") ||
    n === "backlog"
  );
}

/** Names whose approval populates a structured table (any methodology). */
export function producesStructuredData(name: string): boolean {
  if (isScheduleOrWBS(name)) return true;
  if (isBacklogOrSprintPlan(name)) return true;
  const n = name.toLowerCase();
  return (
    n.includes("stakeholder register") || n.includes("stakeholder list") || n.includes("initial stakeholder") ||
    n.includes("risk register") || n.includes("initial risk") || n.includes("risk management plan") || n.includes("risk log") ||
    n.includes("budget breakdown") || n.includes("cost management plan") || n.includes("budget plan") ||
    n.includes("cost baseline") || n.includes("cost plan") || n.includes("cost estimate") ||
    n.includes("project estimate") || n.includes("cost breakdown") ||
    n.includes("business case") || n.includes("benefits") || n.includes("benefit register") ||
    n.includes("benefit realisation") || n.includes("benefits management") ||
    n.includes("charter") || n.includes("project brief") || n.includes("scope statement") ||
    n === "project initiation document" || n === "pid" ||
    n.includes("change request register") || n.includes("change request log") || n.includes("change log")
  );
}
