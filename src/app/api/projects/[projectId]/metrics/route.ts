import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

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

  const [project, tasks, risks, issues, stakeholders, changeRequests, phases, deployment, activities, artefacts, approvals, actualCosts] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, status: true, methodology: true, budget: true, startDate: true, endDate: true } }),
    db.task.findMany({ where: { projectId }, select: { status: true, storyPoints: true, endDate: true, assigneeId: true } }),
    db.risk.findMany({ where: { projectId }, select: { score: true, status: true, category: true } }),
    db.issue.findMany({ where: { projectId }, select: { priority: true, status: true } }),
    db.stakeholder.count({ where: { projectId } }),
    db.changeRequest.count({ where: { projectId } }),
    db.phase.findMany({ where: { projectId }, orderBy: { order: "asc" }, select: { name: true, status: true, order: true } }),
    db.agentDeployment.findFirst({ where: { projectId, isActive: true }, include: { agent: { select: { name: true, status: true, autonomyLevel: true } } } }),
    db.agentActivity.findMany({
      where: { agent: { deployments: { some: { projectId, isActive: true } } } },
      orderBy: { createdAt: "desc" }, take: 15,
      select: { type: true, summary: true, createdAt: true, metadata: true },
    }),
    db.agentArtefact.findMany({ where: { projectId }, select: { id: true, name: true, status: true, format: true, version: true, createdAt: true } }),
    db.approval.findMany({ where: { projectId, status: "PENDING" }, select: { id: true, title: true, urgency: true, createdAt: true } }),
    // Real actual costs — used for genuine CPI calculation
    db.costEntry.aggregate({
      where: { projectId, entryType: "ACTUAL" },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Task metrics
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const inProgressTasks = tasks.filter(t => t.status === "IN_PROGRESS").length;
  const blockedTasks = tasks.filter(t => t.status === "BLOCKED").length;
  const overdueTasks = tasks.filter(t => t.endDate && new Date(t.endDate) < new Date() && t.status !== "DONE").length;
  const totalSP = tasks.reduce((s, t) => s + (t.storyPoints || 0), 0);
  const doneSP = tasks.filter(t => t.status === "DONE").reduce((s, t) => s + (t.storyPoints || 0), 0);
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Risk metrics
  const totalRisks = risks.length;
  const criticalRisks = risks.filter(r => (r.score || 0) >= 12 && r.status === "OPEN").length;
  const highRisks = risks.filter(r => (r.score || 0) >= 9 && r.status === "OPEN").length;
  const risksByCategory: Record<string, number> = {};
  risks.forEach(r => { const c = r.category || "Other"; risksByCategory[c] = (risksByCategory[c] || 0) + 1; });

  // Issue metrics
  const openIssues = issues.filter(i => i.status === "OPEN" || i.status === "IN_PROGRESS").length;
  const criticalIssues = issues.filter(i => i.priority === "CRITICAL" && i.status !== "CLOSED").length;

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
  if (projectHasStarted && budget > 0 && end) {
    const totalDuration = Math.max(1, end.getTime() - start!.getTime());
    const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start!.getTime()));
    const plannedProgress = elapsed / totalDuration;
    pv = Math.round(budget * plannedProgress);
  }

  // Earned Value
  const ev = hasEarnedValue ? Math.round(budget * (doneTasks / totalTasks)) : 0;

  // Actual Cost — from real CostEntry records only. Never fake it.
  const realAC = actualCosts._sum.amount || 0;
  const hasRealCosts = actualCosts._count > 0;

  // SPI — only when pv > 0 (project is underway with a timeline)
  if (pv > 0 && ev >= 0) {
    spi = Math.round((ev / pv) * 100) / 100;
  }

  // CPI — only when real actual costs exist
  let cpi: number | null = null;
  if (hasRealCosts && realAC > 0 && ev > 0) {
    cpi = Math.round((ev / realAC) * 100) / 100;
  }

  // EAC (Estimate at Completion) — only when CPI is real
  const eac = cpi && cpi > 0 ? Math.round(budget / cpi) : null;

  // A flag so the UI can decide whether to show EVM gauges at all
  const hasRealEvm = hasEarnedValue && projectHasStarted && (spi !== null || cpi !== null);

  // Health RAG
  // Use only the metrics we actually have — fall back to task-based schedule health
  const scheduleRag = spi !== null
    ? (spi >= 0.95 ? "GREEN" : spi >= 0.9 ? "AMBER" : "RED")
    : (progressPct >= 50 ? "GREEN" : progressPct >= 25 ? "AMBER" : "GREEN"); // default GREEN when no EVM yet
  const budgetRag = cpi !== null
    ? (cpi >= 0.95 ? "GREEN" : cpi >= 0.9 ? "AMBER" : "RED")
    : "GREEN"; // no cost data → not in trouble yet
  const riskHealth = criticalRisks > 0 ? "RED" : highRisks > 2 ? "AMBER" : "GREEN";
  const overallHealth = [scheduleRag, budgetRag, riskHealth].includes("RED") ? "RED"
    : [scheduleRag, budgetRag, riskHealth].filter(h => h === "AMBER").length >= 2 ? "AMBER" : "GREEN";

  // Phase progress
  const currentPhase = deployment?.currentPhase || phases.find(p => p.status === "ACTIVE")?.name || phases[0]?.name || "—";
  const phaseProgress = phases.map(p => ({ name: p.name, status: p.status, order: p.order }));

  return NextResponse.json({
    data: {
      project: { ...project, progressPct },
      tasks: { total: totalTasks, done: doneTasks, inProgress: inProgressTasks, blocked: blockedTasks, overdue: overdueTasks, totalSP, doneSP },
      risks: { total: totalRisks, critical: criticalRisks, high: highRisks, byCategory: risksByCategory },
      issues: { total: issues.length, open: openIssues, critical: criticalIssues },
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
        scheduleHealth: scheduleRag,
        budgetHealth: budgetRag,
      },
      health: { overall: overallHealth, schedule: scheduleRag, budget: budgetRag, risk: riskHealth },
      phases: { current: currentPhase, status: deployment?.phaseStatus || "active", list: phaseProgress },
      agent: deployment?.agent ? { name: deployment.agent.name, status: deployment.agent.status, level: deployment.agent.autonomyLevel, lastCycle: deployment.lastCycleAt } : null,
      activities: activities.map(a => ({ type: a.type, summary: a.summary, date: a.createdAt, metadata: a.metadata })),
      artefacts: artefacts.map(a => ({ id: a.id, name: a.name, status: a.status, format: a.format, version: a.version, date: a.createdAt })),
      pendingApprovals: approvals,
    },
  });
}
