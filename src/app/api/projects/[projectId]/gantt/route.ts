import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { EXCLUDE_PM_OVERHEAD } from "@/lib/agents/task-filters";
import { buildCpmInput, baselineCpm, forecastCpm, monteCarloForecast } from "@/lib/cpm";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

// GET /api/projects/:id/gantt — Full task tree with dates for Gantt rendering,
// plus the CPM layer: critical path, float, forecast finish, and a Monte
// Carlo completion forecast. Everything schedule-related is COMPUTED here
// from live tasks + resolved dependencies — Task.isCriticalPath is an output
// of this engine (persisted back for older views), never an input.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const tasks = await db.task.findMany({
    where: { projectId, ...EXCLUDE_PM_OVERHEAD },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, title: true, status: true, priority: true,
      startDate: true, endDate: true, progress: true,
      assigneeId: true, parentId: true, phaseId: true,
      dependencies: true, isCriticalPath: true,
      storyPoints: true, estimatedHours: true, actualHours: true,
    },
  });

  const phases = await db.phase.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, status: true, startDate: true, endDate: true },
  });

  // Undated tasks render as invisible zero-width bars on the Gantt (Kanban
  // projects seed work items with no dates by design). Fall back to the
  // owning phase's window, then the project window, so every row draws.
  // The fallback is presentation-only — the DB rows keep null dates.
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { startDate: true, endDate: true },
  });
  const defaultStart = project?.startDate ?? new Date();
  const defaultEnd = project?.endDate ?? new Date(defaultStart.getTime() + 30 * 86_400_000);
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const phaseByName = new Map(phases.map((p) => [p.name, p]));
  const withDates = tasks.map((t) => {
    if (t.startDate || t.endDate) return { ...t, datesInferred: false };
    const phase = (t.phaseId && (phaseById.get(t.phaseId) || phaseByName.get(t.phaseId))) || null;
    return {
      ...t,
      startDate: phase?.startDate ?? defaultStart,
      endDate: phase?.endDate ?? defaultEnd,
      datesInferred: true,
    };
  });

  // ── CPM layer ──────────────────────────────────────────────────────────
  // Baseline: anchored at the earliest task start, full durations, stored
  // dates as start-no-earlier-than constraints → float + critical flags.
  // Forecast: anchored at NOW, remaining durations only → projected finish.
  const now = Date.now();
  const baselineBuilt = buildCpmInput(withDates, phases);
  const baseline = baselineCpm(baselineBuilt.input);
  const forecastBuilt = buildCpmInput(withDates, phases, { anchorMs: now });
  const forecast = forecastCpm(forecastBuilt.input);
  const targetMs = project?.endDate?.getTime() ?? null;
  const targetDaysFromNow = targetMs !== null ? (targetMs - now) / DAY_MS : null;
  const mc = monteCarloForecast(forecastBuilt.input, targetDaysFromNow);

  const criticalSet = new Set(baseline.criticalIds);
  const dependsOnResolved = new Map<string, string[]>();
  for (const e of baselineBuilt.edges) {
    dependsOnResolved.set(e.to, [...(dependsOnResolved.get(e.to) ?? []), e.from]);
  }

  const tasksOut = withDates.map((t) => {
    const b = baseline.tasks.get(t.id);
    return {
      ...t,
      // computed layer (undefined for parent/container rows)
      isCriticalPath: b ? b.critical : false,
      floatDays: b ? Math.round(b.float * 10) / 10 : null,
      dependsOnResolved: dependsOnResolved.get(t.id) ?? [],
    };
  });

  // Persist the computed critical flags so older views that still read
  // Task.isCriticalPath agree with the engine. Bounded: only changed rows.
  const flips = tasksOut.filter((t) => {
    const stored = tasks.find((x) => x.id === t.id)?.isCriticalPath ?? false;
    return baseline.tasks.has(t.id) && stored !== t.isCriticalPath;
  });
  if (flips.length > 0 && flips.length <= 200) {
    const nowCritical = flips.filter((t) => t.isCriticalPath).map((t) => t.id);
    const nowSlack = flips.filter((t) => !t.isCriticalPath).map((t) => t.id);
    try {
      if (nowCritical.length) await db.task.updateMany({ where: { id: { in: nowCritical } }, data: { isCriticalPath: true } });
      if (nowSlack.length) await db.task.updateMany({ where: { id: { in: nowSlack } }, data: { isCriticalPath: false } });
    } catch (e) {
      console.error("[gantt] persisting computed critical flags failed (non-blocking):", e);
    }
  }

  const baselineFinishMs = baselineBuilt.anchorMs + baseline.finishDays * DAY_MS;
  const forecastFinishMs = now + forecast.finishDays * DAY_MS;

  return NextResponse.json({
    data: {
      tasks: tasksOut,
      phases,
      cpm: {
        anchorDate: new Date(baselineBuilt.anchorMs).toISOString(),
        baselineFinishDate: new Date(baselineFinishMs).toISOString(),
        forecastFinishDate: new Date(forecastFinishMs).toISOString(),
        targetDate: targetMs !== null ? new Date(targetMs).toISOString() : null,
        slipDays: targetMs !== null ? Math.round((forecastFinishMs - targetMs) / DAY_MS) : null,
        criticalIds: baseline.criticalIds,
        resolvedDependencies: baselineBuilt.edges.length,
        unresolvedDependencies: baselineBuilt.unresolvedDeps.length,
        monteCarlo: mc
          ? {
              runs: mc.runs,
              p50Date: new Date(now + mc.p50Days * DAY_MS).toISOString(),
              p85Date: new Date(now + mc.p85Days * DAY_MS).toISOString(),
              onTargetProb: mc.onTargetProb,
            }
          : null,
      },
    },
  });
}
