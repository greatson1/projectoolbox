/**
 * Project Health — RAG Status & Health Scoring
 *
 * Per spec Section 5.11: 7-dimension composite health score
 * with threshold-triggered actions and exception escalation.
 */

import { db } from "@/lib/db";
import { calculateEvm } from "./evm-engine";
import type { ActionProposal } from "./decision-classifier";

export type RagStatus = "GREEN" | "AMBER" | "RED";

export interface ProjectHealth {
  overall: RagStatus;
  dimensions: {
    schedule: { status: RagStatus; score: number; detail: string };
    budget: { status: RagStatus; score: number; detail: string };
    scope: { status: RagStatus; score: number; detail: string };
    quality: { status: RagStatus; score: number; detail: string };
    risk: { status: RagStatus; score: number; detail: string };
    team: { status: RagStatus; score: number; detail: string };
    stakeholder: { status: RagStatus; score: number; detail: string };
  };
  redCount: number;
  amberCount: number;
  consecutiveAmberDays: number;
}

/**
 * Calculate the full 7-dimension project health.
 */
export async function calculateProjectHealth(projectId: string): Promise<ProjectHealth> {
  const [tasks, risks, issues, stakeholders, evm] = await Promise.all([
    db.task.findMany({ where: { projectId } }),
    db.risk.findMany({ where: { projectId } }),
    db.issue.findMany({ where: { projectId } }),
    db.stakeholder.findMany({ where: { projectId } }),
    calculateEvm(projectId),
  ]);

  const totalTasks = tasks.length || 1;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const blockedTasks = tasks.filter(t => t.status === "BLOCKED").length;
  const overdueTasks = tasks.filter(t => t.endDate && new Date(t.endDate) < new Date() && t.status !== "DONE").length;

  // 1. Schedule
  const spi = evm?.spi || 1;
  const scheduleStatus: RagStatus = spi >= 0.95 ? "GREEN" : spi >= 0.9 ? "AMBER" : "RED";
  const schedule = { status: scheduleStatus, score: Math.round(spi * 100), detail: `SPI: ${spi}, ${overdueTasks} overdue tasks` };

  // 2. Budget
  const cpi = evm?.cpi || 1;
  const budgetStatus: RagStatus = cpi >= 0.95 ? "GREEN" : cpi >= 0.9 ? "AMBER" : "RED";
  const budget = { status: budgetStatus, score: Math.round(cpi * 100), detail: `CPI: ${cpi}` };

  // 3. Scope (change requests)
  const crs = await db.changeRequest.findMany({ where: { projectId } });
  const unapprovedCrs = crs.filter(cr => cr.status === "SUBMITTED" || cr.status === "UNDER_REVIEW").length;
  const scopeStatus: RagStatus = unapprovedCrs === 0 ? "GREEN" : unapprovedCrs <= 2 ? "AMBER" : "RED";
  const scope = { status: scopeStatus, score: Math.max(0, 100 - unapprovedCrs * 20), detail: `${unapprovedCrs} unapproved CRs, ${crs.length} total` };

  // 4. Quality (issues + defects)
  const openIssues = issues.filter(i => i.status === "OPEN" || i.status === "IN_PROGRESS").length;
  const criticalIssues = issues.filter(i => i.priority === "CRITICAL" && i.status !== "CLOSED").length;
  const qualityStatus: RagStatus = criticalIssues > 0 ? "RED" : openIssues > 5 ? "AMBER" : "GREEN";
  const quality = { status: qualityStatus, score: Math.max(0, 100 - criticalIssues * 30 - openIssues * 5), detail: `${openIssues} open issues, ${criticalIssues} critical` };

  // 5. Risk
  const criticalRisks = risks.filter(r => (r.score || 0) >= 12 && r.status === "OPEN").length;
  const highRisks = risks.filter(r => (r.score || 0) >= 9 && r.status === "OPEN").length;
  const riskStatus: RagStatus = criticalRisks > 0 ? "RED" : highRisks > 2 ? "AMBER" : "GREEN";
  const riskDim = { status: riskStatus, score: Math.max(0, 100 - criticalRisks * 25 - highRisks * 10), detail: `${criticalRisks} critical, ${highRisks} high risks` };

  // 6. Team
  const capacityUtil = totalTasks > 0 ? (totalTasks - doneTasks) / totalTasks : 0;
  const teamStatus: RagStatus = blockedTasks > 3 || capacityUtil > 0.9 ? "RED" : blockedTasks > 1 ? "AMBER" : "GREEN";
  const team = { status: teamStatus, score: Math.max(0, 100 - blockedTasks * 15), detail: `${blockedTasks} blocked, ${Math.round(capacityUtil * 100)}% utilisation` };

  // 7. Stakeholder
  const avgSentiment = stakeholders.length > 0 ? stakeholders.reduce((s, sh) => {
    const sent = sh.sentiment === "positive" ? 1 : sh.sentiment === "concerned" ? -1 : 0;
    return s + sent;
  }, 0) / stakeholders.length : 0;
  const stakeholderStatus: RagStatus = avgSentiment > 0.3 ? "GREEN" : avgSentiment > -0.3 ? "AMBER" : "RED";
  const stakeholderDim = { status: stakeholderStatus, score: Math.round((avgSentiment + 1) * 50), detail: `Avg sentiment: ${avgSentiment.toFixed(2)}` };

  const dimensions = { schedule, budget, scope, quality, risk: riskDim, team, stakeholder: stakeholderDim };
  const statuses = Object.values(dimensions).map(d => d.status);
  const redCount = statuses.filter(s => s === "RED").length;
  const amberCount = statuses.filter(s => s === "AMBER").length;

  const overall: RagStatus = redCount >= 2 ? "RED" : redCount >= 1 || amberCount >= 3 ? "AMBER" : "GREEN";

  return { overall, dimensions, redCount, amberCount, consecutiveAmberDays: 0 };
}

