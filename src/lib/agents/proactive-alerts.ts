/**
 * Proactive Alert System
 *
 * During each autonomous cycle, checks for conditions that warrant
 * unsolicited alerts to the user. Per spec Section 7.4:
 *
 *   - Velocity drops >15% vs plan
 *   - High-risk items unreviewed for >7 days
 *   - Budget CPI/SPI < 0.95
 *   - Tasks due within 48h still not done
 *   - Credit depletion warning
 *   - Phase gate readiness
 *
 * Cost: 1 credit per alert (low cost to encourage proactivity).
 * Available at: L3+ only.
 */

import { db } from "@/lib/db";

interface AlertResult {
  alertsGenerated: number;
  types: string[];
}

export async function runProactiveAlerts(
  agentId: string,
  projectId: string,
  orgId: string,
  autonomyLevel: number,
): Promise<AlertResult> {
  // Only L3+ agents send proactive alerts
  if (autonomyLevel < 3) return { alertsGenerated: 0, types: [] };

  const alerts: { type: string; summary: string; metadata?: any }[] = [];

  const [tasks, risks, org, agent] = await Promise.all([
    db.task.findMany({ where: { projectId } }),
    db.risk.findMany({ where: { projectId } }),
    db.organisation.findUnique({ where: { id: orgId }, select: { creditBalance: true } }),
    db.agent.findUnique({ where: { id: agentId }, select: { monthlyBudget: true, name: true } }),
  ]);

  // ── 1. Tasks due within 48h not done ──
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const overdueTasks = tasks.filter(t =>
    t.endDate && new Date(t.endDate) <= in48h &&
    t.status !== "DONE" && t.status !== "CANCELLED"
  );

  if (overdueTasks.length > 0) {
    alerts.push({
      type: "deadline_warning",
      summary: `${overdueTasks.length} task${overdueTasks.length > 1 ? "s" : ""} due within 48 hours: ${overdueTasks.slice(0, 3).map(t => `"${t.title}"`).join(", ")}${overdueTasks.length > 3 ? ` and ${overdueTasks.length - 3} more` : ""}. Would you like me to escalate or reassign?`,
      metadata: { taskIds: overdueTasks.map(t => t.id), count: overdueTasks.length },
    });
  }

  // ── 2. Blocked tasks ──
  const blockedTasks = tasks.filter(t => t.status === "BLOCKED");
  if (blockedTasks.length > 0) {
    alerts.push({
      type: "blocked_tasks",
      summary: `${blockedTasks.length} blocked task${blockedTasks.length > 1 ? "s" : ""}: ${blockedTasks.slice(0, 3).map(t => `"${t.title}"`).join(", ")}. Would you like me to investigate dependencies or escalate?`,
      metadata: { taskIds: blockedTasks.map(t => t.id), count: blockedTasks.length },
    });
  }

  // ── 3. Velocity drop (compare last 2 weeks) ──
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const recentDone = tasks.filter(t => t.status === "DONE" && t.updatedAt >= twoWeeksAgo).length;
  const previousDone = tasks.filter(t => t.status === "DONE" && t.updatedAt >= fourWeeksAgo && t.updatedAt < twoWeeksAgo).length;

  if (previousDone > 0 && recentDone < previousDone * 0.85) {
    const dropPct = Math.round((1 - recentDone / previousDone) * 100);
    alerts.push({
      type: "velocity_drop",
      summary: `Velocity has dropped ${dropPct}% in the last 2 weeks (${recentDone} tasks completed vs ${previousDone} in the prior period). The main bottleneck appears to be ${blockedTasks.length > 0 ? `${blockedTasks.length} blocked tasks` : "reduced throughput"}. Would you like me to re-prioritise the backlog?`,
      metadata: { recentDone, previousDone, dropPct },
    });
  }

  // ── 4. High risks unreviewed for >7 days ──
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const staleHighRisks = risks.filter(r =>
    (r.score || 0) >= 12 && r.status === "OPEN" && r.updatedAt < sevenDaysAgo
  );

  if (staleHighRisks.length > 0) {
    alerts.push({
      type: "risk_escalation",
      summary: `${staleHighRisks.length} high-risk item${staleHighRisks.length > 1 ? "s" : ""} haven't been reviewed in over 7 days: ${staleHighRisks.slice(0, 2).map(r => `"${r.title}" (score ${r.score})`).join(", ")}. I've prepared updated mitigation recommendations. [View Risks]`,
      metadata: { riskIds: staleHighRisks.map(r => r.id), count: staleHighRisks.length },
    });
  }

  // ── 5. Budget progress (simple SPI approximation) ──
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { budget: true, startDate: true, endDate: true },
  });

  if (project?.budget && project.startDate && project.endDate) {
    const totalDuration = new Date(project.endDate).getTime() - new Date(project.startDate).getTime();
    const elapsed = now.getTime() - new Date(project.startDate).getTime();
    const plannedProgress = Math.min(1, elapsed / totalDuration);
    const totalTasks = tasks.length || 1;
    const doneTasks = tasks.filter(t => t.status === "DONE").length;
    const actualProgress = doneTasks / totalTasks;

    const spi = plannedProgress > 0 ? actualProgress / plannedProgress : 1;

    if (spi < 0.85 && plannedProgress > 0.1) {
      alerts.push({
        type: "budget_warning",
        summary: `Schedule Performance Index is ${spi.toFixed(2)} (below 0.85 threshold). Project is ${Math.round((1 - spi) * 100)}% behind planned progress. ${doneTasks}/${totalTasks} tasks done vs ${Math.round(plannedProgress * 100)}% of timeline elapsed. I recommend reviewing the critical path and considering scope adjustments. [Review Schedule]`,
        metadata: { spi: Math.round(spi * 100) / 100, plannedProgress: Math.round(plannedProgress * 100), actualProgress: Math.round(actualProgress * 100) },
      });
    }
  }

  // ── 6. Phase gate readiness ──
  const phases = await db.phase.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });

  const activePhase = phases.find(p => p.status === "ACTIVE");
  const nextPhase = activePhase ? phases.find(p => p.order === activePhase.order + 1) : null;

  if (activePhase && nextPhase) {
    // Check if all tasks in current phase are done
    const phaseTasks = tasks.filter(t => t.phaseId === activePhase.id);
    const allDone = phaseTasks.length > 0 && phaseTasks.every(t => t.status === "DONE");

    if (allDone) {
      alerts.push({
        type: "phase_gate_ready",
        summary: `All ${phaseTasks.length} tasks in "${activePhase.name}" phase are complete. The project is ready for the "${nextPhase.name}" phase gate review. I've prepared the gate review package. [Schedule Gate Review] [View Package]`,
        metadata: { phaseId: activePhase.id, nextPhaseId: nextPhase.id, tasksCompleted: phaseTasks.length },
      });
    }
  }

  // ── 7. Credit depletion warning ──
  if (agent?.monthlyBudget) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const usage = await db.creditTransaction.aggregate({
      where: { agentId, type: "USAGE", createdAt: { gte: monthStart } },
      _sum: { amount: true },
    });
    const used = Math.abs(usage._sum.amount || 0);
    const remaining = agent.monthlyBudget - used;
    const pctRemaining = Math.round((remaining / agent.monthlyBudget) * 100);

    // Calculate burn rate (credits per day this month)
    const daysElapsed = Math.max(1, (now.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000));
    const burnRate = Math.round(used / daysElapsed);
    const daysLeft = burnRate > 0 ? Math.round(remaining / burnRate) : 999;

    if (pctRemaining <= 10) {
      alerts.push({
        type: "credit_warning",
        summary: `Credit balance is at ${remaining}/${agent.monthlyBudget} (${pctRemaining}%). At current burn rate of ${burnRate}/day, credits will be depleted in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}. [Top Up] [Reduce Agent Activity]`,
        metadata: { remaining, budget: agent.monthlyBudget, burnRate, daysLeft },
      });
    }
  }

  // ── Save alerts as activities + notifications ──
  const admins = await db.user.findMany({
    where: { orgId, role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });

  for (const alert of alerts) {
    // Check dedup — don't send same alert type twice in 24h
    const recentSame = await db.agentActivity.count({
      where: {
        agentId,
        type: "proactive_alert",
        metadata: { path: ["type"], equals: alert.type },
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });

    if (recentSame > 0) continue;

    await db.agentActivity.create({
      data: {
        agentId,
        type: "proactive_alert",
        summary: alert.summary,
        metadata: { type: alert.type, ...alert.metadata },
      },
    });

    for (const admin of admins) {
      await db.notification.create({
        data: {
          userId: admin.id,
          type: "AGENT_ALERT",
          title: `${agent?.name || "Agent"}: ${alert.type.replace(/_/g, " ")}`,
          body: alert.summary.slice(0, 300),
          actionUrl: "/agents/chat",
          metadata: { agentId, alertType: alert.type },
        },
      });
    }
  }

  return { alertsGenerated: alerts.length, types: alerts.map(a => a.type) };
}
