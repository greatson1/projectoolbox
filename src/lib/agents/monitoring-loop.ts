/**
 * Continuous Monitoring Loop
 *
 * Per spec Section 3.1: Every active agent runs a background monitoring engine
 * that operates on three cadences simultaneously:
 *   - Real-time (event-driven): triggered by DB changes
 *   - Daily (scheduled): schedule health, budget variance, risk re-scoring
 *   - Weekly (cadence-driven): sprint planning, health scorecard, EVM, reports
 *
 * This module is called from the cron tick. It determines which cadence
 * checks are due and produces ActionProposals for the executor.
 */

import { db } from "@/lib/db";
import type { ActionProposal } from "./decision-classifier";
import { generatePlaybookProposals, checkGateCriteria, getNextPhase } from "./methodology-playbooks";

interface MonitoringResult {
  proposals: ActionProposal[];
  cadencesRun: string[];
}

/**
 * Run the full monitoring loop for a deployment.
 * Determines which cadences are due and generates proposals.
 */
export async function runMonitoringLoop(
  agentId: string,
  deploymentId: string,
  projectId: string,
): Promise<MonitoringResult> {
  const deployment = await db.agentDeployment.findUnique({
    where: { id: deploymentId },
    include: {
      project: { select: { methodology: true, name: true, status: true, budget: true, startDate: true, endDate: true } },
      agent: { select: { autonomyLevel: true } },
    },
  });

  if (!deployment || !deployment.project) return { proposals: [], cadencesRun: [] };

  const { project, agent } = deployment;
  const methodology = project.methodology;
  const currentPhase = deployment.currentPhase;
  const proposals: ActionProposal[] = [];
  const cadencesRun: string[] = [];

  // ── Determine which cadences are due ──
  const now = new Date();
  const lastCycle = deployment.lastCycleAt ? new Date(deployment.lastCycleAt) : null;
  const hoursSinceLastCycle = lastCycle ? (now.getTime() - lastCycle.getTime()) / (1000 * 60 * 60) : 999;

  // Daily checks: if >12 hours since last run (or first run)
  const runDaily = hoursSinceLastCycle >= 12;

  // Weekly checks: if it's Monday and >5 days since last weekly run
  const isMonday = now.getDay() === 1;
  const runWeekly = isMonday && hoursSinceLastCycle >= 120; // 5 days

  // Phase entry: if deployment just started or phase just changed
  const isPhaseEntry = !lastCycle || deployment.phaseStatus === "active";

  // ── 1. Methodology playbook actions ──
  if (isPhaseEntry && currentPhase) {
    const entryProposals = generatePlaybookProposals(methodology, currentPhase, "on_entry", projectId);
    // Only generate entry proposals once per phase — check if we already have
    const recentEntryActions = await db.agentActivity.count({
      where: {
        agentId,
        type: "document",
        summary: { contains: "playbook" },
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });
    if (recentEntryActions === 0) {
      proposals.push(...entryProposals);
      cadencesRun.push("phase_entry");
    }
  }

  // ── 2. Daily monitoring ──
  if (runDaily) {
    cadencesRun.push("daily");

    // Playbook daily actions
    const dailyPlaybook = generatePlaybookProposals(methodology, currentPhase, "daily", projectId);
    proposals.push(...dailyPlaybook);

    // Dependency chain propagation
    const depProps = await checkDependencyChains(projectId, agentId);
    proposals.push(...depProps);

    // Overdue task response
    const overdueProps = await checkOverdueTasks(projectId, agentId);
    proposals.push(...overdueProps);

    // Budget threshold breach
    const budgetProps = await checkBudgetThresholds(projectId);
    proposals.push(...budgetProps);
  }

  // ── 3. Weekly monitoring ──
  if (runWeekly) {
    cadencesRun.push("weekly");

    // Playbook weekly actions
    const weeklyPlaybook = generatePlaybookProposals(methodology, currentPhase, "weekly", projectId);
    proposals.push(...weeklyPlaybook);

    // Stakeholder communication cadence
    const stakeholderProps = await checkStakeholderCadence(projectId, agentId);
    proposals.push(...stakeholderProps);
  }

  // ── 4. Phase gate readiness check (always) ──
  if (currentPhase) {
    const gateCheck = await checkGateCriteria(projectId, methodology, currentPhase);
    if (gateCheck.ready) {
      const nextPhase = getNextPhase(methodology, currentPhase);
      if (nextPhase) {
        proposals.push({
          type: "PHASE_GATE",
          description: `Phase gate ready: "${currentPhase}" → "${nextPhase}". All ${gateCheck.criteria.length} prerequisites met.`,
          reasoning: `Gate criteria assessment:\n${gateCheck.criteria.map(c => `${c.met ? "✅" : "❌"} ${c.text}`).join("\n")}\n\nAll prerequisites for advancing to the "${nextPhase}" phase are satisfied.`,
          confidence: 0.95,
          scheduleImpact: 2,
          costImpact: 1,
          scopeImpact: 1,
          stakeholderImpact: 3,
        });
        cadencesRun.push("gate_ready");
      }
    }
  }

  return { proposals, cadencesRun };
}

// ─── Intervention Checks ───

/**
 * Dependency chain propagation (spec 3.4):
 * When a predecessor task completes, unblock successor tasks.
 */
async function checkDependencyChains(projectId: string, agentId: string): Promise<ActionProposal[]> {
  const proposals: ActionProposal[] = [];

  // Find tasks completed in last 24h that might have dependents
  const recentlyDone = await db.task.findMany({
    where: {
      projectId,
      status: "DONE",
      updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true, title: true, dependencies: true },
  });

  if (recentlyDone.length === 0) return proposals;

  const doneIds = new Set(recentlyDone.map(t => t.id));

  // Find blocked/TODO tasks that depend on recently completed tasks
  const potentialUnblocks = await db.task.findMany({
    where: {
      projectId,
      status: { in: ["BLOCKED", "TODO"] },
      dependencies: { not: null },
    },
    select: { id: true, title: true, dependencies: true, status: true },
  });

  for (const task of potentialUnblocks) {
    const deps = (task.dependencies as string[]) || [];
    const allDepsMet = deps.length > 0 && deps.every(depId => doneIds.has(depId));

    if (allDepsMet) {
      proposals.push({
        type: "TASK_ASSIGNMENT",
        description: `Unblock "${task.title}" — all predecessor tasks are now complete`,
        reasoning: `Task "${task.title}" was ${task.status} because it depended on ${deps.length} predecessor task(s). All predecessors are now DONE. Moving task to IN_PROGRESS.`,
        confidence: 0.95,
        scheduleImpact: 1,
        costImpact: 1,
        scopeImpact: 1,
        stakeholderImpact: 1,
        affectedItems: [{ type: "task", id: task.id, title: task.title }],
      });
    }
  }

  return proposals;
}

/**
 * Overdue task response (spec 3.4):
 * When a task is overdue by >24h, reassign or escalate.
 */
async function checkOverdueTasks(projectId: string, agentId: string): Promise<ActionProposal[]> {
  const proposals: ActionProposal[] = [];
  const now = new Date();

  const overdueTasks = await db.task.findMany({
    where: {
      projectId,
      status: { in: ["TODO", "IN_PROGRESS"] },
      endDate: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true, title: true, assigneeId: true, priority: true, endDate: true },
  });

  for (const task of overdueTasks) {
    const daysOverdue = Math.round((now.getTime() - new Date(task.endDate!).getTime()) / (1000 * 60 * 60 * 24));

    proposals.push({
      type: "ESCALATION",
      description: `Task "${task.title}" is ${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue${task.assigneeId ? "" : " (unassigned)"}`,
      reasoning: `Task "${task.title}" was due ${daysOverdue} day(s) ago and is still ${task.assigneeId ? "in progress" : "unassigned"}. ${daysOverdue > 3 ? "This is significantly overdue and may impact dependent tasks." : "Recommend checking with the assignee or reassigning."}`,
      confidence: 0.9,
      scheduleImpact: daysOverdue > 3 ? 3 : 2,
      costImpact: 1,
      scopeImpact: 1,
      stakeholderImpact: daysOverdue > 5 ? 2 : 1,
      affectedItems: [{ type: "task", id: task.id, title: task.title }],
    });
  }

  return proposals;
}

/**
 * Budget threshold breach (spec 3.4):
 * When a budget line exceeds 80% consumption.
 */
async function checkBudgetThresholds(projectId: string): Promise<ActionProposal[]> {
  const proposals: ActionProposal[] = [];

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { budget: true, name: true },
  });

  if (!project?.budget) return proposals;

  // Simple check: count credits used on this project
  // In a real implementation, this would check actual budget line items
  const tasks = await db.task.findMany({ where: { projectId } });
  const totalTasks = tasks.length || 1;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const progressPct = (doneTasks / totalTasks) * 100;

  // If more than 80% of tasks done but progress seems slow, warn about budget
  // This is a simplified heuristic — real implementation would track actual spend
  if (progressPct < 50 && totalTasks > 5) {
    // We're less than halfway done — check if timeline suggests we might overrun
    proposals.push({
      type: "RISK_RESPONSE",
      description: `Budget monitoring: project is ${Math.round(progressPct)}% complete with potential for schedule overrun`,
      reasoning: `Only ${doneTasks}/${totalTasks} tasks are complete (${Math.round(progressPct)}%). If the current completion rate continues, the project may face schedule pressure which typically increases costs. Recommend reviewing the critical path and identifying acceleration opportunities.`,
      confidence: 0.7,
      scheduleImpact: 2,
      costImpact: 2,
      scopeImpact: 1,
      stakeholderImpact: 1,
    });
  }

  return proposals;
}

