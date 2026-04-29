import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { formatMoney, normaliseCurrency } from "@/lib/currency";
import { EXCLUDE_PM_OVERHEAD } from "@/lib/agents/task-filters";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:id/scorecard — Project Scorecard
 *
 * Aggregates project outcome objectives into a single view. Each objective
 * scores 0–100 with a RAG status. Objectives whose underlying data isn't
 * meaningful yet (e.g. SPI before the project is 15% in, CPI before any
 * actual cost is recorded, decision accuracy with 0 decisions) report
 * `score = null` and an honest "Awaiting data" detail. The composite
 * overall score is the average of the available scores only — not the
 * average over all 8 with N/A treated as 0 (which used to drag the
 * project to "At Risk" purely because tracking hadn't started).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const [project, tasks, risks, issues, stakeholders, approvals, activities, decisions, actualCosts] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: {
        budget: true, startDate: true, endDate: true, status: true,
        org: { select: { currency: true } },
      },
    }),
    db.task.findMany({ where: { projectId, ...EXCLUDE_PM_OVERHEAD }, select: { status: true, storyPoints: true, endDate: true, createdAt: true, updatedAt: true } }),
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
    // Real Actual Cost — was previously fabricated as EV × 1.05, which made
    // CPI always 0.95 regardless of reality. Now we sum genuine ACTUAL cost
    // entries; if none exist, the budget objective reports "Awaiting cost data".
    db.costEntry.aggregate({
      where: { projectId, entryType: "ACTUAL" },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const orgCurrency = normaliseCurrency((project as any).org?.currency);
  const now = new Date();
  const totalTasks = tasks.length || 1;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const overdueTasks = tasks.filter(t => t.endDate && new Date(t.endDate) < now && t.status !== "DONE").length;

  // ── 1. On-Time Delivery (SPI) ──
  // Suppress until ≥15% of the planned timeline has elapsed (PV ≈ 0 makes
  // SPI explode early and gives misleading "100/100" scores).
  const SPI_MIN_ELAPSED = 0.15;
  const start = project.startDate ? new Date(project.startDate) : null;
  const end = project.endDate ? new Date(project.endDate) : null;
  const projectHasStarted = start !== null && start <= now;
  let timeElapsedRatio = 0;
  if (projectHasStarted && end) {
    const totalDuration = Math.max(1, end.getTime() - start!.getTime());
    const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start!.getTime()));
    timeElapsedRatio = elapsed / totalDuration;
  }
  const actualProgress = doneTasks / totalTasks;
  const spiInsufficientData = !projectHasStarted || timeElapsedRatio < SPI_MIN_ELAPSED;
  const spi: number | null = spiInsufficientData
    ? null
    : timeElapsedRatio > 0
      ? actualProgress / timeElapsedRatio
      : null;
  const scheduleScore: number | null = spi === null ? null : Math.min(100, Math.max(0, Math.round(spi * 100)));
  const scheduleRag: "GREEN" | "AMBER" | "RED" = spi === null
    ? "AMBER"
    : spi >= 0.95 ? "GREEN" : spi >= 0.85 ? "AMBER" : "RED";
  const scheduleDetail = spiInsufficientData
    ? `Suppressed — only ${Math.round(timeElapsedRatio * 100)}% of timeline elapsed (need 15%)`
    : `${overdueTasks} overdue task${overdueTasks !== 1 ? "s" : ""}, ${Math.round(timeElapsedRatio * 100)}% of timeline elapsed`;

  // ── 2. On-Budget Delivery (CPI) ──
  // Real Actual Cost only — no fabrication. CPI is null when no actuals
  // have been logged so the score stops claiming a fake 95/100.
  const budget = project.budget || 0;
  const ev = budget > 0 ? Math.round(budget * actualProgress) : 0;
  const realAC = (actualCosts as any)?._sum?.amount || 0;
  const hasRealCosts = ((actualCosts as any)?._count || 0) > 0 && realAC > 0;
  const cpi: number | null = hasRealCosts && ev > 0 ? ev / realAC : null;
  const budgetScore: number | null = cpi === null ? null : Math.min(100, Math.max(0, Math.round(cpi * 100)));
  const budgetRag: "GREEN" | "AMBER" | "RED" = cpi === null
    ? "AMBER"
    : cpi >= 0.95 ? "GREEN" : cpi >= 0.85 ? "AMBER" : "RED";
  const budgetDetail = budget <= 0
    ? "No budget set"
    : !hasRealCosts
      ? `${formatMoney(ev, orgCurrency, { compact: true })} earned of ${formatMoney(budget, orgCurrency, { compact: true })} budget — no actual cost logged yet`
      : `${formatMoney(ev, orgCurrency, { compact: true })} earned of ${formatMoney(budget, orgCurrency, { compact: true })} budget · ${formatMoney(realAC, orgCurrency, { compact: true })} spent`;

  // ── 3. Scope Completeness ──
  const scopeScore = Math.round((doneTasks / totalTasks) * 100);
  const scopeRag: "GREEN" | "AMBER" | "RED" = scopeScore >= 80 ? "GREEN" : scopeScore >= 50 ? "AMBER" : "RED";

  // ── 4. Risk Reduction ──
  const openRisks = risks.filter(r => r.status === "OPEN").length;
  const closedRisks = risks.filter(r => r.status === "closed" || r.status === "CLOSED").length;
  const criticalRisks = risks.filter(r => (r.score || 0) >= 12 && r.status === "OPEN").length;
  const riskReductionRate = risks.length > 0 ? closedRisks / risks.length : 1;
  const riskScore = risks.length === 0
    ? null
    : Math.round(Math.max(0, (1 - criticalRisks * 0.2) * riskReductionRate * 100));
  const riskRag: "GREEN" | "AMBER" | "RED" = risks.length === 0
    ? "GREEN"
    : criticalRisks === 0 ? "GREEN" : criticalRisks <= 2 ? "AMBER" : "RED";

  // ── 5. Stakeholder Satisfaction ──
  // Only score when at least one stakeholder has a recorded sentiment;
  // otherwise an empty register would show a misleading 50/100.
  const sentimentMap: Record<string, number> = { positive: 1, neutral: 0.5, concerned: 0.2, negative: 0 };
  const stakeholdersWithSentiment = stakeholders.filter(s => !!s.sentiment);
  const avgSentiment = stakeholdersWithSentiment.length > 0
    ? stakeholdersWithSentiment.reduce((s, sh) => s + (sentimentMap[sh.sentiment || "neutral"] || 0.5), 0) / stakeholdersWithSentiment.length
    : null;
  const stakeholderScore: number | null = avgSentiment === null ? null : Math.round(avgSentiment * 100);
  const stakeholderRag: "GREEN" | "AMBER" | "RED" = avgSentiment === null
    ? "AMBER"
    : avgSentiment >= 0.7 ? "GREEN" : avgSentiment >= 0.4 ? "AMBER" : "RED";

  // ── 6. Quality (Issues) ──
  const openIssues = issues.filter(i => i.status === "OPEN" || i.status === "IN_PROGRESS").length;
  const resolvedIssues = issues.filter(i => i.status === "CLOSED" || i.status === "RESOLVED").length;
  const criticalIssues = issues.filter(i => i.priority === "CRITICAL" && i.status !== "CLOSED").length;
  const issueResolutionRate = issues.length > 0 ? resolvedIssues / issues.length : 1;
  // Score is null only when there's literally nothing to assess (no issues raised)
  // — that's a legitimately green default. Keep the score so users get a clean 100.
  const qualityScore = Math.round(Math.max(0, (issueResolutionRate * 100) - (criticalIssues * 15)));
  const qualityRag: "GREEN" | "AMBER" | "RED" = criticalIssues === 0 && openIssues <= 3 ? "GREEN" : criticalIssues <= 1 ? "AMBER" : "RED";

  // ── 7. Agent Responsiveness ──
  const proactiveAlerts = activities.filter(a => a.type === "proactive_alert").length;
  const totalActivities = activities.length;
  const activityRate = totalActivities > 0 ? Math.min(100, Math.round((totalActivities / 50) * 100)) : 0;
  const responsivenessScore = Math.min(100, activityRate + (proactiveAlerts > 0 ? 20 : 0));
  const responsivenessRag: "GREEN" | "AMBER" | "RED" = responsivenessScore >= 70 ? "GREEN" : responsivenessScore >= 40 ? "AMBER" : "RED";

  // ── 8. Governance Compliance ──
  const totalApprovals = approvals.length;
  const resolvedApprovals = approvals.filter(a => a.status !== "PENDING").length;
  const overdueApprovals = approvals.filter(a => {
    if (a.status !== "PENDING") return false;
    const hours = (now.getTime() - a.createdAt.getTime()) / 3600000;
    return hours > 24;
  }).length;
  const complianceRate = totalApprovals > 0 ? resolvedApprovals / totalApprovals : 1;
  const complianceScore: number | null = totalApprovals === 0
    ? null
    : Math.round(Math.max(0, (complianceRate * 100) - (overdueApprovals * 10)));
  const complianceRag: "GREEN" | "AMBER" | "RED" = totalApprovals === 0
    ? "GREEN"
    : overdueApprovals === 0 ? "GREEN" : overdueApprovals <= 2 ? "AMBER" : "RED";

  // ── Composite ──
  const objectives = [
    { id: "schedule", label: "On-Time Delivery", metric: spi === null ? "SPI: —" : `SPI: ${spi.toFixed(2)}`, score: scheduleScore, rag: scheduleRag, detail: scheduleDetail },
    { id: "budget", label: "On-Budget Delivery", metric: cpi === null ? "CPI: —" : `CPI: ${cpi.toFixed(2)}`, score: budgetScore, rag: budgetRag, detail: budgetDetail },
    { id: "scope", label: "Scope Completeness", metric: `${doneTasks}/${totalTasks} tasks`, score: scopeScore, rag: scopeRag, detail: `${doneTasks} done, ${tasks.filter(t => t.status === "IN_PROGRESS").length} in progress, ${tasks.filter(t => t.status === "BLOCKED").length} blocked` },
    { id: "risk", label: "Risk Reduction", metric: `${openRisks} open, ${criticalRisks} critical`, score: riskScore, rag: riskRag, detail: risks.length === 0 ? "No risks raised yet" : `${closedRisks}/${risks.length} risks resolved · ${criticalRisks} critical unmitigated` },
    { id: "stakeholder", label: "Stakeholder Satisfaction", metric: avgSentiment === null ? "Awaiting signals" : `${Math.round(avgSentiment * 100)}% positive`, score: stakeholderScore, rag: stakeholderRag, detail: stakeholdersWithSentiment.length === 0 ? `${stakeholders.length} stakeholders, no sentiment captured yet` : `${stakeholdersWithSentiment.length}/${stakeholders.length} with sentiment recorded` },
    { id: "quality", label: "Quality", metric: `${openIssues} open issues`, score: qualityScore, rag: qualityRag, detail: issues.length === 0 ? "No issues raised" : `${resolvedIssues}/${issues.length} resolved · ${criticalIssues} critical outstanding` },
    { id: "responsiveness", label: "Agent Responsiveness", metric: `${totalActivities} actions`, score: responsivenessScore, rag: responsivenessRag, detail: `${proactiveAlerts} proactive alerts · ${totalActivities} total activities` },
    { id: "compliance", label: "Governance Compliance", metric: totalApprovals === 0 ? "No approvals yet" : `${resolvedApprovals}/${totalApprovals} resolved`, score: complianceScore, rag: complianceRag, detail: totalApprovals === 0 ? "No approval activity to date" : `${overdueApprovals} overdue approval${overdueApprovals !== 1 ? "s" : ""}` },
  ];

  // Composite = average of objectives that ACTUALLY have a score. Don't
  // penalise the project for "Awaiting data" objectives — that drags every
  // new project to AMBER on launch day for no real reason.
  const scored = objectives.filter(o => typeof o.score === "number") as { score: number }[];
  const overallScore = scored.length === 0 ? 0 : Math.round(scored.reduce((s, o) => s + o.score, 0) / scored.length);
  const overallRag: "GREEN" | "AMBER" | "RED" = overallScore >= 75 ? "GREEN" : overallScore >= 50 ? "AMBER" : "RED";

  // Decision accuracy (null when no decisions yet — was previously a fake 100%)
  const approved = decisions.filter(d => d.status === "APPROVED" || d.status === "AUTO_APPROVED").length;
  const rejected = decisions.filter(d => d.status === "REJECTED").length;
  const decisionAccuracy: number | null = (approved + rejected) > 0
    ? Math.round((approved / (approved + rejected)) * 100)
    : null;

  return NextResponse.json({
    data: {
      overall: { score: overallScore, rag: overallRag, scoredObjectives: scored.length, totalObjectives: objectives.length },
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
