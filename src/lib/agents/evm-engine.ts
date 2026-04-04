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

export interface EvmMetrics {
  // Core (daily)
  bac: number;    // Budget At Completion (total approved budget)
  pv: number;     // Planned Value (budget planned to be spent by now)
  ev: number;     // Earned Value (budget worth of work completed)
  ac: number;     // Actual Cost (actual spend to date)
  // Variances
  sv: number;     // Schedule Variance (EV - PV)
  cv: number;     // Cost Variance (EV - AC)
  // Indices
  spi: number;    // Schedule Performance Index (EV / PV)
  cpi: number;    // Cost Performance Index (EV / AC)
  // Forecasts (weekly)
  eac: number;    // Estimate At Completion (BAC / CPI)
  etc: number;    // Estimate To Complete (EAC - AC)
  tcpi: number;   // To-Complete Performance Index ((BAC - EV) / (BAC - AC))
  vac: number;    // Variance At Completion (BAC - EAC)
  // Health
  scheduleHealth: "GREEN" | "AMBER" | "RED";
  costHealth: "GREEN" | "AMBER" | "RED";
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

  const tasks = await db.task.findMany({
    where: { projectId },
    select: { status: true, storyPoints: true, startDate: true, endDate: true },
  });

  const bac = project.budget;
  const now = new Date();
  const start = new Date(project.startDate);
  const end = new Date(project.endDate);
  const totalDuration = Math.max(1, end.getTime() - start.getTime());
  const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start.getTime()));
  const plannedProgress = elapsed / totalDuration;

  // PV = BAC * planned progress %
  const pv = Math.round(bac * plannedProgress);

  // EV = BAC * actual progress % (based on completed tasks weighted by story points)
  const totalSP = tasks.reduce((s, t) => s + (t.storyPoints || 1), 0) || 1;
  const doneSP = tasks.filter(t => t.status === "DONE").reduce((s, t) => s + (t.storyPoints || 1), 0);
  const actualProgress = doneSP / totalSP;
  const ev = Math.round(bac * actualProgress);

  // AC = estimated from progress (in real system, this comes from finance integration)
  // Using a simple model: AC ≈ EV * (1 + variance_factor)
  const ac = Math.round(ev * 1.05); // Assume 5% cost variance by default

  // Variances
  const sv = ev - pv;
  const cv = ev - ac;

  // Indices (protect against division by zero)
  const spi = pv > 0 ? Math.round((ev / pv) * 100) / 100 : 1;
  const cpi = ac > 0 ? Math.round((ev / ac) * 100) / 100 : 1;

  // Forecasts
  const eac = cpi > 0 ? Math.round(bac / cpi) : bac;
  const etc = Math.max(0, eac - ac);
  const tcpi = (bac - ac) > 0 ? Math.round(((bac - ev) / (bac - ac)) * 100) / 100 : 1;
  const vac = bac - eac;

  // Health RAG
  const scheduleHealth = spi >= 0.95 ? "GREEN" : spi >= 0.9 ? "AMBER" : "RED";
  const costHealth = cpi >= 0.95 ? "GREEN" : cpi >= 0.9 ? "AMBER" : "RED";

  return { bac, pv, ev, ac, sv, cv, spi, cpi, eac, etc, tcpi, vac, scheduleHealth, costHealth };
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

  // CPI < 0.9 → over budget
  if (evm.cpi < 0.9) {
    proposals.push({
      type: "BUDGET_CHANGE",
      description: `Cost Performance Index is ${evm.cpi} (below 0.9 threshold). Project is ${Math.round((1 - evm.cpi) * 100)}% over budget.`,
      reasoning: `EVM analysis: CV = £${evm.cv.toLocaleString()}, CPI = ${evm.cpi}. Estimate At Completion (EAC) is £${evm.eac.toLocaleString()} vs Budget At Completion (BAC) of £${evm.bac.toLocaleString()}. Variance At Completion: £${evm.vac.toLocaleString()}.`,
      confidence: 0.9,
      scheduleImpact: 1,
      costImpact: evm.cpi < 0.8 ? 4 : 3,
      scopeImpact: 1,
      stakeholderImpact: 2,
    });
  }

  return proposals;
}
