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
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const [project, tasks, risks, issues, stakeholders, changeRequests, phases, deployment, activities, artefacts, approvals] = await Promise.all([
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

  // EVM (simplified — VPS has full calculation)
  const budget = project.budget || 0;
  const now = new Date();
  const start = project.startDate ? new Date(project.startDate) : now;
  const end = project.endDate ? new Date(project.endDate) : new Date(now.getTime() + 90 * 24 * 3600000);
  const totalDuration = Math.max(1, end.getTime() - start.getTime());
  const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start.getTime()));
  const plannedProgress = elapsed / totalDuration;
  const actualProgress = totalTasks > 0 ? doneTasks / totalTasks : 0;
  const pv = Math.round(budget * plannedProgress);
  const ev = Math.round(budget * actualProgress);
  const ac = Math.round(ev * 1.05); // Simplified — real AC from VPS
  const spi = pv > 0 ? Math.round((ev / pv) * 100) / 100 : 1;
  const cpi = ac > 0 ? Math.round((ev / ac) * 100) / 100 : 1;

  // Health RAG
  const scheduleHealth = spi >= 0.95 ? "GREEN" : spi >= 0.9 ? "AMBER" : "RED";
  const budgetHealth = cpi >= 0.95 ? "GREEN" : cpi >= 0.9 ? "AMBER" : "RED";
  const riskHealth = criticalRisks > 0 ? "RED" : highRisks > 2 ? "AMBER" : "GREEN";
  const overallHealth = [scheduleHealth, budgetHealth, riskHealth].includes("RED") ? "RED"
    : [scheduleHealth, budgetHealth, riskHealth].filter(h => h === "AMBER").length >= 2 ? "AMBER" : "GREEN";

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
      evm: { budget, pv, ev, ac, spi, cpi, eac: cpi > 0 ? Math.round(budget / cpi) : budget, scheduleHealth, budgetHealth },
      health: { overall: overallHealth, schedule: scheduleHealth, budget: budgetHealth, risk: riskHealth },
      phases: { current: currentPhase, status: deployment?.phaseStatus || "active", list: phaseProgress },
      agent: deployment?.agent ? { name: deployment.agent.name, status: deployment.agent.status, level: deployment.agent.autonomyLevel, lastCycle: deployment.lastCycleAt } : null,
      activities: activities.map(a => ({ type: a.type, summary: a.summary, date: a.createdAt, metadata: a.metadata })),
      artefacts: artefacts.map(a => ({ id: a.id, name: a.name, status: a.status, format: a.format, version: a.version, date: a.createdAt })),
      pendingApprovals: approvals,
    },
  });
}
