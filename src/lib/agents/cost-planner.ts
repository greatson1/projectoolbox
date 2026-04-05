/**
 * Cost Planning Engine
 *
 * Runs during the Planning Sprint (after task generation) to produce
 * a full project cost breakdown. Also re-forecasts during execution.
 *
 * Flow:
 *   1. Analyse all tasks → estimate labour costs
 *   2. Call LLM to infer non-labour costs from project description
 *   3. Seed cost entries with full budget breakdown
 *   4. Compare estimate to stated budget → flag discrepancies as risks
 *   5. Re-forecast each cycle as actuals accumulate
 */

import { db } from "@/lib/db";

const DEFAULT_RATES: Record<string, number> = {
  OWNER: 150, ADMIN: 120, MANAGER: 100, MEMBER: 75, SENIOR: 120, JUNIOR: 50, CONTRACTOR: 100,
};

const SP_TO_HOURS: Record<number, number> = {
  1: 2, 2: 4, 3: 6, 5: 10, 8: 16, 13: 26, 21: 42,
};

interface CostBreakdown {
  labour: number;
  materials: number;
  services: number;
  travel: number;
  contingency: number;
  total: number;
  items: CostItem[];
  budgetGap: number; // positive = under budget, negative = over
  budgetHealthy: boolean;
}

interface CostItem {
  category: string;
  description: string;
  amount: number;
  unitQty?: number;
  unitRate?: number;
  vendorName?: string;
}

/**
 * Full project cost planning — runs after WBS/task generation.
 * Produces a complete cost breakdown and seeds the cost entries table.
 */
export async function planProjectCosts(
  projectId: string,
  agentId: string,
): Promise<CostBreakdown> {
  const [project, tasks, members, existingCosts] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { budget: true, description: true, name: true, startDate: true, endDate: true, category: true, methodology: true } }),
    db.task.findMany({ where: { projectId }, select: { id: true, title: true, storyPoints: true, estimatedHours: true, assigneeId: true, status: true } }),
    db.projectMember.findMany({ where: { projectId }, include: { user: { select: { name: true } } } }),
    db.costEntry.count({ where: { projectId, entryType: "ESTIMATE" } }),
  ]);

  if (!project) throw new Error("Project not found");

  // Skip if costs already planned
  if (existingCosts > 0) {
    return await getExistingBreakdown(projectId, project.budget || 0);
  }

  const items: CostItem[] = [];

  // ── 1. LABOUR COSTS ──
  // Get average hourly rate from team members
  const teamRates = members.map(m => m.hourlyRate || DEFAULT_RATES[m.role] || 75);
  const avgRate = teamRates.length > 0 ? teamRates.reduce((s, r) => s + r, 0) / teamRates.length : 75;

  let totalLabourHours = 0;

  for (const task of tasks) {
    let hours = task.estimatedHours || 0;
    if (hours === 0 && task.storyPoints) {
      hours = SP_TO_HOURS[task.storyPoints] || task.storyPoints * 2;
    }
    if (hours === 0) hours = 4; // Default 4h for unestimated tasks

    // Update task with estimated hours if not set
    if (!task.estimatedHours) {
      await db.task.update({ where: { id: task.id }, data: { estimatedHours: hours } });
    }

    totalLabourHours += hours;

    // Get specific rate for assignee
    let rate = avgRate;
    if (task.assigneeId) {
      const member = members.find(m => m.userId === task.assigneeId);
      if (member?.hourlyRate) rate = member.hourlyRate;
      else if (member?.role) rate = DEFAULT_RATES[member.role] || avgRate;
    }

    items.push({
      category: "LABOUR",
      description: `Labour: ${task.title}`,
      amount: hours * rate,
      unitQty: hours,
      unitRate: rate,
    });
  }

  const labourTotal = items.reduce((s, i) => s + i.amount, 0);

  // ── 2. NON-LABOUR COSTS (LLM-inferred) ──
  const nonLabourItems = await inferNonLabourCosts(project, labourTotal);
  items.push(...nonLabourItems);

  // ── 3. CONTINGENCY ──
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const contingencyRate = 0.10; // 10% default
  const contingency = Math.round(subtotal * contingencyRate);
  items.push({
    category: "CONTINGENCY",
    description: "Management contingency reserve (10%)",
    amount: contingency,
  });

  // ── 4. TOTALS ──
  const total = subtotal + contingency;
  const materialsTotal = nonLabourItems.filter(i => i.category === "MATERIALS").reduce((s, i) => s + i.amount, 0);
  const servicesTotal = nonLabourItems.filter(i => i.category === "SERVICES").reduce((s, i) => s + i.amount, 0);
  const travelTotal = nonLabourItems.filter(i => i.category === "TRAVEL").reduce((s, i) => s + i.amount, 0);

  const budget = project.budget || 0;
  const budgetGap = budget - total;
  const budgetHealthy = budget === 0 || budgetGap >= 0;

  // ── 5. WRITE TO DATABASE ──
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
  }

  // ── 6. FLAG BUDGET RISK ──
  if (budget > 0 && !budgetHealthy) {
    await db.risk.create({
      data: {
        projectId,
        title: `Budget shortfall: estimated cost £${total.toLocaleString()} exceeds budget £${budget.toLocaleString()}`,
        description: `Cost planning estimates total project cost at £${total.toLocaleString()}, which is £${Math.abs(budgetGap).toLocaleString()} (${Math.round((Math.abs(budgetGap) / budget) * 100)}%) over the stated budget of £${budget.toLocaleString()}. Breakdown: Labour £${labourTotal.toLocaleString()}, Materials £${materialsTotal.toLocaleString()}, Services £${servicesTotal.toLocaleString()}, Contingency £${contingency.toLocaleString()}.`,
        probability: 4,
        impact: 4,
        score: 16,
        status: "OPEN",
        category: "Budget",
        mitigation: "Review scope for reduction opportunities, negotiate vendor rates, or request budget increase.",
      },
    });
  }

  // ── 7. LOG ACTIVITY ──
  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Cost planning complete: ${tasks.length} tasks estimated at £${total.toLocaleString()} (Labour: £${labourTotal.toLocaleString()}, Other: £${(total - labourTotal - contingency).toLocaleString()}, Contingency: £${contingency.toLocaleString()})${!budgetHealthy ? ` — WARNING: £${Math.abs(budgetGap).toLocaleString()} over budget` : ""}`,
      metadata: { type: "cost_planning", total, labour: labourTotal, materials: materialsTotal, services: servicesTotal, contingency, budgetGap },
    },
  });

  return { labour: labourTotal, materials: materialsTotal, services: servicesTotal, travel: travelTotal, contingency, total, items, budgetGap, budgetHealthy };
}

/**
 * Infer non-labour costs from project description using LLM.
 */
async function inferNonLabourCosts(
  project: { name: string; description: string | null; category: string | null; methodology: string },
  labourCost: number,
): Promise<CostItem[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return estimateNonLabourFallback(project, labourCost);
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `You are a project cost estimator. Given this project, identify non-labour costs that would typically be needed. Output ONLY a JSON array.

