/**
 * Backfill helper: re-run the full "approved artefact → structured data"
 * pipeline against a project on demand.
 *
 * The normal write path runs two seeders as a side effect of PATCH
 * /api/agents/artefacts/[id] when an artefact is approved:
 *   1. `parseScheduleArtefactIntoTasks` — Schedule / WBS → db.task
 *   2. `seedArtefactData`              — everything else  → db.{stakeholder,
 *                                                              risk, costEntry,
 *                                                              task (sprint),
 *                                                              benefit, project,
 *                                                              changeRequest}
 *
 * That covers the live user-driven approval flow, but every other route to
 * an APPROVED artefact bypasses it:
 *
 *   - Seed / demo scripts that insert artefacts with status="APPROVED"
 *   - The internal generate-artefacts route auto-approving system docs
 *   - Earlier deployments where the parser/seeder weren't wired yet
 *   - Bulk imports / DB restores
 *
 * Result on those projects: the artefact PDF says "10 tasks, Discovery
 * 2026-04-01 → 2026-04-10, Tech Lead", but the Schedule, Agile Board,
 * Sprint planner, Gantt, PM Tracker delivery layer, EVM, Risks, Stakeholders
 * and Costs pages all show EMPTY because nothing populated the structured
 * tables.
 *
 * This helper bridges that gap. Idempotent (each seeder deletes its own
 * agent-created rows before re-creating), so it's safe to call from a lazy
 * on-read backfill OR a manual "Sync now" button.
 *
 * Methodology coverage
 * ────────────────────
 * Traditional / Waterfall : Schedule Baseline, WBS  → tasks (via schedule-parser)
 * Scrum / Kanban / SAFe   : Initial Product Backlog, Sprint Plans,
 *                           Iteration Plans, Sprint Backlog → tasks (via seedArtefactData)
 * Hybrid                  : Both of the above
 * All methodologies       : Stakeholder Register, Risk Register, Cost Plan,
 *                           Charter, Business Case, Change Request Log → their
 *                           own tables (via seedArtefactData)
 */

import { db } from "@/lib/db";
import {
  isScheduleOrWBS,
  isBacklogOrSprintPlan,
  producesStructuredData,
} from "./sync-artefact-classifiers";

// Re-export so existing import sites (incl. tests) keep working.
export { isScheduleOrWBS, isBacklogOrSprintPlan, producesStructuredData };

export interface SyncResult {
  artefactsScanned: number;
  artefactsParsed: number;
  tasksCreated: number;
  tasksReplaced: number;
  /** Names of artefacts the seeders ran against (for UI confirmation) */
  artefactNames: string[];
}

/**
 * Resolve the agent id to attribute the parsed tasks to. Prefers the
 * currently-active deployment; falls back to whichever agent created the
 * matching artefact (so re-running on a closed-out project still attributes
 * sensibly).
 */
async function pickAgentId(projectId: string, artefactAgentId: string): Promise<string> {
  const active = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    select: { agentId: true },
  }).catch(() => null);
  return active?.agentId || artefactAgentId;
}

/**
 * Sync every APPROVED artefact on the project through the same pipeline the
 * PATCH approval hook runs:
 *
 *   - Schedule / WBS                              → parseScheduleArtefactIntoTasks
 *   - Everything else with a known seeder         → seedArtefactData
 *   - After WBS or backlog seeding completes      → planSprints (best-effort)
 *
 * Idempotent: each seeder deletes its own previously-seeded rows before
 * re-creating them, so calling this multiple times with the same artefacts
 * converges to the same data set.
 *
 * Quiet on no-op: returns counts of 0 when there's nothing parseable.
 */
