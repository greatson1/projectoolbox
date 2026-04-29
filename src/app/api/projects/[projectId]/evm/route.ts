import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { EXCLUDE_PM_OVERHEAD } from "@/lib/agents/task-filters";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:id/evm — Full Earned Value Management data
 *
 * Returns all EVM metrics plus S-curve data.
 *
 * Key rules — no synthetic data:
 *  - SPI is null until the project has started AND pv > 0
 *  - CPI is null until real ACTUAL CostEntry records exist
 *  - AC is null when no real cost entries (never fake ev * 1.05)
 *  - Forecasts (EAC, ETC, VAC, TCPI) are null when their inputs are null
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const [project, tasks, costEntries, risks, snapshot] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: { budget: true, startDate: true, endDate: true, name: true },
    }),
    db.task.findMany({
      where: { projectId, ...EXCLUDE_PM_OVERHEAD },
      select: { status: true, storyPoints: true, endDate: true, estimatedHours: true, actualHours: true },
    }),
    db.costEntry.findMany({
      where: { projectId },
      select: { entryType: true, amount: true, recordedAt: true },
      orderBy: { recordedAt: "asc" },
    }),
    db.risk.findMany({
      where: { projectId },
      select: { score: true, status: true },
    }),
    db.metricsSnapshot.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!project?.budget) {
    return NextResponse.json({ data: null });
  }

  const bac = project.budget;
  const now = new Date();
  const start = project.startDate ? new Date(project.startDate) : null;
  const end = project.endDate ? new Date(project.endDate) : null;

  // Task metrics
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => (t.status || "").toUpperCase() === "DONE").length;
  const overdueTasks = tasks.filter(t => t.endDate && new Date(t.endDate) < now && (t.status || "").toUpperCase() !== "DONE").length;

  // Risk metrics
  const risksOpen = risks.filter(r => r.status === "OPEN").length;
  const risksCritical = risks.filter(r => (r.score || 0) >= 12 && r.status === "OPEN").length;

  // ── EVM Computations ──────────────────────────────────────────────────────────

  // Project timeline state
  const projectHasStarted = start !== null && start <= now;
  const hasEarnedValue = doneTasks > 0 && totalTasks > 0;

  // Planned Value — only when project has actually started with a timeline
  let pv = 0;
  let spi: number | null = null;
  if (projectHasStarted && start && end) {
    const totalDuration = Math.max(1, end.getTime() - start.getTime());
    const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start.getTime()));
    const plannedProgress = elapsed / totalDuration;
    pv = Math.round(bac * plannedProgress);
  }

  // Earned Value — based on task completion ratio × budget
  const ev = hasEarnedValue ? Math.round(bac * (doneTasks / totalTasks)) : 0;

  // SPI — only when project is underway with a valid timeline
  if (projectHasStarted && pv > 0) {
    spi = Math.round((ev / pv) * 100) / 100;
  }

  // Actual Cost — from real CostEntry records ONLY
  const actualCostEntries = costEntries.filter(e => e.entryType === "ACTUAL");
  const acFromEntries = actualCostEntries.reduce((sum, e) => sum + e.amount, 0);
  const hasRealCosts = actualCostEntries.length > 0;
  const ac: number | null = hasRealCosts ? Math.round(acFromEntries) : null;

  // CPI — only when real cost data exists
  let cpi: number | null = null;
  if (hasRealCosts && ac !== null && ac > 0 && ev > 0) {
    cpi = Math.round((ev / ac) * 100) / 100;
  }

  // Forecast metrics — only computed when CPI is known
  const eac: number | null = cpi !== null && cpi > 0 ? Math.round(bac / cpi) : null;
  const etc: number | null = eac !== null && ac !== null ? eac - ac : null;
  const vac: number | null = eac !== null ? bac - eac : null;
  const tcpi: number | null =
    ac !== null && bac - ac > 0
      ? Math.round(((bac - ev) / (bac - ac)) * 100) / 100
      : null;

  // RAG status — only from real indicators
  const ragStatus: "GREEN" | "AMBER" | "RED" =
    (spi !== null && spi < 0.9) || (cpi !== null && cpi < 0.9) ? "RED" :
    (spi !== null && spi < 0.95) || (cpi !== null && cpi < 0.95) ? "AMBER" :
    (risksCritical > 0) ? "AMBER" : "GREEN";

  // ── S-Curve ──────────────────────────────────────────────────────────────────
  // Only generate when project has start + end dates
  const sCurve: Array<{ month: string; pv: number; ev: number | null; ac: number | null; eac: number | null }> = [];

  if (start && end) {
    const totalDuration = Math.max(1, end.getTime() - start.getTime());
    const totalMonths = Math.max(Math.ceil(totalDuration / (30 * 24 * 3600_000)), 6);
    const currentMonthIndex = Math.floor(
      Math.max(0, Math.min(totalDuration, now.getTime() - start.getTime())) / (30 * 24 * 3600_000)
    );

    // Build cumulative AC by month from real cost entries
    const acByMonth: Map<number, number> = new Map();
    for (const entry of actualCostEntries) {
      const monthIdx = Math.floor((new Date(entry.recordedAt).getTime() - start.getTime()) / (30 * 24 * 3600_000));
      if (monthIdx >= 0 && monthIdx < totalMonths) {
        acByMonth.set(monthIdx, (acByMonth.get(monthIdx) ?? 0) + entry.amount);
      }
    }

    // Cumulative AC
    let cumulativeAc = 0;
    const cumulativeAcByMonth: number[] = [];
    for (let i = 0; i < totalMonths; i++) {
      cumulativeAc += acByMonth.get(i) ?? 0;
      cumulativeAcByMonth.push(cumulativeAc);
    }

    for (let i = 0; i < totalMonths; i++) {
      const monthProgress = (i + 1) / totalMonths;
      // S-curve (sigmoid) formula for smooth PV progression
      const sCurvePct = 3 * monthProgress * monthProgress - 2 * monthProgress * monthProgress * monthProgress;
      const monthPv = Math.round(bac * sCurvePct);
      const isPast = i <= currentMonthIndex;

      // EV: scale actual EV progress to the month's time position (past months only)
      let monthEv: number | null = null;
      if (isPast && projectHasStarted) {
        // Interpolate EV linearly up to current EV
        const monthProportion = currentMonthIndex > 0 ? i / currentMonthIndex : 1;
        monthEv = i === currentMonthIndex ? ev : Math.round(ev * monthProportion);
      }

      // AC: use real cumulative cost entries for past months
      let monthAc: number | null = null;
      if (isPast && hasRealCosts) {
        monthAc = Math.round(cumulativeAcByMonth[i]);
      }

      // EAC projection line starts at current month
      const monthEac = eac !== null && i >= currentMonthIndex ? eac : null;

      const date = new Date(start.getTime() + i * 30 * 24 * 3600_000);
      const label = date.toLocaleString("en-GB", { month: "short", year: "2-digit" });
      sCurve.push({ month: label, pv: monthPv, ev: monthEv, ac: monthAc, eac: monthEac });
    }
  }

  return NextResponse.json({
    data: {
      budget: bac,
      pv,
      ev,
      ac,
      spi,
      cpi,
      eac,
      etc,
      vac,
      tcpi,
      ragStatus,
      tasksTotal: totalTasks,
      tasksComplete: doneTasks,
      tasksOverdue: overdueTasks,
      sCurve,
      risksOpen,
      risksCritical,
      forecastEndDate: snapshot?.forecastEndDate ?? null,
      onBudgetProbability: snapshot?.onBudgetProbability ?? null,
    },
  });
}
