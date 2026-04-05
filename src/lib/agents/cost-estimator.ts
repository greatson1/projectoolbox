/**
 * Cost Estimation Engine
 *
 * Automatically estimates costs when tasks are created or progressed.
 * Handles both labour costs (hours × rate) and non-labour costs
 * (materials, services, POs).
 *
 * Runs as part of the action executor when tasks are created/updated.
 */

import { db } from "@/lib/db";

// Default hourly rates by role when team member rate not set
const DEFAULT_RATES: Record<string, number> = {
  OWNER: 150,
  ADMIN: 120,
  MANAGER: 100,
  MEMBER: 75,
  VIEWER: 0,
};

// Complexity multipliers for hour estimation based on story points
const SP_TO_HOURS: Record<number, number> = {
  1: 2, 2: 4, 3: 6, 5: 10, 8: 16, 13: 26, 21: 42,
};

/**
 * Estimate labour cost for a task based on story points and team member rate.
 * Called when a task is created by the agent.
 */
export async function estimateTaskCost(taskId: string, projectId: string, agentId?: string): Promise<void> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, storyPoints: true, estimatedHours: true, assigneeId: true, projectId: true },
  });

  if (!task) return;

  // Estimate hours from story points if not already set
  let hours = task.estimatedHours || 0;
  if (hours === 0 && task.storyPoints) {
    hours = SP_TO_HOURS[task.storyPoints] || task.storyPoints * 2;
    await db.task.update({ where: { id: taskId }, data: { estimatedHours: hours } });
  }

  if (hours === 0) return; // Can't estimate without hours or SP

  // Get assignee's hourly rate
  let rate = DEFAULT_RATES.MEMBER; // Default
  if (task.assigneeId) {
    const member = await db.projectMember.findFirst({
      where: { projectId, userId: task.assigneeId },
      select: { hourlyRate: true, role: true },
    });
    if (member?.hourlyRate) rate = member.hourlyRate;
    else if (member?.role) rate = DEFAULT_RATES[member.role] || 75;
  }

  const estimatedCost = hours * rate;

  // Check if estimate already exists for this task
  const existing = await db.costEntry.findFirst({
    where: { projectId, taskId, entryType: "ESTIMATE", category: "LABOUR" },
  });

  if (existing) {
    await db.costEntry.update({
      where: { id: existing.id },
      data: { amount: estimatedCost, unitQty: hours, unitRate: rate, description: `Labour estimate: ${task.title}` },
    });
  } else {
    await db.costEntry.create({
      data: {
        projectId,
        taskId,
        entryType: "ESTIMATE",
        category: "LABOUR",
        amount: estimatedCost,
        unitQty: hours,
        unitRate: rate,
        description: `Labour estimate: ${task.title}`,
        createdBy: agentId ? `agent:${agentId}` : "system",
      },
    });
  }
}

/**
 * Log actual labour cost when a task completes.
 * Uses actual hours if available, falls back to estimated.
 */
export async function logTaskCompletion(taskId: string, projectId: string, agentId?: string): Promise<void> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, actualHours: true, estimatedHours: true, assigneeId: true },
  });

  if (!task) return;

  const hours = task.actualHours || task.estimatedHours || 0;
  if (hours === 0) return;

  // Get rate
  let rate = DEFAULT_RATES.MEMBER;
  if (task.assigneeId) {
    const member = await db.projectMember.findFirst({
      where: { projectId, userId: task.assigneeId },
      select: { hourlyRate: true, role: true },
    });
    if (member?.hourlyRate) rate = member.hourlyRate;
    else if (member?.role) rate = DEFAULT_RATES[member.role] || 75;
  }

  const actualCost = hours * rate;

  // Don't duplicate
  const existing = await db.costEntry.findFirst({
    where: { projectId, taskId, entryType: "ACTUAL", category: "LABOUR" },
  });

  if (!existing) {
    await db.costEntry.create({
      data: {
        projectId,
        taskId,
        entryType: "ACTUAL",
        category: "LABOUR",
        amount: actualCost,
        unitQty: hours,
        unitRate: rate,
        description: `Labour actual: ${task.title}`,
        createdBy: agentId ? `agent:${agentId}` : "system",
      },
    });
  }
}

/**
 * Estimate non-labour costs from project context.
 * Called during the Planning Sprint to seed budget breakdown.
 */
export async function estimateNonLabourCosts(
  projectId: string,
  agentId: string,
  items: { category: string; description: string; amount: number; vendorName?: string; unitQty?: number; unitRate?: number }[],
): Promise<number> {
  let total = 0;

  for (const item of items) {
    await db.costEntry.create({
      data: {
        projectId,
        entryType: "ESTIMATE",
        category: item.category,
        amount: item.amount,
        description: item.description,
        vendorName: item.vendorName || null,
        unitQty: item.unitQty || null,
        unitRate: item.unitRate || null,
        createdBy: `agent:${agentId}`,
      },
    });
    total += item.amount;
  }

  return total;
}

/**
 * Log a purchase order commitment.
 */
export async function logPurchaseOrder(
  projectId: string,
  data: { description: string; amount: number; vendorName: string; poNumber: string; category?: string },
  createdBy: string,
): Promise<void> {
  await db.costEntry.create({
    data: {
      projectId,
      entryType: "COMMITMENT",
      category: data.category || "MATERIALS",
      amount: data.amount,
      description: data.description,
      vendorName: data.vendorName,
      poNumber: data.poNumber,
      createdBy,
    },
  });
}

/**
 * Log an invoice/actual against a PO.
 */
export async function logInvoice(
  projectId: string,
  data: { description: string; amount: number; vendorName: string; poNumber?: string; invoiceRef: string; category?: string },
  createdBy: string,
): Promise<void> {
  await db.costEntry.create({
    data: {
      projectId,
      entryType: "ACTUAL",
      category: data.category || "MATERIALS",
      amount: data.amount,
      description: data.description,
      vendorName: data.vendorName,
      poNumber: data.poNumber || null,
      invoiceRef: data.invoiceRef,
      createdBy,
    },
  });
}

/**
 * Get full cost breakdown for a project.
 */
export async function getProjectCostBreakdown(projectId: string) {
  const entries = await db.costEntry.findMany({
    where: { projectId },
    orderBy: { recordedAt: "desc" },
  });

  const byCategory: Record<string, { estimated: number; actual: number; committed: number; forecast: number }> = {};

  for (const e of entries) {
    const cat = e.category || "OTHER";
    if (!byCategory[cat]) byCategory[cat] = { estimated: 0, actual: 0, committed: 0, forecast: 0 };

    if (e.entryType === "ESTIMATE") byCategory[cat].estimated += e.amount;
    else if (e.entryType === "ACTUAL") byCategory[cat].actual += e.amount;
    else if (e.entryType === "COMMITMENT") byCategory[cat].committed += e.amount;
    else if (e.entryType === "FORECAST") byCategory[cat].forecast += e.amount;
  }

  const totalEstimated = Object.values(byCategory).reduce((s, c) => s + c.estimated, 0);
  const totalActual = Object.values(byCategory).reduce((s, c) => s + c.actual, 0);
  const totalCommitted = Object.values(byCategory).reduce((s, c) => s + c.committed, 0);

  return { byCategory, totalEstimated, totalActual, totalCommitted, entries };
}