/**
 * Stakeholder communication cadence (spec 3.4):
 * When a stakeholder hasn't received an update in >7 days.
 */
async function checkStakeholderCadence(projectId: string, agentId: string): Promise<ActionProposal[]> {
  const proposals: ActionProposal[] = [];

  const stakeholders = await db.stakeholder.findMany({
    where: { projectId, email: { not: null } },
    select: { id: true, name: true, email: true, power: true, interest: true },
  });

  if (stakeholders.length === 0) return proposals;

  // Check last communication to stakeholders (via agent activity)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentComms = await db.agentActivity.count({
    where: {
      agentId,
      type: { in: ["chat", "document"] },
      summary: { contains: "stakeholder" },
      createdAt: { gte: sevenDaysAgo },
    },
  });

  // High-power, high-interest stakeholders need more frequent updates
  const keyStakeholders = stakeholders.filter(s => (s.power || 50) >= 60 && (s.interest || 50) >= 60);

  if (recentComms === 0 && keyStakeholders.length > 0) {
    proposals.push({
      type: "COMMUNICATION",
      description: `Send weekly status update to ${keyStakeholders.length} key stakeholder${keyStakeholders.length > 1 ? "s" : ""}: ${keyStakeholders.slice(0, 3).map(s => s.name).join(", ")}`,
      reasoning: `${keyStakeholders.length} high-power, high-interest stakeholder(s) have not received a project update in over 7 days. Per stakeholder engagement best practice, key stakeholders should receive at minimum weekly updates.`,
      confidence: 0.85,
      scheduleImpact: 1,
      costImpact: 1,
      scopeImpact: 1,
      stakeholderImpact: 2,
    });
  }

  return proposals;
}
