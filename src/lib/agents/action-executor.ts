/**
 * Agent Action Executor
 *
 * The bridge between "agent wants to do X" and "X happens in the database".
 * Every proposed action flows through: classify → check credits → execute or route to HITL.
 *
 * This file NEVER replaces existing logic — it only adds the autonomous execution path.
 */

import { db } from "@/lib/db";
import { CreditService } from "@/lib/credits/service";
import {
  classifyDecision,
  getActionCreditCost,
  isInCooldown,
  type ActionProposal,
  type ClassificationResult,
  type DeploymentConfig,
} from "./decision-classifier";

interface ExecutionContext {
  agentId: string;
  deploymentId: string;
  projectId: string;
  orgId: string;
  autonomyLevel: number;
}

interface ExecutionResult {
  success: boolean;
  action: "auto_executed" | "sent_to_approval" | "blocked";
  result?: any;
  approvalId?: string;
  error?: string;
  creditsUsed?: number;
  classification: ClassificationResult;
}

/**
 * Process an action proposal: classify, check credits, execute or route to HITL.
 */
export async function processActionProposal(
  proposal: ActionProposal,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  // 1. Get deployment config for HITL overrides
  const deployment = await db.agentDeployment.findUnique({
    where: { id: context.deploymentId },
    select: { hitlPhaseGates: true, hitlBudgetChanges: true, hitlCommunications: true, autonomyConfig: true },
  });

  if (!deployment) {
    return { success: false, action: "blocked", error: "Deployment not found", classification: {} as any };
  }

  const deploymentConfig: DeploymentConfig = {
    hitlPhaseGates: deployment.hitlPhaseGates,
    hitlBudgetChanges: deployment.hitlBudgetChanges,
    hitlCommunications: deployment.hitlCommunications,
    autonomyConfig: deployment.autonomyConfig as any,
  };

  // 2. Get org-level global HITL policy
  const org = await db.organisation.findUnique({
    where: { id: context.orgId },
    select: { globalHitlPolicy: true },
  });

  // 3. Classify the decision
  const classification = classifyDecision(
    proposal,
    context.autonomyLevel,
    deploymentConfig,
    org?.globalHitlPolicy as any,
  );

  // 4. Check credits
  const creditCost = proposal.creditCost || getActionCreditCost(proposal.type);
  const hasCredits = await CreditService.checkBalance(context.orgId, creditCost);
  if (!hasCredits) {
    await logActivity(context.agentId, "budget_limit", `Insufficient credits for: ${proposal.description}`, {
      type: proposal.type, creditCost, riskTier: classification.riskTier,
    });
    return { success: false, action: "blocked", error: "Insufficient credits", classification };
  }

  // 5. Check agent monthly budget
  const agent = await db.agent.findUnique({
    where: { id: context.agentId },
    select: { monthlyBudget: true },
  });
  if (agent?.monthlyBudget) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthlyUsage = await db.creditTransaction.aggregate({
      where: { agentId: context.agentId, type: "USAGE", createdAt: { gte: monthStart } },
      _sum: { amount: true },
    });
    const used = Math.abs(monthlyUsage._sum.amount || 0);
    if (used + creditCost > agent.monthlyBudget) {
      await logActivity(context.agentId, "budget_limit",
        `Monthly budget limit reached (${used}/${agent.monthlyBudget} credits). Action blocked: ${proposal.description}`,
        { type: proposal.type, used, budget: agent.monthlyBudget },
      );
      return { success: false, action: "blocked", error: "Agent monthly budget exceeded", classification };
    }
  }

  // 6. Check learning loop — should this action type be forced to HITL?
  try {
    const { shouldForceHitl } = await import("./learning-loop");
    if (await shouldForceHitl(context.agentId, proposal.type)) {
      classification.canAutoExecute = false;
      classification.requiresApproval = true;
    }
  } catch {}

  // 7. Check for multi-agent conflicts
  try {
    const { checkConflicts } = await import("./conflict-resolver");
    const conflict = await checkConflicts(proposal, context.agentId, context.projectId);
    if (conflict.hasConflict) {
      // Force to HITL with conflict info
      proposal.suggestedAlternatives = [
        ...(proposal.suggestedAlternatives || []),
        { description: `Conflict: ${conflict.resolution}` },
      ];
      return routeToApproval(proposal, { ...classification, canAutoExecute: false, requiresApproval: true }, context, creditCost);
    }
  } catch {}

  // 7. Execute or route to HITL
  if (classification.canAutoExecute) {
    return autoExecute(proposal, classification, context, creditCost);
  } else {
    return routeToApproval(proposal, classification, context, creditCost);
  }
}

