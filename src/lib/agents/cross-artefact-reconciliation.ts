/**
 * Cross-artefact reconciliation orchestrator.
 *
 * Runs after any artefact approval (alongside contradiction-detector and
 * staleness propagation) to surface NUMERICAL disagreements between
 * artefacts — the layer below the contradiction-detector's scalar prose
 * check.
 *
 * Loads the raw data (parses approved WBS / Schedule / Cost Plan / Sprint
 * Plan CSVs, reads Project + Sprint + Stakeholder rows), feeds the totals
 * through the pure check functions in reconciliation-checks.ts, and
 * persists the findings to Project.metadata.reconciliation so:
 *
 *   - The UI banner on Schedule / WBS / Cost / Dashboard can render them
 *   - The approval API can refuse to approve a downstream artefact that
 *     introduces a new ERROR-level divergence
 *   - The agent's morning brief can flag them in plain English
 *
 * Idempotent — overwrites the previous findings list on every run, so
 * resolved issues drop off naturally as soon as the next approval lands.
 */

import { db } from "@/lib/db";
import {
  checkWbsHoursVsLabour,
  checkScheduleVsProjectWindow,
  checkCostPlanTotalVsBudget,
  checkScheduleCoversWbs,
  checkSprintCommitmentVsVelocity,
  type ReconciliationFinding,
} from "./reconciliation-checks";

export interface ReconciliationResult {
  findings: ReconciliationFinding[];
  /** ISO timestamp the run finished at. */
  ranAt: string;
}

// ─── CSV helpers (small, local — keeps the orchestrator self-contained) ──────

function parseCSV(raw: string): Record<string, string>[] {
  const cleaned = raw.replace(/^```[a-z]*\n?/im, "").replace(/```\s*$/im, "").trim();
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cells.push(cur.trim()); cur = "";
      } else { cur += ch; }
    }
    cells.push(cur.trim());
    return cells;
  };
  const headers = splitRow(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ""; });
    return row;
  });
}

function col(row: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    const k = Object.keys(row).find(k => k.toLowerCase() === a.toLowerCase());
    if (k && row[k]) return row[k].trim();
  }
  return "";
}

function parseNumber(raw: string): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseHoursFromDuration(raw: string): number {
  // "10 days" or "10" → 80h (8h/day). "10h" → 10h.
  if (!raw) return 0;
  const lower = raw.toLowerCase();
  const n = parseNumber(lower);
  if (lower.includes("h") || lower.includes("hour")) return n;
  return n * 8;
}

