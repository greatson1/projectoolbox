/**
 * Phase Completion Utility
 *
 * Single source of truth for whether a phase is ready to advance.
 * Checks three layers:
 *   1. Artefacts — all approved
 *   2. PM Tasks — scaffolded governance tasks complete
 *   3. Delivery Tasks — WBS/schedule work items substantially complete
 *
 * Used by: approval handler, pipeline API, agent system prompt, phase-advance endpoint.
 */

import { db } from "@/lib/db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LayerStatus {
  total: number;
  done: number;
  pct: number;
  items?: Array<{ id: string; title: string; status: string; progress?: number }>;
}

export interface PhaseCompletionStatus {
  phaseName: string;
  phaseId: string;
  phaseStatus: string;
  artefacts: LayerStatus;
  pmTasks: LayerStatus;
  deliveryTasks: LayerStatus;
  overall: number;
  canAdvance: boolean;
  blockers: string[];
}

export interface PhaseCompletionConfig {
  deliveryThreshold: number;  // 0-1, default 0.8 (80%)
  pmTaskThreshold: number;    // 0-1, default 1.0 (100%)
  artefactThreshold: number;  // 0-1, default 1.0 (all approved)
}

const DEFAULT_CONFIG: PhaseCompletionConfig = {
  deliveryThreshold: 0.8,
  pmTaskThreshold: 1.0,
  artefactThreshold: 1.0,
};

// ─── Core Function ──────────────────────────────────────────────────────────

export async function getPhaseCompletion(
  projectId: string,
  phaseName: string,
  agentId: string,
  config?: Partial<PhaseCompletionConfig>,
): Promise<PhaseCompletionStatus> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Look up Phase row to get the CUID (phaseId is stored inconsistently)
  const phaseRow = await db.phase.findFirst({
    where: { projectId, name: phaseName },
    select: { id: true, name: true, status: true },
  });

  const phaseId = phaseRow?.id || "";
  const phaseStatus = phaseRow?.status || "PENDING";

  // Build OR condition for phaseId (some tasks store name, some store CUID)
  const phaseIdMatch = phaseRow
    ? [{ phaseId: phaseName }, { phaseId: phaseRow.id }]
    : [{ phaseId: phaseName }];

  // ── 1. Artefacts ──────────────────────────────────────────────────────

  const artefacts = await db.agentArtefact.findMany({
    where: {
      projectId,
      agentId,
      OR: phaseIdMatch.map((p) => ({ phaseId: p.phaseId })),
    },
    select: { id: true, name: true, status: true },
  });

  const artefactsDone = artefacts.filter((a) => a.status === "APPROVED").length;
  const artefactsTotal = artefacts.length;
  const artefactsPct = artefactsTotal > 0 ? Math.round((artefactsDone / artefactsTotal) * 100) : 100;

  // ── 2. PM Tasks (scaffolded overhead) ─────────────────────────────────

  const pmTasks = await db.task.findMany({
    where: {
      projectId,
      OR: phaseIdMatch,
      description: { contains: "[scaffolded]" },
      // Exclude delivery-tagged scaffolded tasks
      NOT: { description: { contains: "[scaffolded:delivery]" } },
      // Only leaf tasks (not parent groupings)
      parentId: { not: null },
    },
    select: { id: true, title: true, status: true, progress: true },
  });

  const pmTasksDone = pmTasks.filter((t) => t.status === "DONE" || t.status === "COMPLETE" || (t.progress || 0) >= 100).length;
  const pmTasksTotal = pmTasks.length;
  const pmTasksPct = pmTasksTotal > 0 ? Math.round((pmTasksDone / pmTasksTotal) * 100) : 100;

  // ── 3. Delivery Tasks (WBS/schedule + scaffolded delivery) ────────────

  const deliveryTasks = await db.task.findMany({
    where: {
      projectId,
      OR: [
        // WBS/schedule-sourced tasks
        ...phaseIdMatch.map((p) => ({
          phaseId: p.phaseId,
          description: { contains: "[source:" },
        })),
        // Scaffolded delivery tasks
        ...phaseIdMatch.map((p) => ({
          phaseId: p.phaseId,
          description: { contains: "[scaffolded:delivery]" },
        })),
        // User-created tasks with phaseId (manual additions)
        ...phaseIdMatch.map((p) => ({
          phaseId: p.phaseId,
          NOT: { description: { contains: "[scaffolded]" } },
          createdBy: { not: { startsWith: "agent:" } },
        })),
      ],
    },
    select: { id: true, title: true, status: true, progress: true },
  });

  // Deduplicate (OR queries can overlap)
  const seen = new Set<string>();
  const uniqueDelivery = deliveryTasks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    // Exclude parent tasks and pure scaffolded overhead
    return !t.title.includes(":") || t.title.split(":").length <= 2;
  });

  const deliveryDone = uniqueDelivery.filter((t) => t.status === "DONE" || t.status === "COMPLETE" || (t.progress || 0) >= 100).length;
  const deliveryTotal = uniqueDelivery.length;
  const deliveryPct = deliveryTotal > 0 ? Math.round((deliveryDone / deliveryTotal) * 100) : 100;

  // ── Compute overall + blockers ────────────────────────────────────────

  const blockers: string[] = [];

  // Artefact check
  if (artefactsTotal > 0 && artefactsDone / artefactsTotal < cfg.artefactThreshold) {
    const remaining = artefactsTotal - artefactsDone;
    blockers.push(`${remaining} artefact${remaining !== 1 ? "s" : ""} not yet approved`);
  }

  // PM task check
  if (pmTasksTotal > 0 && pmTasksDone / pmTasksTotal < cfg.pmTaskThreshold) {
    const remaining = pmTasksTotal - pmTasksDone;
    blockers.push(`${remaining} PM task${remaining !== 1 ? "s" : ""} incomplete`);
  }

  // Delivery task check
  if (deliveryTotal > 0 && deliveryDone / deliveryTotal < cfg.deliveryThreshold) {
    const pctDone = Math.round((deliveryDone / deliveryTotal) * 100);
    blockers.push(`Delivery tasks at ${pctDone}% (${deliveryDone}/${deliveryTotal}) — need ${Math.round(cfg.deliveryThreshold * 100)}%`);
  }

  const canAdvance = blockers.length === 0;

  // Weighted overall: artefacts 30%, PM tasks 30%, delivery 40%
  const overall = Math.round(
    (artefactsTotal > 0 ? artefactsPct * 0.3 : 30) +
    (pmTasksTotal > 0 ? pmTasksPct * 0.3 : 30) +
    (deliveryTotal > 0 ? deliveryPct * 0.4 : 40)
  );

  return {
    phaseName,
    phaseId,
    phaseStatus,
    artefacts: { total: artefactsTotal, done: artefactsDone, pct: artefactsPct },
    pmTasks: { total: pmTasksTotal, done: pmTasksDone, pct: pmTasksPct },
    deliveryTasks: { total: deliveryTotal, done: deliveryDone, pct: deliveryPct },
    overall,
    canAdvance,
    blockers,
  };
}

// ─── All Phases ─────────────────────────────────────────────────────────────

export async function getAllPhasesCompletion(
  projectId: string,
  agentId: string,
  config?: Partial<PhaseCompletionConfig>,
): Promise<PhaseCompletionStatus[]> {
  const phases = await db.phase.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { name: true },
  });

  const results: PhaseCompletionStatus[] = [];
  for (const phase of phases) {
    results.push(await getPhaseCompletion(projectId, phase.name, agentId, config));
  }

  return results;
}
