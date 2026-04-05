import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

/**
 * GET /api/projects/:id/scorecard — Project Scorecard
 *
 * Aggregates all project outcome objectives into a single view.
 * Used to measure whether the agent is delivering project success,
 * not just running autonomously.
 *
 * 8 objectives, each scored 0-100 with a RAG status.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const [project, tasks, risks, issues, stakeholders, approvals, activities, decisions] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { budget: true, startDate: true, endDate: true, status: true } }),
    db.task.findMany({ where: { projectId }, select: { status: true, storyPoints: true, endDate: true, createdAt: true, updatedAt: true } }),
    db.risk.findMany({ where: { projectId }, select: { score: true, status: true, createdAt: true } }),
    db.issue.findMany({ where: { projectId }, select: { priority: true, status: true, createdAt: true } }),
    db.stakeholder.findMany({ where: { projectId }, select: { sentiment: true, power: true, interest: true } }),
    db.approval.findMany({ where: { projectId }, select: { status: true, createdAt: true, resolvedAt: true } }),
    db.agentActivity.findMany({
      where: { agent: { deployments: { some: { projectId, isActive: true } } } },
      select: { type: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.agentDecision.findMany({
      where: { agent: { deployments: { some: { projectId, isActive: true } } } },
      select: { status: true, createdAt: true },
    }),
  ]);

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const totalTasks = tasks.length || 1;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const overdueTasks = tasks.filter(t => t.endDate && new Date(t.endDate) < now && t.status !== "DONE").length;

  // ── 1. On-Time Delivery (SPI) ──
  const start = project.startDate ? new Date(project.startDate) : now;
  const end = project.endDate ? new Date(project.endDate) : new Date(now.getTime() + 90 * 86400000);
  const totalDuration = Math.max(1, end.getTime() - start.getTime());
  const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start.getTime()));
  const plannedProgress = elapsed / totalDuration;
  const actualProgress = doneTasks / totalTasks;
  const spi = plannedProgress > 0 ? actualProgress / plannedProgress : 1;
  const scheduleScore = Math.min(100, Math.max(0, Math.round(spi * 100)));
  const scheduleRag = spi >= 0.95 ? "GREEN" : spi >= 0.85 ? "AMBER" : "RED";

  // ── 2. On-Budget Delivery (CPI) ──
  const budget = project.budget || 0;
  const ev = Math.round(budget * actualProgress);
  const ac = Math.round(ev * 1.05); // Simplified
  const cpi = ac > 0 ? ev / ac : 1;
  const budgetScore = Math.min(100, Math.max(0, Math.round(cpi * 100)));
  const budgetRag = cpi >= 0.95 ? "GREEN" : cpi >= 0.85 ? "AMBER" : "RED";

  // ── 3. Scope Completeness ──
  const scopeScore = Math.round((doneTasks / totalTasks) * 100);
  const scopeRag = scopeScore >= 80 ? "GREEN" : scopeScore >= 50 ? "AMBER" : "RED";

  // ── 4. Risk Reduction ──
  const openRisks = risks.filter(r => r.status === "OPEN").length;
  const closedRisks = risks.filter(r => r.status === "closed" || r.status === "CLOSED").length;
  const criticalRisks = risks.filter(r => (r.score || 0) >= 12 && r.status === "OPEN").length;
  const riskReductionRate = risks.length > 0 ? closedRisks / risks.length : 1;
  const riskScore = Math.round(Math.max(0, (1 - criticalRisks * 0.2) * riskReductionRate * 100));
  const riskRag = criticalRisks === 0 ? "GREEN" : criticalRisks <= 2 ? "AMBER" : "RED";

  // ── 5. Stakeholder Satisfaction ──
  const sentimentMap: Record<string, number> = { positive: 1, neutral: 0.5, concerned: 0.2, negative: 0 };
  const avgSentiment = stakeholders.length > 0
    ? stakeholders.reduce((s, sh) => s + (sentimentMap[sh.sentiment || "neutral"] || 0.5), 0) / stakeholders.length
    : 0.5;
  const stakeholderScore = Math.round(avgSentiment * 100);
  const stakeholderRag = avgSentiment >= 0.7 ? "GREEN" : avgSentiment >= 0.4 ? "AMBER" : "RED";

  // ── 6. Quality (Issues) ──
  const openIssues = issues.filter(i => i.status === "OPEN" || i.status === "IN_PROGRESS").length;
  const resolvedIssues = issues.filter(i => i.status === "CLOSED" || i.status === "RESOLVED").length;
  const criticalIssues = issues.filter(i => i.priority === "CRITICAL" && i.status !== "CLOSED").length;
  const issueResolutionRate = issues.length > 0 ? resolvedIssues / issues.length : 1;
  const qualityScore = Math.round(Math.max(0, (issueResolutionRate * 100) - (criticalIssues * 15)));
  const qualityRag = criticalIssues === 0 && openIssues <= 3 ? "GREEN" : criticalIssues <= 1 ? "AMBER" : "RED";

  // ── 7. Agent Responsiveness ──
  // Measure: how quickly does the agent act after triggers?
  const proactiveAlerts = activities.filter(a => a.type === "proactive_alert").length;
  const totalActivities = activities.length;
  const activityRate = totalActivities > 0 ? Math.min(100, Math.round((totalActivities / 50) * 100)) : 0; // 50+ activities = 100%
  const responsivenessScore = Math.min(100, activityRate + (proactiveAlerts > 0 ? 20 : 0));
  const responsivenessRag = responsivenessScore >= 70 ? "GREEN" : responsivenessScore >= 40 ? "AMBER" : "RED";

  // ── 8. Governance Compliance ──
  const totalApprovals = approvals.length;
  const resolvedApprovals = approvals.filter(a => a.status !== "PENDING").length;
  const overdueApprovals = approvals.filter(a => {
    if (a.status !== "PENDING") return false;
    const hours = (now.getTime() - a.createdAt.getTime()) / 3600000;
    return hours > 24;
  }).length;
  const complianceRate = totalApprovals > 0 ? resolvedApprovals / totalApprovals : 1;
  const complianceScore = Math.round(Math.max(0, (complianceRate * 100) - (overdueApprovals * 10)));
  const complianceRag = overdueApprovals === 0 ? "GREEN" : overdueApprovals <= 2 ? "AMBER" : "RED";

  // ── Overall Score ──
  const objectives = [
    { id: "schedule", label: "On-Time Delivery", metric: `SPI: ${spi.toFixed(2)}`, score: scheduleScore, rag: scheduleRag, detail: `${overdueTasks} overdue tasks, ${Math.round(plannedProgress * 100)}% of timeline elapsed` },
    { id: "budget", label: "On-Budget Delivery", metric: `CPI: ${cpi.toFixed(2)}`, score: budgetScore, rag: budgetRag, detail: budget > 0 ? `$${(ev / 1000).toFixed(0)}K earned of $${(budget / 1000).toFixed(0)}K budget` : "No budget set" },
    { id: "scope", label: "Scope Completeness", metric: `${doneTasks}/${totalTasks} tasks`, score: scopeScore, rag: scopeRag, detail: `${doneTasks} done, ${tasks.filter(t => t.status === "IN_PROGRESS").length} in progress, ${tasks.filter(t => t.status === "BLOCKED").length} blocked` },
    { id: "risk", label: "Risk Reduction", metric: `${openRisks} open, ${criticalRisks} critical`, score: riskScore, rag: riskRag, detail: `${closedRisks}/${risks.length} risks resolved. ${criticalRisks} critical unmitigated.` },
    { id: "stakeholder", label: "Stakeholder Satisfaction", metric: `${Math.round(avgSentiment * 100)}% positive`, score: stakeholderScore, rag: stakeholderRag, detail: `${stakeholders.length} stakeholders tracked` },
    { id: "quality", label: "Quality", metric: `${openIssues} open issues`, score: qualityScore, rag: qualityRag, detail: `${resolvedIssues}/${issues.length} resolved. ${criticalIssues} critical outstanding.` },
    { id: "responsiveness", label: "Agent Responsiveness", metric: `${totalActivities} actions`, score: responsivenessScore, rag: responsivenessRag, detail: `${proactiveAlerts} proactive alerts, ${totalActivities} total activities` },
    { id: "compliance", label: "Governance Compliance", metric: `${resolvedApprovals}/${totalApprovals} resolved`, score: complianceScore, rag: complianceRag, detail: `${overdueApprovals} overdue approvals` },
  ];

  const overallScore = Math.round(objectives.reduce((s, o) => s + o.score, 0) / objectives.length);
  const overallRag = overallScore >= 75 ? "GREEN" : overallScore >= 50 ? "AMBER" : "RED";

  // Decision accuracy (from agent decisions)
  const approved = decisions.filter(d => d.status === "APPROVED" || d.status === "AUTO_APPROVED").length;
  const rejected = decisions.filter(d => d.status === "REJECTED").length;
  const decisionAccuracy = (approved + rejected) > 0 ? Math.round((approved / (approved + rejected)) * 100) : 100;

  return NextResponse.json({
    data: {
      overall: { score: overallScore, rag: overallRag },
      objectives,
      agentPerformance: {
        totalDecisions: decisions.length,
        approved,
        rejected,
        decisionAccuracy,
        totalActivities,
        proactiveAlerts,
      },
    },
  });
}
