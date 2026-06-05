/**
 * Earned Value Management Engine
 *
 * Per spec Section 5.10: Daily EVM calculations, performance indices,
 * weekly forecasting, contingency tracking, and threshold-triggered actions.
 *
 * Core metrics: PV, EV, AC, SV, CV, SPI, CPI, EAC, ETC, TCPI, VAC
 */

import { db } from "@/lib/db";
import type { ActionProposal } from "./decision-classifier";

/** Minimal task shape needed to compute effort-weighted completion. */
export interface EvmTaskInput {
  status: string;
  progress?: number | null;
  estimatedHours?: number | null;
  storyPoints?: number | null;
}

/**
 * Effort-weighted completion fraction (0..1) — the single source of truth for
 * "how much of the work is done" used by Earned Value across the app.
 *
 * Why weighted: plain done/total treats a £100 task and a £50k task as equal
 * and only credits binary completion. Each task is weighted by effort
 * (estimatedHours, else storyPoints, else 1) and earns partial credit from
 * `progress`, so a half-finished large work package earns more than a finished
 * trivial one. A DONE task always counts as 100% regardless of a stale
 * `progress` value. Degrades exactly to done/total when no effort data exists
 * and progress is binary.
 *
 *   fraction = Σ(weight × progressFraction) / Σ(weight)
 */
export function computeCompletionFraction(tasks: EvmTaskInput[]): number {
  let weightSum = 0;
  let earnedWeightSum = 0;
  for (const t of tasks) {
    const weight = (t.estimatedHours && t.estimatedHours > 0)
      ? t.estimatedHours
      : (t.storyPoints && t.storyPoints > 0)
        ? t.storyPoints
        : 1;
    const progressFraction = t.status === "DONE"
      ? 1
      : Math.max(0, Math.min(100, t.progress ?? 0)) / 100;
    weightSum += weight;
    earnedWeightSum += weight * progressFraction;
  }
  return weightSum > 0 ? earnedWeightSum / weightSum : 0;
}

export interface EvmMetrics {
  // Core (daily)
  bac: number;    // Budget At Completion (total approved budget)
  pv: number;     // Planned Value (budget planned to be spent by now)
  ev: number;     // Earned Value (budget worth of work completed)
  // Cost-side fields are NULL when no real Actual Cost has been logged.
  // We never fabricate AC (the old `EV × 1.05` model invented cost variance
  // and made CPI hover at ~0.95, masking genuine overruns and risking false
  // BUDGET_CHANGE alerts). Real AC = sum of CostEntry rows with
  // entryType="ACTUAL" — the same source the metrics route uses.
  ac: number | null;     // Actual Cost (actual spend to date) — null if none logged
  hasRealCosts: boolean; // true when at least one ACTUAL CostEntry exists
  // Variances
  sv: number;            // Schedule Variance (EV - PV)
  cv: number | null;     // Cost Variance (EV - AC) — null without real AC
  // Indices
  spi: number;           // Schedule Performance Index (EV / PV)
  cpi: number | null;    // Cost Performance Index (EV / AC) — null without real AC
  // Forecasts (weekly)
  eac: number | null;    // Estimate At Completion (BAC / CPI) — null without CPI
  etc: number | null;    // Estimate To Complete (EAC - AC) — null without AC
  tcpi: number | null;   // To-Complete Performance Index — null without AC
  vac: number | null;    // Variance At Completion (BAC - EAC) — null without EAC
  // Health
  scheduleHealth: "GREEN" | "AMBER" | "RED";
  costHealth: "GREEN" | "AMBER" | "RED" | "UNKNOWN"; // UNKNOWN when no real AC
}

/**
 * Calculate EVM metrics for a project.
 */