/**
 * Check project health and generate intervention proposals.
 */
export async function checkProjectHealth(projectId: string, agentId: string): Promise<ActionProposal[]> {
  const health = await calculateProjectHealth(projectId);
  const proposals: ActionProposal[] = [];

  // Exception: 2+ dimensions RED → Exception Report (always HITL)
  if (health.redCount >= 2) {
    const redDims = Object.entries(health.dimensions).filter(([, d]) => d.status === "RED").map(([k]) => k);
    proposals.push({
      type: "ESCALATION",
      description: `PROJECT EXCEPTION: ${health.redCount} dimensions are RED (${redDims.join(", ")}). Exception Report required for Sponsor/Steering Committee.`,
      reasoning: `Project health has deteriorated to exception level. ${redDims.map(d => `${d}: ${health.dimensions[d as keyof typeof health.dimensions].detail}`).join(". ")}. Per governance framework, this requires immediate escalation regardless of autonomy level.`,
      confidence: 0.95,
      scheduleImpact: 4,
      costImpact: 3,
      scopeImpact: 2,
      stakeholderImpact: 4,
    });
  }

  // Each RED dimension → Corrective Action Plan
  for (const [dim, data] of Object.entries(health.dimensions)) {
    if (data.status === "RED") {
      proposals.push({
        type: "DOCUMENT_GENERATION",
        description: `Generate Corrective Action Plan for ${dim} (currently RED: ${data.detail})`,
        reasoning: `The ${dim} dimension is RED. A Corrective Action Plan is needed with options for recovery. ${data.detail}.`,
        confidence: 0.85,
        scheduleImpact: 2,
        costImpact: dim === "budget" ? 3 : 1,
        scopeImpact: dim === "scope" ? 3 : 1,
        stakeholderImpact: 2,
      });
    }
  }

  return proposals;
}