/**
 * Auto-execute: perform the DB mutation, log decision, deduct credits.
 */
async function autoExecute(
  proposal: ActionProposal,
  classification: ClassificationResult,
  context: ExecutionContext,
  creditCost: number,
): Promise<ExecutionResult> {
  try {
    // Perform the actual database mutation
    const mutationResult = await performMutation(proposal, context);

    // Create AgentDecision record
    await db.agentDecision.create({
      data: {
        agentId: context.agentId,
        type: proposal.type as any,
        description: proposal.description,
        reasoning: proposal.reasoning,
        confidence: proposal.confidence,
        status: "AUTO_APPROVED",
      },
    });

    // Deduct credits
    await CreditService.deduct(
      context.orgId, creditCost,
      `Auto-executed: ${proposal.description}`,
      context.agentId,
    );

    // Log activity
    await logActivity(context.agentId, inferActivityType(proposal.type),
      `Auto-executed (${classification.riskTier}): ${proposal.description}`,
      {
        type: proposal.type, riskScore: classification.riskScore,
        riskTier: classification.riskTier, creditCost,
        ...mutationResult,
      },
    );

    return { success: true, action: "auto_executed", result: mutationResult, creditsUsed: creditCost, classification };
  } catch (e: any) {
    await logActivity(context.agentId, "error",
      `Action failed: ${proposal.description} — ${e.message}`,
      { type: proposal.type, error: e.message },
    );
    return { success: false, action: "blocked", error: e.message, classification };
  }
}

/**
 * Route to HITL: create enriched Approval record, create pending AgentDecision.
 */
