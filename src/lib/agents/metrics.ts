/**
 * Agent Performance Metrics
 *
 * Computed from existing AgentDecision, Approval, CreditTransaction data.
 * Per spec Section 8.3.
 */

import { db } from "@/lib/db";

export interface AgentMetrics {
  totalActions: number;
  totalDecisions: number;
  approvalRate: number;          // % of submitted approvals that were approved
  avgTimeToApproval: number;     // hours
  decisionAccuracy: number;      // approved / (approved + rejected)
  autonomyUtilisation: number;   // % of actions auto-executed vs sent to HITL
  creditsUsedThisMonth: number;
  monthlyBudget: number | null;
  creditEfficiency: number;      // actions per credit
}

export async function computeAgentMetrics(agentId: string): Promise<AgentMetrics> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [agent, decisions, activities, creditUsage] = await Promise.all([
    db.agent.findUnique({ where: { id: agentId }, select: { monthlyBudget: true } }),
    db.agentDecision.findMany({ where: { agentId } }),
    db.agentActivity.findMany({ where: { agentId } }),
    db.creditTransaction.aggregate({
      where: { agentId, type: "USAGE", createdAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
  ]);

  const totalDecisions = decisions.length;
  const approved = decisions.filter(d => d.status === "APPROVED" || d.status === "AUTO_APPROVED").length;
  const rejected = decisions.filter(d => d.status === "REJECTED").length;
  const autoApproved = decisions.filter(d => d.status === "AUTO_APPROVED").length;
  const humanApproved = decisions.filter(d => d.status === "APPROVED").length;

  // Approval rate: approved / total submitted to HITL
  const hitlSubmitted = humanApproved + rejected + decisions.filter(d => d.status === "DEFERRED").length;
  const approvalRate = hitlSubmitted > 0 ? Math.round((humanApproved / hitlSubmitted) * 100) : 100;

  // Avg time to approval (from linked approvals)
  const approvedDecisions = decisions.filter(d => d.status === "APPROVED" && d.approvalId);
  let totalApprovalTime = 0;
  let approvalTimeCount = 0;

  if (approvedDecisions.length > 0) {
    const approvalIds = approvedDecisions.map(d => d.approvalId!).filter(Boolean);
    const approvals = await db.approval.findMany({
      where: { id: { in: approvalIds }, resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true },
    });

    for (const a of approvals) {
      if (a.resolvedAt) {
        totalApprovalTime += (a.resolvedAt.getTime() - a.createdAt.getTime()) / (1000 * 60 * 60);
        approvalTimeCount++;
      }
    }
  }

  const avgTimeToApproval = approvalTimeCount > 0 ? Math.round(totalApprovalTime / approvalTimeCount * 10) / 10 : 0;

  // Decision accuracy: approved / (approved + rejected)
  const decisionAccuracy = (approved + rejected) > 0 ? Math.round((approved / (approved + rejected)) * 100) : 100;

  // Autonomy utilisation: auto-executed / total decisions
  const autonomyUtilisation = totalDecisions > 0 ? Math.round((autoApproved / totalDecisions) * 100) : 0;

  // Credits
  const creditsUsedThisMonth = Math.abs(creditUsage._sum.amount || 0);
  const totalActions = activities.length;

  // Credit efficiency: actions per credit
  const creditEfficiency = creditsUsedThisMonth > 0 ? Math.round((totalActions / creditsUsedThisMonth) * 10) / 10 : 0;

  return {
    totalActions,
    totalDecisions,
    approvalRate,
    avgTimeToApproval,
    decisionAccuracy,
    autonomyUtilisation,
    creditsUsedThisMonth,
    monthlyBudget: agent?.monthlyBudget || null,
    creditEfficiency,
  };
}
