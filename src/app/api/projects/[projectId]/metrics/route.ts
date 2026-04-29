import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { EXCLUDE_PM_OVERHEAD } from "@/lib/agents/task-filters";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:id/metrics — Aggregated project metrics
 *
 * Returns everything the dashboard and project detail pages need:
 * task counts, risk counts, EVM indicators, health RAG, phase progress,
 * recent activities, and artefact counts.
 *
 * EVM is only computed when there is real earned-value data:
 *  - Budget must be set (> 0)
 *  - At least one task must be DONE (ev > 0)
 *  - CPI is only shown when there are real ACTUAL CostEntry records
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const nowISO = new Date();
  const taskWhere = { projectId, ...EXCLUDE_PM_OVERHEAD };
  const [
    project,
    tasksByStatus,            // groupBy → no row materialisation
    overdueTasksCount,
    spSums,
    risksOpenWithScore,       // small projection, only OPEN risks
    risksByCategoryRows,
    issueStatusGroup,
    issueCriticalOpenCount,
    stakeholders,
    changeRequests,
    phases,
    deployment,
    activities,
    artefacts,
    approvals,
    actualCosts,
  ] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, status: true, methodology: true, budget: true, startDate: true, endDate: true } }),
    db.task.groupBy({ by: ["status"], where: taskWhere, _count: true, _sum: { storyPoints: true } }),
    db.task.count({ where: { ...taskWhere, endDate: { lt: nowISO }, status: { not: "DONE" } } }),
    db.task.aggregate({ where: taskWhere, _sum: { storyPoints: true } }),
    db.risk.findMany({ where: { projectId, status: "OPEN" }, select: { score: true } }),
    db.risk.groupBy({ by: ["category"], where: { projectId }, _count: true }),
    db.issue.groupBy({ by: ["status"], where: { projectId }, _count: true }),
    db.issue.count({ where: { projectId, priority: "CRITICAL", status: { not: "CLOSED" } } }),
    db.stakeholder.count({ where: { projectId } }),
    db.changeRequest.count({ where: { projectId } }),
    db.phase.findMany({ where: { projectId }, orderBy: { order: "asc" }, select: { name: true, status: true, order: true } }),
    db.agentDeployment.findFirst({ where: { projectId, isActive: true }, include: { agent: { select: { name: true, status: true, autonomyLevel: true } } } }),
    db.agentActivity.findMany({
      where: { agent: { deployments: { some: { projectId, isActive: true } } } },
      orderBy: { createdAt: "desc" }, take: 15,
      select: { type: true, summary: true, createdAt: true, metadata: true },
    }),
    // Cap artefacts at 30 most-recent — the dashboard tile shows top 5–10 and
    // the full list lives on /projects/:id/artefacts. Pulling unbounded rows
    // here was the heaviest query on long-running projects.
    db.agentArtefact.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, name: true, status: true, format: true, version: true, createdAt: true },
    }),
    db.approval.findMany({ where: { projectId, status: "PENDING" }, select: { id: true, title: true, urgency: true, createdAt: true } }),
    // Real actual costs — used for genuine CPI calculation
    db.costEntry.aggregate({
      where: { projectId, entryType: "ACTUAL" },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── Task metrics derived from groupBy + count + aggregate ──
  // Earlier this materialised every task row in JS; now we lean on the SQL
  // engine. On large projects this is the difference between transferring
  // hundreds of rows over the wire and a handful of integers.
  const findStatus = (s: string) => tasksByStatus.find(g => g.status === s);
  const totalTasks = tasksByStatus.reduce((s, g) => s + g._count, 0);
  const doneTasks = findStatus("DONE")?._count ?? 0;
  const inProgressTasks = findStatus("IN_PROGRESS")?._count ?? 0;
  const blockedTasks = findStatus("BLOCKED")?._count ?? 0;
  const overdueTasks = overdueTasksCount;
  const totalSP = spSums._sum.storyPoints ?? 0;
  const doneSP = findStatus("DONE")?._sum.storyPoints ?? 0;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // ── Risk metrics ──
  // Total comes from the by-category aggregate (covers every status). High /
  // critical are filtered from the OPEN-with-score projection — only OPEN
  // risks count as critical/high so we never pull CLOSED rows.
  const totalRisks = risksByCategoryRows.reduce((s, g) => s + g._count, 0);
  const criticalRisks = risksOpenWithScore.filter(r => (r.score || 0) >= 12).length;
  const highRisks = risksOpenWithScore.filter(r => (r.score || 0) >= 9).length;
  const risksByCategory: Record<string, number> = {};
  for (const g of risksByCategoryRows) {
    risksByCategory[g.category || "Other"] = g._count;
  }

  // ── Issue metrics ──
  const totalIssues = issueStatusGroup.reduce((s, g) => s + g._count, 0);
  const openIssues = issueStatusGroup
    .filter(g => g.status === "OPEN" || g.status === "IN_PROGRESS")
    .reduce((s, g) => s + g._count, 0);
  const criticalIssues = issueCriticalOpenCount;

  // ── EVM ──
  // Only meaningful when:
  //   1. Budget is set
  //   2. At least one task is done (ev > 0)
  //   3. Project has a start date in the past
  const budget = project.budget || 0;
  const now = new Date();
  const start = project.startDate ? new Date(project.startDate) : null;
  const end = project.endDate ? new Date(project.endDate) : null;

  const projectHasStarted = start !== null && start <= now;
  const hasEarnedValue = doneTasks > 0 && budget > 0;

  // Planned Value — only if project has actually started
  let pv = 0;
  let spi: number | null = null;
  let timeElapsedRatio = 0;
  if (projectHasStarted && budget > 0 && end) {
    const totalDuration = Math.max(1, end.getTime() - start!.getTime());
    const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start!.getTime()));
    timeElapsedRatio = elapsed / totalDuration;
    pv = Math.round(budget * timeElapsedRatio);
  }

  // Earned Value
  const ev = hasEarnedValue ? Math.round(budget * (doneTasks / totalTasks)) : 0;

  // Actual Cost — from real CostEntry records only. Never fake it.
  const realAC = actualCosts._sum.amount || 0;
  const hasRealCosts = actualCosts._count > 0;

  // SPI — only meaningful once the project is far enough into its timeline.
  // Early on, PV ≈ 0 makes EV/PV explode (e.g. 4.6× on day 3 of a 1-year plan)
  // even though the project isn't actually "ahead". Suppress until ≥15% elapsed.
  const SPI_MIN_ELAPSED = 0.15;
  const spiInsufficientData = projectHasStarted && timeElapsedRatio < SPI_MIN_ELAPSED;
  if (pv > 0 && ev >= 0 && !spiInsufficientData) {
    spi = Math.round((ev / pv) * 100) / 100;
  }

  // CPI — only when real actual costs exist
  let cpi: number | null = null;
  if (hasRealCosts && realAC > 0 && ev > 0) {
    cpi = Math.round((ev / realAC) * 100) / 100;
  }

  // EAC (Estimate at Completion) — only when CPI is real
  const eac = cpi && cpi > 0 ? Math.round(budget / cpi) : null;

  // A flag so the UI can decide whether to show EVM gauges at all.
  // True if the project has any earned-value signal — either real SPI/CPI
  // numbers, or just the start of work (ev > 0). Lets early projects show
  // Budget/Earned tiles with N/A gauges instead of an empty state.
  const hasRealEvm = projectHasStarted && (ev > 0 || spi !== null || cpi !== null);

  // Health RAG
  // Use only the metrics we actually have — fall back to task-based schedule health
  const scheduleRag = spi !== null
    ? (spi >= 0.95 ? "GREEN" : spi >= 0.9 ? "AMBER" : "RED")
    : (progressPct >= 50 ? "GREEN" : progressPct >= 25 ? "AMBER" : "GREEN"); // default GREEN when no EVM yet
  const budgetRag = cpi !== null
    ? (cpi >= 0.95 ? "GREEN" : cpi >= 0.9 ? "AMBER" : "RED")
    : "GREEN"; // no cost data → not in trouble yet
  const riskHealth = criticalRisks > 0 ? "RED" : highRisks > 2 ? "AMBER" : "GREEN";

  // Overall health rollup — a single RED dimension shouldn't push the whole
  // project to "Critical" if the other two are GREEN. That made an early
  // project with one critical risk read as Critical even when schedule and
  // budget were on track, which is misleading.
  // New rule:
  //   • ≥2 RED  → RED ("Critical")
  //   • 1 RED + ≥1 AMBER → RED
  //   • 1 RED + 2 GREEN → AMBER (worth attention, not catastrophic)
  //   • ≥2 AMBER → AMBER
  //   • else → GREEN
  const dims = [scheduleRag, budgetRag, riskHealth];
  const reds = dims.filter(d => d === "RED").length;
  const ambers = dims.filter(d => d === "AMBER").length;
  let overallHealth: "RED" | "AMBER" | "GREEN";
  if (reds >= 2 || (reds === 1 && ambers >= 1)) overallHealth = "RED";
  else if (reds === 1 || ambers >= 2) overallHealth = "AMBER";
  else overallHealth = "GREEN";

  // Phase progress
  const currentPhase = deployment?.currentPhase || phases.find(p => p.status === "ACTIVE")?.name || phases[0]?.name || "—";
  const phaseProgress = phases.map(p => ({ name: p.name, status: p.status, order: p.order }));

  // Current-phase completion — same source of truth as the artefacts page and
  // generate endpoint, so the status-bar banner can never claim "ready to
  // generate next phase" while PM tasks or delivery tasks still block.
  let currentPhaseCompletion: any = null;
  try {
    if (deployment?.currentPhase && deployment?.agentId) {
      const { getPhaseCompletion } = await import("@/lib/agents/phase-completion");
      const c = await getPhaseCompletion(projectId, deployment.currentPhase, deployment.agentId);
      currentPhaseCompletion = {
        phaseName: c.phaseName,
        artefacts: c.artefacts,
        pmTasks: c.pmTasks,
        deliveryTasks: c.deliveryTasks,
        overall: c.overall,
        canAdvance: c.canAdvance,
        blockers: c.blockers,
      };
    }
  } catch (e) {
    console.error("[metrics] currentPhaseCompletion failed:", e);
  }

  return NextResponse.json({
    data: {
      project: { ...project, progressPct },
      tasks: { total: totalTasks, done: doneTasks, inProgress: inProgressTasks, blocked: blockedTasks, overdue: overdueTasks, totalSP, doneSP },
      risks: { total: totalRisks, critical: criticalRisks, high: highRisks, byCategory: risksByCategory },
      issues: { total: totalIssues, open: openIssues, critical: criticalIssues },
      stakeholders,
      changeRequests,
      evm: {
        budget,
        pv,
        ev,
        ac: hasRealCosts ? realAC : null,      // null = no real data, don't show
        spi,                                     // null = not enough data yet
        cpi,                                     // null = no real cost tracking yet
        eac,
        hasRealEvm,
        hasRealCosts,
        spiInsufficientData,                     // true = project too early in timeline for SPI to be meaningful
        timeElapsedRatio,                        // 0..1 — how far through the planned timeline we are
        scheduleHealth: scheduleRag,
        budgetHealth: budgetRag,
      },
      health: { overall: overallHealth, schedule: scheduleRag, budget: budgetRag, risk: riskHealth },
      phases: { current: currentPhase, status: deployment?.phaseStatus || "active", list: phaseProgress, currentCompletion: currentPhaseCompletion },
      agent: deployment?.agent ? { name: deployment.agent.name, status: deployment.agent.status, level: deployment.agent.autonomyLevel, lastCycle: deployment.lastCycleAt } : null,
      activities: activities.map(a => ({ type: a.type, summary: a.summary, date: a.createdAt, metadata: a.metadata })),
      artefacts: artefacts.map(a => ({ id: a.id, name: a.name, status: a.status, format: a.format, version: a.version, date: a.createdAt })),
      pendingApprovals: approvals,
    },
  });
}
