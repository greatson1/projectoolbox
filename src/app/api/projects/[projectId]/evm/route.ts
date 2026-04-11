import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/evm — Current EVM metrics
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  // Fetch project and tasks in parallel
  const [project, tasks, costEntries] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: { budget: true, startDate: true, endDate: true, name: true },
    }),
    db.task.findMany({
      where: { projectId },
      select: { status: true, storyPoints: true, endDate: true, estimatedHours: true, actualHours: true, phaseId: true },
    }),
    db.costEntry.findMany({
      where: { projectId },
      select: { entryType: true, amount: true, recordedAt: true },
    }),
  ]);

  if (!project?.budget) return NextResponse.json({ data: null });

  const bac = project.budget;
  const now = new Date();
  const start = project.startDate ? new Date(project.startDate) : now;
  const end = project.endDate ? new Date(project.endDate) : new Date(now.getTime() + 90 * 24 * 3600000);
  const totalDuration = Math.max(1, end.getTime() - start.getTime());
  const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start.getTime()));
  const plannedProgress = elapsed / totalDuration;

  const totalTasks = tasks.length || 1;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const actualProgress = doneTasks / totalTasks;

  // Compute AC from actual cost entries if available, else estimate from tasks
  const actualCostEntries = costEntries.filter(e => e.entryType === "ACTUAL");
  const acFromEntries = actualCostEntries.reduce((sum, e) => sum + e.amount, 0);

  const pv = Math.round(bac * plannedProgress);
  const ev = Math.round(bac * actualProgress);
  const ac = acFromEntries > 0 ? Math.round(acFromEntries) : Math.round(ev * 1.05);
  const spi = pv > 0 ? Math.round((ev / pv) * 100) / 100 : 1;
  const cpi = ac > 0 ? Math.round((ev / ac) * 100) / 100 : 1;
  const eac = cpi > 0 ? Math.round(bac / cpi) : bac;
  const etc = eac - ac;
  const vac = bac - eac;
  const tcpi = (bac - ac) > 0 ? Math.round(((bac - ev) / (bac - ac)) * 100) / 100 : 1;

  const overdue = tasks.filter(t => t.endDate && new Date(t.endDate) < now && t.status !== "DONE").length;

  // Build S-curve: generate monthly data points from project start to end
  const sCurve: Array<{ month: string; pv: number; ev: number | null; ac: number | null; eac: number | null }> = [];
  const totalMonths = Math.max(
    Math.ceil(totalDuration / (30 * 24 * 3600000)),
    6
  );
  const currentMonthIndex = Math.floor(elapsed / (30 * 24 * 3600000));

  for (let i = 0; i < totalMonths; i++) {
    const monthProgress = (i + 1) / totalMonths;
    // S-curve formula: smooth sigmoid approximation
    const sCurvePct = 3 * monthProgress * monthProgress - 2 * monthProgress * monthProgress * monthProgress;
    const monthPv = Math.round(bac * sCurvePct);
    const isActual = i <= currentMonthIndex;
    // Scale EV/AC proportionally to current actuals
    const monthEv = isActual ? Math.round(monthPv * (ev / Math.max(pv, 1)) * (plannedProgress > 0 ? 1 : 0.95)) : null;
    const monthAc = isActual && monthEv !== null ? Math.round(monthEv * (ac / Math.max(ev, 1))) : null;
    const monthEac = i >= currentMonthIndex ? eac : null;

    const date = new Date(start.getTime() + i * 30 * 24 * 3600000);
    const label = date.toLocaleString("en-GB", { month: "short", year: "2-digit" });
    sCurve.push({ month: label, pv: monthPv, ev: monthEv, ac: monthAc, eac: monthEac });
  }

  // Latest snapshot (read-only, for backwards compat)
  const snapshot = await db.metricsSnapshot.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

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
      ragStatus: spi >= 0.95 ? "GREEN" : spi >= 0.9 ? "AMBER" : "RED",
      tasksTotal: totalTasks,
      tasksComplete: doneTasks,
      tasksOverdue: overdue,
      sCurve,
      // Pass through snapshot fields if they exist for richer data
      ...(snapshot ? {
        risksOpen: snapshot.risksOpen,
        risksCritical: snapshot.risksCritical,
        forecastEndDate: snapshot.forecastEndDate,
        onBudgetProbability: snapshot.onBudgetProbability,
      } : {}),
    },
  });
}