function parseDate(raw: string): Date | null {
  if (!raw || raw === "TBD" || raw === "-" || raw === "N/A") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) {
    const [day, month, year] = raw.split("/");
    const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Data loaders ─────────────────────────────────────────────────────────────

function isApprovedName(name: string, ...needles: string[]): boolean {
  const n = name.toLowerCase();
  return needles.every(needle => true) && needles.some(needle => n.includes(needle.toLowerCase()));
}

async function loadLatestApproved(projectId: string, ...needles: string[]) {
  const all = await db.agentArtefact.findMany({
    where: { projectId, status: "APPROVED" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, content: true, metadata: true },
  });
  return all.find(a => isApprovedName(a.name, ...needles)) || null;
}

interface WbsTotals {
  totalHours: number;
  workPackageCount: number;
}
function totalsFromWbs(content: string): WbsTotals {
  const rows = parseCSV(content);
  let totalHours = 0;
  let workPackageCount = 0;
  for (const r of rows) {
    const wp = col(r, ["Work Package", "Task", "Activity", "Name", "Deliverable"]);
    if (!wp) continue;
    workPackageCount++;
    const duration = col(r, ["Est. Duration (days)", "Duration (days)", "Duration", "Hours", "Effort"]);
    totalHours += parseHoursFromDuration(duration);
  }
  return { totalHours, workPackageCount };
}

interface CostTotals {
  labourTotal: number;
  estimateTotal: number;
  labourRate: number | null;
}
function totalsFromCostPlan(content: string): CostTotals {
  const rows = parseCSV(content);
  let labourTotal = 0;
  let estimateTotal = 0;
  let labourHours = 0;
  for (const r of rows) {
    const amount = parseNumber(col(r, ["Amount", "Cost", "Total", "Budget", "Estimate"]));
    if (amount === 0) continue;
    const category = col(r, ["Category", "Type", "Cost Type", "Cost Category"]).toLowerCase();
    const entryType = col(r, ["Entry Type", "Estimate Type", "Status"]).toLowerCase();
    // Default everything to ESTIMATE if no explicit type marker
    if (entryType === "" || entryType.includes("estimate") || entryType.includes("plan") || entryType.includes("baseline")) {
      estimateTotal += amount;
    }
    if (category.includes("labour") || category.includes("labor") || category.includes("staff") || category.includes("people")) {
      labourTotal += amount;
      const h = parseNumber(col(r, ["Hours", "Effort", "Days"]));
      if (h > 0) labourHours += h;
    }
  }
  const labourRate = labourHours > 0 ? labourTotal / labourHours : null;
  return { labourTotal, estimateTotal, labourRate };
}

interface ScheduleTotals {
  activityCount: number;
  earliestStart: Date | null;
  latestEnd: Date | null;
}
function totalsFromSchedule(content: string): ScheduleTotals {
  const rows = parseCSV(content);
  let activityCount = 0;
  let earliestStart: Date | null = null;
  let latestEnd: Date | null = null;
  for (const r of rows) {
    const activity = col(r, ["Activity", "Task", "Task Name", "Name", "Work Package"]);
    if (!activity) continue;
    activityCount++;
    const start = parseDate(col(r, ["Baseline Start", "Planned Start", "Start Date", "Start"]));
    const end = parseDate(col(r, ["Baseline End", "Planned End", "End Date", "End"]));
    if (start && (!earliestStart || start < earliestStart)) earliestStart = start;
    if (end && (!latestEnd || end > latestEnd)) latestEnd = end;
  }
  return { activityCount, earliestStart, latestEnd };
}

interface SprintTotals {
  committedPoints: number;
}
function totalsFromSprintPlan(content: string): SprintTotals {
  const rows = parseCSV(content);
  let committedPoints = 0;
  for (const r of rows) {
    const points = parseNumber(col(r, ["Story Points", "Points", "Estimate", "SP"]));
    committedPoints += points;
  }
  return { committedPoints };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all reconciliation checks for a project and persist the findings.
 * Returns the findings array — callers can ignore or surface immediately.
 *
 * Safe to call from a `waitUntil` background task; this function does its
 * own logging on failure and never throws.
 */
export async function reconcileProjectArtefacts(projectId: string): Promise<ReconciliationResult> {
  try {
    const [wbs, costPlan, schedule, sprintPlan, project] = await Promise.all([
      loadLatestApproved(projectId, "wbs"),
      loadLatestApproved(projectId, "cost"),
      loadLatestApproved(projectId, "schedule"),
      loadLatestApproved(projectId, "sprint plan"),
      db.project.findUnique({
        where: { id: projectId },
        select: { budget: true, startDate: true, endDate: true, metadata: true, org: { select: { currency: true } } },
      }),
    ]);

    const findings: ReconciliationFinding[] = [];

    const wbsTotals = wbs?.content ? totalsFromWbs(wbs.content) : { totalHours: 0, workPackageCount: 0 };
    const costTotals = costPlan?.content
      ? totalsFromCostPlan(costPlan.content)
      : { labourTotal: 0, estimateTotal: 0, labourRate: null };
    const scheduleTotals = schedule?.content
      ? totalsFromSchedule(schedule.content)
      : { activityCount: 0, earliestStart: null, latestEnd: null };
    const sprintTotals = sprintPlan?.content
      ? totalsFromSprintPlan(sprintPlan.content)
      : { committedPoints: 0 };

    const currency = project?.org?.currency || "GBP";

    push(findings, checkWbsHoursVsLabour({
      wbsTotalHours: wbsTotals.totalHours,
      costPlanLabourTotal: costTotals.labourTotal,
      labourRate: costTotals.labourRate,
      currency,
    }));

    push(findings, checkScheduleVsProjectWindow({
      scheduleEarliestStart: scheduleTotals.earliestStart,
      scheduleLatestEnd: scheduleTotals.latestEnd,
      projectStart: project?.startDate ?? null,
      projectEnd: project?.endDate ?? null,
    }));

    push(findings, checkCostPlanTotalVsBudget({
      costPlanEstimateTotal: costTotals.estimateTotal,
      projectBudget: project?.budget ?? null,
      currency,
    }));

    push(findings, checkScheduleCoversWbs({
      wbsWorkPackageCount: wbsTotals.workPackageCount,
      scheduleActivityCount: scheduleTotals.activityCount,
    }));

    // Team velocity comes from project.metadata if it's been measured;
    // otherwise the check no-ops. Hidden behind a guarded read so we don't
    // surface a sprint check on Waterfall projects.
    const teamVelocity = (project?.metadata as any)?.teamVelocity ?? null;
    push(findings, checkSprintCommitmentVsVelocity({
      sprintCommittedPoints: sprintTotals.committedPoints,
      teamVelocity,
    }));

    const result: ReconciliationResult = { findings, ranAt: new Date().toISOString() };
    await persistFindings(projectId, result);
    return result;
  } catch (e) {
    console.error("[reconcile] failed for", projectId, e);
    return { findings: [], ranAt: new Date().toISOString() };
  }
}

function push(arr: ReconciliationFinding[], f: ReconciliationFinding | null) {
  if (f) arr.push(f);
}

async function persistFindings(projectId: string, result: ReconciliationResult): Promise<void> {
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { metadata: true },
    });
    const existing = (project?.metadata as any) || {};
    await db.project.update({
      where: { id: projectId },
      data: { metadata: { ...existing, reconciliation: result } as any },
    });
  } catch (e) {
    console.error("[reconcile] persist failed:", e);
  }
}

/**
 * Read the latest persisted findings for a project. Used by the GET
 * /api/projects/[id]/reconciliation endpoint and by the dashboard.
 */
export async function getReconciliationFindings(projectId: string): Promise<ReconciliationResult> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { metadata: true },
  });
  const meta = (project?.metadata as any) || {};
  const r = meta.reconciliation as ReconciliationResult | undefined;
  if (!r) return { findings: [], ranAt: new Date(0).toISOString() };
  return r;
}