export async function syncProjectTasksFromArtefacts(projectId: string): Promise<SyncResult> {
  const artefacts = await db.agentArtefact.findMany({
    where: { projectId, status: "APPROVED" },
    select: { id: true, name: true, format: true, content: true, projectId: true, agentId: true },
    orderBy: { createdAt: "asc" },
  });

  const result: SyncResult = {
    artefactsScanned: 0,
    artefactsParsed: 0,
    tasksCreated: 0,
    tasksReplaced: 0,
    artefactNames: [],
  };

  if (artefacts.length === 0) return result;

  // Filter down to artefacts that produce structured data — avoids loading
  // schedule-parser / seedArtefactData on projects with only prose docs.
  const parseable = artefacts.filter(a => a.content && producesStructuredData(a.name));
  result.artefactsScanned = parseable.length;
  if (parseable.length === 0) return result;

  const { parseScheduleArtefactIntoTasks } = await import("./schedule-parser");
  const { seedArtefactData } = await import("./artefact-seeders");

  let touchedScheduleOrBacklog = false;

  for (const a of parseable) {
    const agentId = await pickAgentId(projectId, a.agentId);

    try {
      if (isScheduleOrWBS(a.name)) {
        const out = await parseScheduleArtefactIntoTasks(a, agentId);
        if (out.created > 0 || out.replaced > 0) {
          result.artefactsParsed++;
          result.tasksCreated += out.created;
          result.tasksReplaced += out.replaced;
          result.artefactNames.push(a.name);
          touchedScheduleOrBacklog = true;
        }
      } else {
        // seedArtefactData covers backlogs, sprint plans, stakeholders,
        // risks, costs, charter, benefits, change-requests. It's void-returning
        // — count it as parsed if it ran without throwing.
        await seedArtefactData(a, agentId);
        result.artefactsParsed++;
        result.artefactNames.push(a.name);
        if (isBacklogOrSprintPlan(a.name)) touchedScheduleOrBacklog = true;
      }
    } catch (e) {
      console.error(`[sync-project-tasks] parse failed for "${a.name}":`, e);
    }
  }

  // Mirror PATCH-handler behaviour: after schedule/backlog seeding, auto-plan
  // sprints. Best-effort — failure here doesn't poison the sync result.
  if (touchedScheduleOrBacklog) {
    try {
      const { planSprints } = await import("./sprint-planner");
      const seedAgentId = await pickAgentId(projectId, parseable[0].agentId);
      await planSprints(seedAgentId, projectId);
    } catch (e) {
      console.error("[sync-project-tasks] sprint auto-plan failed:", e);
    }
  }

  return result;
}

/**
 * Should we even bother running the sync on this project? The lazy-on-read
 * backfill calls this first so a project with zero parseable artefacts
 * doesn't incur an extra DB scan on every Tasks/Schedule GET.
 *
 * Returns true when:
 *   - the project has 0 task rows seeded from an artefact AND
 *   - at least one APPROVED artefact that produces tasks exists
 *     (Schedule, WBS, Sprint Plan, Iteration Plan, or Backlog)
 *
 * False otherwise. Note we deliberately scope this to *task-producing*
 * artefacts so a project with only e.g. an approved Risk Register doesn't
 * re-run seedArtefactData on every Tasks GET — that would be busy-work.
 */
export async function shouldBackfillTasks(projectId: string): Promise<boolean> {
  const [taskCount, parseableArtefact] = await Promise.all([
    db.task.count({
      where: {
        projectId,
        OR: [
          { description: { contains: "[source:wbs]" } },
          { description: { contains: "[source:schedule]" } },
          { description: { contains: "[source:artefact]" } }, // sprint/backlog seeder tag
        ],
      },
    }),
    db.agentArtefact.findFirst({
      where: {
        projectId,
        status: "APPROVED",
        OR: [
          { name: { contains: "schedule", mode: "insensitive" } },
          { name: { contains: "wbs", mode: "insensitive" } },
          { name: { contains: "work breakdown", mode: "insensitive" } },
          { name: { contains: "sprint plan", mode: "insensitive" } },
          { name: { contains: "iteration plan", mode: "insensitive" } },
          { name: { contains: "sprint backlog", mode: "insensitive" } },
          { name: { contains: "product backlog", mode: "insensitive" } },
          { name: { contains: "initial backlog", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ]);
  return taskCount === 0 && !!parseableArtefact;
}