Project: ${project.name}
Description: ${project.description || "Not specified"}
Category: ${project.category || "General"}
Methodology: ${project.methodology}
Estimated labour cost: £${labourCost.toLocaleString()}

For each non-labour cost item, provide:
{"category": "MATERIALS|SERVICES|TRAVEL", "description": "what it is", "amount": number, "vendorName": "if applicable"}

Rules:
- Only include costs relevant to this specific project type
- Be realistic — don't pad unnecessarily
- Materials: software licenses, hardware, equipment
- Services: external consultants, testing services, hosting, cloud infrastructure
- Travel: site visits, client meetings (only if project type warrants it)
- Keep total non-labour costs proportional (typically 15-40% of labour for IT projects, higher for construction)
- Output ONLY the JSON array, no markdown or explanation`,
        }],
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.content[0]?.text || "[]";
      const clean = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(clean);
      return Array.isArray(parsed) ? parsed.map((i: any) => ({
        category: i.category || "OTHER",
        description: i.description || "",
        amount: typeof i.amount === "number" ? i.amount : 0,
        vendorName: i.vendorName || undefined,
      })) : [];
    }
  } catch (e) {
    console.error("Non-labour cost inference failed:", e);
  }

  return estimateNonLabourFallback(project, labourCost);
}

/**
 * Fallback: estimate non-labour costs as a percentage of labour.
 */
function estimateNonLabourFallback(
  project: { category: string | null },
  labourCost: number,
): CostItem[] {
  const category = (project.category || "").toLowerCase();

  // Category-based multipliers
  let toolsPct = 0.05; // 5% for tools/licenses
  let infraPct = 0.08; // 8% for infrastructure
  let travelPct = 0;

  if (category.includes("software") || category.includes("tech")) {
    toolsPct = 0.10;
    infraPct = 0.12;
  } else if (category.includes("construction") || category.includes("engineering")) {
    toolsPct = 0.02;
    infraPct = 0.25; // Materials are expensive
    travelPct = 0.05;
  } else if (category.includes("consulting")) {
    travelPct = 0.08;
  }

  const items: CostItem[] = [];

  if (toolsPct > 0) {
    items.push({ category: "MATERIALS", description: "Software licenses and tools", amount: Math.round(labourCost * toolsPct) });
  }
  if (infraPct > 0) {
    items.push({ category: "SERVICES", description: "Infrastructure, hosting, and external services", amount: Math.round(labourCost * infraPct) });
  }
  if (travelPct > 0) {
    items.push({ category: "TRAVEL", description: "Site visits and client meetings", amount: Math.round(labourCost * travelPct) });
  }

  return items;
}

/**
 * Get existing cost breakdown (when costs already planned).
 */
async function getExistingBreakdown(projectId: string, budget: number): Promise<CostBreakdown> {
  const entries = await db.costEntry.findMany({
    where: { projectId, entryType: "ESTIMATE" },
  });

  const labour = entries.filter(e => e.category === "LABOUR").reduce((s, e) => s + e.amount, 0);
  const materials = entries.filter(e => e.category === "MATERIALS").reduce((s, e) => s + e.amount, 0);
  const services = entries.filter(e => e.category === "SERVICES").reduce((s, e) => s + e.amount, 0);
  const travel = entries.filter(e => e.category === "TRAVEL").reduce((s, e) => s + e.amount, 0);
  const contingency = entries.filter(e => e.category === "CONTINGENCY").reduce((s, e) => s + e.amount, 0);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const budgetGap = budget - total;

  return {
    labour, materials, services, travel, contingency, total,
    items: entries.map(e => ({ category: e.category || "OTHER", description: e.description || "", amount: e.amount })),
    budgetGap,
    budgetHealthy: budget === 0 || budgetGap >= 0,
  };
}

/**
 * Re-forecast costs during execution.
 * Called from monitoring loop weekly.
 */
export async function reforecastCosts(projectId: string, agentId: string): Promise<void> {
  const [estimates, actuals, tasks] = await Promise.all([
    db.costEntry.findMany({ where: { projectId, entryType: "ESTIMATE" } }),
    db.costEntry.findMany({ where: { projectId, entryType: "ACTUAL" } }),
    db.task.findMany({ where: { projectId }, select: { status: true, estimatedHours: true, actualHours: true } }),
  ]);

  const totalEstimated = estimates.reduce((s, e) => s + e.amount, 0);
  const totalActual = actuals.reduce((s, e) => s + e.amount, 0);

  if (totalEstimated === 0) return; // No estimates to forecast against

  // Calculate completion percentage
  const totalTasks = tasks.length || 1;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const completionPct = doneTasks / totalTasks;

  if (completionPct < 0.1) return; // Too early to forecast

  // CPI = earned / actual
  const earned = totalEstimated * completionPct;
  const cpi = totalActual > 0 ? earned / totalActual : 1;

  // EAC = total estimated / CPI
  const eac = cpi > 0 ? Math.round(totalEstimated / cpi) : totalEstimated;
  const variance = totalEstimated - eac;

  // Create forecast entry
  await db.costEntry.create({
    data: {
      projectId,
      entryType: "FORECAST",
      category: "OTHER",
      amount: eac,
      description: `Re-forecast at ${Math.round(completionPct * 100)}% complete. CPI: ${cpi.toFixed(2)}. EAC: £${eac.toLocaleString()}. Variance: £${variance.toLocaleString()}.`,
      createdBy: `agent:${agentId}`,
    },
  });

  // Alert if forecast exceeds budget by >10%
  const project = await db.project.findUnique({ where: { id: projectId }, select: { budget: true } });
  if (project?.budget && eac > project.budget * 1.1) {
    await db.agentActivity.create({
      data: {
        agentId,
        type: "proactive_alert",
        summary: `Budget alert: forecast (£${eac.toLocaleString()}) exceeds budget (£${project.budget.toLocaleString()}) by ${Math.round(((eac - project.budget) / project.budget) * 100)}%. CPI is ${cpi.toFixed(2)}.`,
        metadata: { type: "budget_forecast", eac, budget: project.budget, cpi, variance },
      },
    });
  }
}