export async function calculateEvm(projectId: string): Promise<EvmMetrics | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { budget: true, startDate: true, endDate: true },
  });

  if (!project?.budget || !project.startDate || !project.endDate) return null;

  const [tasks, actualCosts] = await Promise.all([
    db.task.findMany({
      where: { projectId },
      select: { status: true, progress: true, estimatedHours: true, storyPoints: true },
    }),
    // Real Actual Cost — sum of logged ACTUAL cost entries. Same source the
    // metrics route uses; never fabricated.
    db.costEntry.aggregate({
      where: { projectId, entryType: "ACTUAL" },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const bac = project.budget;
  const now = new Date();
  const start = new Date(project.startDate);
  const end = new Date(project.endDate);
  const totalDuration = Math.max(1, end.getTime() - start.getTime());
  const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start.getTime()));
  const plannedProgress = elapsed / totalDuration;

  // PV = BAC * planned progress %
  const pv = Math.round(bac * plannedProgress);

  // EV = BAC * effort-weighted completion fraction (shared helper — same
  // definition the metrics route and scorecard use, with partial-progress
  // credit rather than binary done-count).
  const actualProgress = computeCompletionFraction(tasks);
  const ev = Math.round(bac * actualProgress);

  // AC — real logged actuals only. Null when none exist; we never invent it.
  const realAC = actualCosts._sum.amount || 0;
  const hasRealCosts = actualCosts._count > 0 && realAC > 0;
  const ac: number | null = hasRealCosts ? Math.round(realAC) : null;

  // Schedule variance/index only need EV + PV → always computable.
  const sv = ev - pv;
  const spi = pv > 0 ? Math.round((ev / pv) * 100) / 100 : 1;

  // Cost-side metrics require real AC. Without it they are null (not a
  // fabricated 0.95) so callers can show N/A and alerts don't false-fire.
  let cv: number | null = null;
  let cpi: number | null = null;
  let eac: number | null = null;
  let etc: number | null = null;
  let tcpi: number | null = null;
  let vac: number | null = null;
  let costHealth: "GREEN" | "AMBER" | "RED" | "UNKNOWN" = "UNKNOWN";
  if (ac !== null) {
    cv = ev - ac;
    cpi = ac > 0 ? Math.round((ev / ac) * 100) / 100 : null;
    if (cpi !== null && cpi > 0) {
      eac = Math.round(bac / cpi);
      etc = Math.max(0, eac - ac);
      vac = bac - eac;
    }
    tcpi = (bac - ac) > 0 ? Math.round(((bac - ev) / (bac - ac)) * 100) / 100 : null;
    costHealth = cpi === null ? "UNKNOWN" : cpi >= 0.95 ? "GREEN" : cpi >= 0.9 ? "AMBER" : "RED";
  }

  // Health RAG
  const scheduleHealth = spi >= 0.95 ? "GREEN" : spi >= 0.9 ? "AMBER" : "RED";

  return { bac, pv, ev, ac, hasRealCosts, sv, cv, spi, cpi, eac, etc, tcpi, vac, scheduleHealth, costHealth };
}

/**
 * Check EVM thresholds and generate action proposals.
 * Called from the daily monitoring loop.
 */
export async function checkEvmThresholds(projectId: string, agentId: string): Promise<ActionProposal[]> {
  const evm = await calculateEvm(projectId);
  if (!evm) return [];

  const proposals: ActionProposal[] = [];

  // SPI < 0.9 → behind schedule
  if (evm.spi < 0.9) {
    proposals.push({
      type: "ESCALATION",
      description: `Schedule Performance Index is ${evm.spi} (below 0.9 threshold). Project is ${Math.round((1 - evm.spi) * 100)}% behind planned progress.`,
      reasoning: `EVM analysis: SV = £${evm.sv.toLocaleString()}, SPI = ${evm.spi}. Earned Value (£${evm.ev.toLocaleString()}) is significantly below Planned Value (£${evm.pv.toLocaleString()}). Recommend reviewing critical path and considering schedule compression or scope reduction.`,
      confidence: 0.9,
      scheduleImpact: evm.spi < 0.8 ? 4 : 3,
      costImpact: 1,
      scopeImpact: 1,
      stakeholderImpact: evm.spi < 0.8 ? 3 : 2,
    });
  }

  // CPI < 0.9 → over budget. Only fires on REAL cost data — when no actuals
  // have been logged, CPI is null and we must not raise a fabricated budget
  // alert (the old `EV × 1.05` model made CPI ~0.95 forever, so this branch
  // never reflected reality).
  if (evm.cpi !== null && evm.cpi < 0.9) {
    const cv = evm.cv ?? 0;
    const eac = evm.eac ?? evm.bac;
    const vac = evm.vac ?? 0;
    proposals.push({
      type: "BUDGET_CHANGE",
      description: `Cost Performance Index is ${evm.cpi} (below 0.9 threshold). Project is ${Math.round((1 - evm.cpi) * 100)}% over budget.`,
      reasoning: `EVM analysis: CV = £${cv.toLocaleString()}, CPI = ${evm.cpi}. Estimate At Completion (EAC) is £${eac.toLocaleString()} vs Budget At Completion (BAC) of £${evm.bac.toLocaleString()}. Variance At Completion: £${vac.toLocaleString()}.`,
      confidence: 0.9,
      scheduleImpact: 1,
      costImpact: evm.cpi < 0.8 ? 4 : 3,
      scopeImpact: 1,
      stakeholderImpact: 2,
    });
  }

  return proposals;
}