async function routeToApproval(
  proposal: ActionProposal,
  classification: ClassificationResult,
  context: ExecutionContext,
  creditCost: number,
): Promise<ExecutionResult> {
  // Determine escalation deadline based on deployment timeout
  const deployment = await db.agentDeployment.findUnique({
    where: { id: context.deploymentId },
    select: { escalationTimeout: true },
  });
  const timeoutHours = deployment?.escalationTimeout || 24;
  const expiresAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);

  // Create the approval with enriched data
  const approval = await db.approval.create({
    data: {
      projectId: context.projectId,
      requestedById: context.agentId,
      type: classification.approvalType as any,
      title: proposal.description,
      description: proposal.reasoning,
      impact: { creditCost, riskScore: classification.riskScore },
      status: "PENDING",
      urgency: classification.urgency,
      expiresAt,
      impactScores: classification.impactScores,
      reasoningChain: proposal.reasoning,
      suggestedAlternatives: (proposal.suggestedAlternatives || undefined) as any,
      affectedItems: (proposal.affectedItems || undefined) as any,
    },
  });

  // Create pending AgentDecision linked to approval
  await db.agentDecision.create({
    data: {
      agentId: context.agentId,
      type: proposal.type as any,
      description: proposal.description,
      reasoning: proposal.reasoning,
      confidence: proposal.confidence,
      status: "PENDING",
      approvalId: approval.id,
    },
  });

  // Create notification for workspace admins
  const admins = await db.user.findMany({
    where: { orgId: context.orgId, role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  for (const admin of admins) {
    await db.notification.create({
      data: {
        userId: admin.id,
        type: "APPROVAL_REQUEST",
        title: `Agent needs approval: ${proposal.description}`,
        body: `Risk: ${classification.riskTier} (score ${classification.riskScore}/16). ${proposal.reasoning.slice(0, 200)}`,
        actionUrl: "/approvals",
        metadata: { approvalId: approval.id, riskTier: classification.riskTier },
      },
    });
  }

  // Log activity
  await logActivity(context.agentId, "approval",
    `Submitted for approval (${classification.riskTier}): ${proposal.description}`,
    {
      approvalId: approval.id, riskScore: classification.riskScore,
      riskTier: classification.riskTier, creditCost,
    },
  );

  return { success: true, action: "sent_to_approval", approvalId: approval.id, classification };
}

/**
 * Execute the approved action after human approval.
 * Called from the approval API route when status changes to APPROVED.
 */
export async function executeApprovedAction(approvalId: string): Promise<{ success: boolean; error?: string }> {
  const approval = await db.approval.findUnique({
    where: { id: approvalId },
    include: {
      decision: { include: { agent: { include: { org: true, deployments: { where: { isActive: true }, take: 1 } } } } },
      project: true,
    },
  });

  if (!approval?.decision) return { success: false, error: "No linked decision" };

  const agent = approval.decision.agent;
  const deployment = agent.deployments[0];
  if (!deployment) return { success: false, error: "No active deployment" };

  const proposal: ActionProposal = {
    type: approval.decision.type as any,
    description: approval.decision.description,
    reasoning: approval.decision.reasoning,
    confidence: approval.decision.confidence,
    scheduleImpact: (approval.impactScores as any)?.schedule || 1,
    costImpact: (approval.impactScores as any)?.cost || 1,
    scopeImpact: (approval.impactScores as any)?.scope || 1,
    stakeholderImpact: (approval.impactScores as any)?.stakeholder || 1,
  };

  const creditCost = ((approval.impact as any)?.creditCost) || getActionCreditCost(proposal.type);

  try {
    const mutationResult = await performMutation(proposal, {
      agentId: agent.id,
      deploymentId: deployment.id,
      projectId: approval.projectId,
      orgId: agent.orgId,
      autonomyLevel: agent.autonomyLevel,
    });

    await CreditService.deduct(agent.orgId, creditCost, `Approved: ${proposal.description}`, agent.id);

    await logActivity(agent.id, inferActivityType(proposal.type),
      `Executed after approval: ${proposal.description}`,
      { approvalId, ...mutationResult },
    );

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── Database Mutations ───

async function performMutation(
  proposal: ActionProposal,
  context: ExecutionContext,
): Promise<Record<string, any>> {
  // ── 24-hour cooldown check for affected items ──
  if (proposal.affectedItems?.length) {
    for (const item of proposal.affectedItems) {
      if (item.type === "task") {
        const task = await db.task.findUnique({ where: { id: item.id }, select: { lastEditedBy: true, updatedAt: true } });
        if (task && isInCooldown(task.lastEditedBy, task.updatedAt)) {
          return { action: "skipped_cooldown", itemId: item.id, reason: "Human edited this item within 24 hours — agent respects override" };
        }
      }
      if (item.type === "risk") {
        const risk = await db.risk.findUnique({ where: { id: item.id }, select: { updatedAt: true } });
        // Risks don't have lastEditedBy yet, but we can add it later
      }
    }
  }

  switch (proposal.type) {
    case "TASK_ASSIGNMENT": {
      // Create or update a task
      const items = proposal.affectedItems?.filter(i => i.type === "task") || [];
      if (items.length > 0) {
        // Update existing task
        const task = await db.task.update({
          where: { id: items[0].id },
          data: {
            status: "IN_PROGRESS",
            lastEditedBy: `agent:${context.agentId}`,
          },
        });
        return { taskId: task.id, action: "updated" };
      } else {
        // Create new task from proposal
        const task = await db.task.create({
          data: {
            projectId: context.projectId,
            title: proposal.description,
            description: proposal.reasoning,
            status: "TODO",
            createdBy: `agent:${context.agentId}`,
          },
        });
        return { taskId: task.id, action: "created" };
      }
    }

    case "RISK_RESPONSE": {
      const items = proposal.affectedItems?.filter(i => i.type === "risk") || [];
      if (items.length > 0) {
        // Update existing risk
        const risk = await db.risk.update({
          where: { id: items[0].id },
          data: {
            mitigation: proposal.reasoning,
            status: "MITIGATING",
          },
        });
        return { riskId: risk.id, action: "updated" };
      } else {
        // Identify new risk
        const risk = await db.risk.create({
          data: {
            projectId: context.projectId,
            title: proposal.description,
            description: proposal.reasoning,
            probability: proposal.scheduleImpact,
            impact: proposal.costImpact,
            score: proposal.scheduleImpact * proposal.costImpact,
            status: "OPEN",
            category: "AI-identified",
          },
        });
        return { riskId: risk.id, action: "created" };
      }
    }

    case "SCHEDULE_CHANGE": {
      const items = proposal.affectedItems?.filter(i => i.type === "task") || [];
      for (const item of items) {
        await db.task.update({
          where: { id: item.id },
          data: { lastEditedBy: `agent:${context.agentId}` },
        });
      }
      return { tasksAffected: items.length, action: "schedule_updated" };
    }

    case "RESOURCE_ALLOCATION": {
      const items = proposal.affectedItems?.filter(i => i.type === "task") || [];
      for (const item of items) {
        await db.task.update({
          where: { id: item.id },
          data: { lastEditedBy: `agent:${context.agentId}` },
        });
      }
      return { tasksReassigned: items.length, action: "resources_reallocated" };
    }

    case "BUDGET_CHANGE":
    case "SCOPE_CHANGE": {
      const cr = await db.changeRequest.create({
        data: {
          projectId: context.projectId,
          title: proposal.description,
          description: proposal.reasoning,
          impact: {
            scheduleImpact: proposal.scheduleImpact,
            costImpact: proposal.costImpact,
            scopeImpact: proposal.scopeImpact,
          },
          status: "SUBMITTED",
          requestedBy: `agent:${context.agentId}`,
        },
      });
      return { changeRequestId: cr.id, action: "change_request_created" };
    }

    case "COMMUNICATION": {
      // Log as a communication activity — actual email sending happens separately
      return { action: "communication_logged" };
    }

    case "ESCALATION": {
      // Create a high-priority notification
      const admins = await db.user.findMany({
        where: { orgId: context.orgId, role: { in: ["OWNER", "ADMIN"] } },
        select: { id: true },
      });
      for (const admin of admins) {
        await db.notification.create({
          data: {
            userId: admin.id,
            type: "RISK_ESCALATION",
            title: `Agent escalation: ${proposal.description}`,
            body: proposal.reasoning,
            actionUrl: `/projects/${context.projectId}`,
          },
        });
      }
      return { action: "escalated", notifiedAdmins: admins.length };
    }

    case "DOCUMENT_GENERATION": {
      const artefact = await db.agentArtefact.create({
        data: {
          agentId: context.agentId,
          projectId: context.projectId,
          name: proposal.description,
          content: proposal.reasoning,
          format: "markdown",
          status: "DRAFT",
        },
      });
      return { artefactId: artefact.id, action: "document_generated" };
    }

    case "PHASE_GATE": {
      // Phase gates are ALWAYS routed to HITL — this should never be called directly
      return { action: "phase_gate_submitted" };
    }

    default:
      return { action: "unknown", type: proposal.type };
  }
}

// ─── Helpers ───

function inferActivityType(decisionType: string): string {
  const map: Record<string, string> = {
    TASK_ASSIGNMENT: "document",
    RISK_RESPONSE: "risk",
    SCHEDULE_CHANGE: "document",
    RESOURCE_ALLOCATION: "document",
    BUDGET_CHANGE: "document",
    SCOPE_CHANGE: "document",
    COMMUNICATION: "chat",
    ESCALATION: "risk",
    DOCUMENT_GENERATION: "document",
    PHASE_GATE: "approval",
  };
  return map[decisionType] || "document";
}

async function logActivity(agentId: string, type: string, summary: string, metadata?: any) {
  await db.agentActivity.create({ data: { agentId, type, summary, metadata } });
}
