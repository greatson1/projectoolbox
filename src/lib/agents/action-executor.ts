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
    // Queue for auto-resume when credits are topped up
    await queueBlockedProposal(proposal, context, "insufficient_org_credits");
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
      // Queue for auto-resume when monthly budget resets or is increased
      await queueBlockedProposal(proposal, context, "monthly_budget_exceeded");
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
    // Map proposal type to valid DecisionType enum
    const typeMap: Record<string, string> = {
      DOCUMENT_GENERATION: "TASK_ASSIGNMENT", RISK_IDENTIFICATION: "RISK_RESPONSE",
      STAKEHOLDER_COMMUNICATION: "ESCALATION", BUDGET_ACTION: "RESOURCE_ALLOCATION",
    };
    await db.agentDecision.create({
      data: {
        agentId: context.agentId,
        type: (typeMap[proposal.type] || proposal.type || "TASK_ASSIGNMENT") as any,
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

    // Log activity — use actual mutation result for summary, not the LLM's stated description
    const actualSummary = buildActualSummary(proposal, mutationResult, classification.riskTier);
    await logActivity(context.agentId, inferActivityType(proposal.type),
      actualSummary,
      {
        type: proposal.type, riskScore: classification.riskScore,
        riskTier: classification.riskTier, creditCost,
        ...mutationResult,
      },
    );

    // Write to AuditLog for compliance trail
    try {
      await db.auditLog.create({
        data: {
          orgId: context.orgId,
          action: `Agent auto-executed: ${proposal.type}`,
          target: proposal.description.slice(0, 200),
          details: { riskScore: classification.riskScore, riskTier: classification.riskTier, creditCost, agentId: context.agentId },
        },
      });
    } catch {}

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
  // description = Executive Summary (WHAT the agent will do — shown to human first)
  // reasoningChain = Business Rationale (WHY this action is needed now)
  const executiveSummary = proposal.summary || proposal.description;
  const approval = await db.approval.create({
    data: {
      projectId: context.projectId,
      requestedById: context.agentId,
      type: classification.approvalType as any,
      title: proposal.description,
      description: executiveSummary,
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
  const typeMap2: Record<string, string> = {
    DOCUMENT_GENERATION: "TASK_ASSIGNMENT", RISK_IDENTIFICATION: "RISK_RESPONSE",
    STAKEHOLDER_COMMUNICATION: "ESCALATION", BUDGET_ACTION: "RESOURCE_ALLOCATION",
  };
  await db.agentDecision.create({
    data: {
      agentId: context.agentId,
      type: (typeMap2[proposal.type] || proposal.type || "TASK_ASSIGNMENT") as any,
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

  // Audit log for HITL routing
  try {
    await db.auditLog.create({
      data: {
        orgId: context.orgId,
        action: `Agent routed to HITL: ${proposal.type}`,
        target: proposal.description.slice(0, 200),
        details: { riskScore: classification.riskScore, riskTier: classification.riskTier, approvalId: approval.id, agentId: context.agentId },
      },
    });
  } catch {}

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
      // Create or batch-update tasks
      const items = proposal.affectedItems?.filter(i => i.type === "task") || [];
      if (items.length > 0) {
        // Batch update all specified tasks — update each individually to handle missing IDs gracefully
        const updatedIds: string[] = [];
        for (const item of items) {
          try {
            await db.task.update({
              where: { id: item.id },
              data: { status: "IN_PROGRESS", lastEditedBy: `agent:${context.agentId}` },
            });
            updatedIds.push(item.id);
          } catch {
            // Skip tasks that don't exist (LLM may fabricate IDs)
          }
        }
        // Auto-log cost for any tasks that reached DONE
        for (const id of updatedIds) {
          try {
            const { logTaskCompletion } = await import("./cost-estimator");
            await logTaskCompletion(id, context.projectId, context.agentId);
          } catch {}
        }
        return { tasksUpdated: updatedIds.length, taskIds: updatedIds, action: "updated" };
      } else {
        // No task IDs given — check if LLM is fabricating a bulk progress claim
        const isBulkClaim = /\d+\s+task/i.test(proposal.description);
        if (isBulkClaim) {
          // Block: LLM claimed to progress multiple tasks but provided no task IDs to verify
          return { action: "blocked_fabrication", reason: "Bulk task progress claimed without task IDs — no DB changes made" };
        }

        // ── Sham-task detector (Nova "Stakeholder comm - Project initiation approved" bug) ──
        // The agent sometimes proposes a freshly-named "task" that is really
        // a duplicate of an existing scaffolded PM task plus a self-asserted
        // status suffix ("- approved", "- complete", "- done"). It then uses
        // the new TODO row as cover for claiming the phase is ready to advance.
        // Two-step defence:
        //   1. If the title carries a status-claim suffix, strip it before any
        //      duplicate check and refuse to create — this is never a genuine
        //      new unit of work.
        //   2. Fuzzy-match the (cleaned) title against existing scaffolded
        //      tasks; if ≥2 significant tokens overlap, treat as duplicate
        //      and refuse with a hint pointing the agent at the real task.
        const STATUS_CLAIM = /\s*[-–—:]\s*(approved|complete[d]?|done|finished|signed[\s-]?off|ticked|resolved)\s*$/i;
        const hasStatusClaim = STATUS_CLAIM.test(proposal.description);
        const cleanTitle = proposal.description.replace(STATUS_CLAIM, "").trim();

        const STOP = new Set([
          "the","and","for","with","that","this","from","into","over","under",
          "task","new","add","update","review","ensure","make","sure","communication",
          "approved","complete","completed","done","finished",
        ]);
        const tokenise = (s: string): Set<string> => {
          const toks = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
          return new Set(toks.filter(t => t.length >= 4 && !STOP.has(t)));
        };
        const proposalTokens = tokenise(cleanTitle);

        if (proposalTokens.size >= 1) {
          const candidates = await db.task.findMany({
            where: {
              projectId: context.projectId,
              description: { contains: "[scaffolded]" },
            },
            select: { id: true, title: true, status: true, description: true },
          });
          let bestMatch: { id: string; title: string; overlap: number; status: string } | null = null;
          for (const c of candidates) {
            const cTokens = tokenise(c.title);
            let overlap = 0;
            for (const t of proposalTokens) if (cTokens.has(t)) overlap++;
            if (overlap >= 2 && (!bestMatch || overlap > bestMatch.overlap)) {
              bestMatch = { id: c.id, title: c.title, overlap, status: c.status };
            }
          }

          if (bestMatch) {
            return {
              action: "blocked_duplicate_scaffolded",
              reason: `Proposed task duplicates existing scaffolded PM task "${bestMatch.title}" (status: ${bestMatch.status}). The agent must update the existing task on the PM Tracker — not create a new one. No new task created.`,
              existingTaskId: bestMatch.id,
              existingTaskTitle: bestMatch.title,
            };
          }
        }

        if (hasStatusClaim) {
          // Title looks like a status claim ("X - approved") but no existing
          // scaffolded match was found — still refuse. We never accept "task
          // = X is now approved" as a genuine new unit of work.
          return {
            action: "blocked_status_claim_disguised_as_task",
            reason: `Proposal title "${proposal.description}" looks like a self-asserted completion claim, not a new unit of work. Update the relevant existing task instead.`,
          };
        }

        // Create a genuinely new task from proposal
        const task = await db.task.create({
          data: {
            projectId: context.projectId,
            title: proposal.description,
            description: proposal.reasoning,
            status: "TODO",
            createdBy: `agent:${context.agentId}`,
          },
        });
        // Auto-estimate labour cost for new task
        try {
          const { estimateTaskCost } = await import("./cost-estimator");
          await estimateTaskCost(task.id, context.projectId, context.agentId);
        } catch {}
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
        // Identify new risk — extract a concise, noun-phrase title from the verbose action description
        const cleanRiskTitle = proposal.description
          .replace(/^(identify|log|flag|create|document|register|record|add|note|raise|report)\s+(and\s+\w+\s+)?(a\s+|an\s+|the\s+)?(new\s+)?(risk\s*[:\-–—]?\s*)?/i, "")
          .replace(/\s+for\s+["']?[^"'.]{0,80}["']?\.?\s*$/i, "")
          .replace(/\s*\(.*?\)/g, "")
          .replace(/\s*:\s*.*$/, "")
          .trim();
        const riskTitle = (
          cleanRiskTitle.length >= 5
            ? cleanRiskTitle.charAt(0).toUpperCase() + cleanRiskTitle.slice(1)
            : proposal.description
        ).slice(0, 120);

        const risk = await db.risk.create({
          data: {
            projectId: context.projectId,
            title: riskTitle,
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
      // Extract a clean, concise document name — strip action-verb prefix and trailing project context
      const cleanName = proposal.description
        .replace(/^(generate|create|draft|produce|write|prepare|develop|build|update|review)\s+(a\s+|an\s+|the\s+)?/i, "")
        .replace(/\s+for\s+["']?[^"'.]{0,60}["']?\.?\s*$/i, "")
        .replace(/\s*\(.*?\)/g, "")
        .replace(/\s+[-–—].*$/, "")
        .trim();
      const artefactName = (cleanName.charAt(0).toUpperCase() + cleanName.slice(1)).slice(0, 120)
        || proposal.description.slice(0, 120);

      // Dedup — skip if a closely-named artefact already exists for this project
      const existingArtefacts = await db.agentArtefact.findMany({
        where: { projectId: context.projectId, agentId: context.agentId },
        select: { id: true, name: true },
      });
      const nameKeywords = artefactName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const closeMatch = existingArtefacts.find(a => {
        const lc = a.name.toLowerCase();
        return nameKeywords.some(kw => lc.includes(kw));
      });
      if (closeMatch) return { artefactId: closeMatch.id, action: "document_already_exists" };

      // Generate actual content via Claude — enriched with KB research context
      const project = await db.project.findUnique({
        where: { id: context.projectId },
        select: { name: true, description: true, budget: true, methodology: true, category: true, startDate: true, endDate: true },
      });

      let content = proposal.reasoning; // fallback

      if (project && process.env.ANTHROPIC_API_KEY) {
        try {
          const today = new Date().toLocaleDateString("en-GB");
          const budget = (project.budget || 0).toLocaleString();
          const startDate = project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : "TBD";
          const endDate = project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : "TBD";

          // Fetch KB facts so the document is grounded in researched information
          let knowledgeSection = "";
          try {
            const kbItems = await db.knowledgeBaseItem.findMany({
              where: { agentId: context.agentId, projectId: context.projectId, NOT: { title: { startsWith: "__" } } },
              orderBy: [{ trustLevel: "desc" }, { updatedAt: "desc" }],
              select: { title: true, content: true, trustLevel: true },
              take: 20,
            });
            if (kbItems.length > 0) {
              knowledgeSection = "\nKNOWLEDGE BASE (verified research — use these facts, do NOT invent alternatives):\n" +
                kbItems.map(i => `- [${i.trustLevel}] ${i.title}: ${i.content.slice(0, 300)}`).join("\n") + "\n";
            }
          } catch { /* non-fatal — generate without KB */ }

          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4096,
              messages: [{
                role: "user",
                content: `You are an expert AI Project Manager. Generate a complete, professional **${artefactName}** for this project.

TODAY: ${today}

PROJECT DETAILS
- Name: ${project.name}
- Description: ${project.description || "No description provided"}
- Budget: £${budget}
- Methodology: ${project.methodology || "Traditional (PMI-Style)"}
- Category: ${project.category || "general"}
- Timeline: ${startDate} → ${endDate}
${knowledgeSection}
CONTEXT: ${proposal.reasoning}

RULES:
1. Use the actual project name "${project.name}", actual dates, and actual budget £${budget} throughout
2. Every table row must have a named owner or responsible role
3. Include Status, % Complete, and Last Updated fields in tables
4. British English throughout (colour, organisation, prioritise)
5. End with an "Agent Progress Tracking Protocol" section
6. No preamble — start the document content immediately
7. ONLY use facts from the Knowledge Base and Project Details above — use [TBC] for anything not provided
8. NEVER fabricate names, contacts, vendors, or specific details not in the data above

Produce the full, complete document. Do not truncate or use placeholders.`,
              }],
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const generated = (data.content?.[0]?.text || "").trim();
            if (generated.length > 100) content = generated;
          }
        } catch {
          // Silently fall back to proposal.reasoning
        }
      }

      // Resolve the current phase row ID so the artefact is correctly linked.
      // Without this, artefacts generated by the autonomous cycle have phaseId: null
      // and the phase-advancement check (all artefacts approved → advance) is broken.
      let autoPhaseId: string | null = null;
      try {
        const dep = await db.agentDeployment.findFirst({
          where: { agentId: context.agentId, projectId: context.projectId, isActive: true },
          select: { currentPhase: true },
        });
        if (dep?.currentPhase) {
          const phaseRow = await db.phase.findFirst({
            where: { projectId: context.projectId, name: dep.currentPhase },
            select: { id: true },
          });
          autoPhaseId = phaseRow?.id ?? null;
        }
      } catch { /* non-fatal — artefact saves without phaseId */ }

      // Dedupe check — prevent creating duplicate artefacts
      try {
        const { artefactExists } = await import("@/lib/agents/artefact-dedupe");
        const dup = await artefactExists(context.projectId, context.agentId, artefactName, autoPhaseId);
        if (dup.exists) {
          console.log(`[action-executor] Skipped duplicate artefact: "${artefactName}" (already exists as "${dup.existingName}")`);
          return { artefactId: dup.existingId, action: "document_skipped_duplicate" };
        }
      } catch {}

      const artefact = await db.agentArtefact.create({
        data: {
          agentId: context.agentId,
          projectId: context.projectId,
          name: artefactName,
          content,
          format: "markdown",
          status: "DRAFT",
          ...(autoPhaseId ? { phaseId: autoPhaseId } : {}),
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

/**
 * Build an activity summary from actual DB mutation results rather than the LLM's stated intent.
 * This prevents misleading log entries like "Auto-progressed 11 tasks" when only 1 (or 0) changed.
 */
function buildActualSummary(proposal: ActionProposal, mutationResult: any, riskTier: string): string {
  const tier = riskTier ? ` (${riskTier})` : "";

  if (!mutationResult) return `Auto-executed${tier}: ${proposal.description}`;

  // Blocked fabrication — log what actually happened (nothing)
  if (mutationResult.action === "blocked_fabrication") {
    return `Blocked: ${mutationResult.reason}`;
  }

  switch (proposal.type) {
    case "TASK_ASSIGNMENT": {
      if (mutationResult.action === "updated") {
        const count = mutationResult.tasksUpdated ?? 1;
        return `Updated ${count} task${count !== 1 ? "s" : ""} to IN_PROGRESS${tier}`;
      }
      if (mutationResult.action === "created") {
        return `Created task: "${proposal.description.slice(0, 80)}"${tier}`;
      }
      break;
    }
    case "RISK_RESPONSE": {
      if (mutationResult.action === "created") {
        return `Identified risk: "${proposal.description.slice(0, 80)}"${tier}`;
      }
      if (mutationResult.action === "updated") {
        return `Risk mitigated${tier}: ${proposal.description.slice(0, 80)}`;
      }
      break;
    }
    case "SCHEDULE_CHANGE": {
      return `Schedule updated${tier}: ${proposal.description.slice(0, 80)}`;
    }
    case "RESOURCE_ALLOCATION": {
      return `Resource allocated${tier}: ${proposal.description.slice(0, 80)}`;
    }
    case "DOCUMENT_GENERATION": {
      return `Document generated${tier}: ${proposal.description.slice(0, 80)}`;
    }
    case "PHASE_GATE": {
      return `Phase gate raised${tier}: ${proposal.description.slice(0, 80)}`;
    }
    case "COMMUNICATION": {
      return `Communication sent${tier}: ${proposal.description.slice(0, 80)}`;
    }
  }

  return `Auto-executed${tier}: ${proposal.description.slice(0, 100)}`;
}

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

/**
 * Store a budget-blocked proposal in AgentJob for later auto-resume.
 * Uses type "budget_resume" so the job processor can pick it up.
 * Deduplicates by proposal type+description to avoid flooding the queue.
 */
async function queueBlockedProposal(
  proposal: ActionProposal,
  context: ExecutionContext,
  reason: string,
): Promise<void> {
  try {
    // Only queue if there isn't already a pending budget_resume job for this proposal
    const existing = await db.agentJob.findFirst({
      where: {
        agentId: context.agentId,
        type: "budget_resume",
        status: "PENDING",
        payload: { path: ["proposalDescription"], equals: proposal.description },
      },
    });
    if (existing) return; // Already queued

    await db.agentJob.create({
      data: {
        agentId: context.agentId,
        deploymentId: context.deploymentId,
        type: "budget_resume",
        priority: 3,
        status: "PENDING",
        payload: {
          proposal: {
            type: proposal.type,
            description: proposal.description,
            reasoning: proposal.reasoning,
            confidence: proposal.confidence,
            scheduleImpact: proposal.scheduleImpact,
            costImpact: proposal.costImpact,
            scopeImpact: proposal.scopeImpact,
            stakeholderImpact: proposal.stakeholderImpact,
            creditCost: proposal.creditCost,
          },
          proposalDescription: proposal.description, // top-level for dedup query
          context: { projectId: context.projectId, orgId: context.orgId, autonomyLevel: context.autonomyLevel },
          blockedReason: reason,
          blockedAt: new Date().toISOString(),
        },
      },
    });
  } catch {
    // Non-critical — don't fail the main flow if queuing fails
  }
}

/**
 * Resume budget-blocked proposals for an agent after credits are topped up.
 * Called automatically by CreditService.grant() and available as a manual trigger.
 * Returns the number of proposals re-processed.
 */
export async function resumeBlockedProposals(agentId: string): Promise<{ resumed: number; failed: number }> {
  // Find all pending budget_resume jobs for this agent
  const jobs = await db.agentJob.findMany({
    where: { agentId, type: "budget_resume", status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 20, // process up to 20 queued actions at once
  });

  if (jobs.length === 0) return { resumed: 0, failed: 0 };

  // Get agent's deployment and org
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    include: { agent: { select: { orgId: true, autonomyLevel: true } } },
    orderBy: { deployedAt: "desc" },
  });
  if (!deployment) return { resumed: 0, failed: jobs.length };

  const orgId = deployment.agent.orgId;
  const autonomyLevel = deployment.agent.autonomyLevel;

  let resumed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const payload = job.payload as any;
      const proposal = payload?.proposal as ActionProposal;
      const projectId = payload?.context?.projectId || deployment.projectId;
      if (!proposal) { failed++; continue; }

      // Mark job as claimed
      await db.agentJob.update({ where: { id: job.id }, data: { status: "CLAIMED", startedAt: new Date() } });

      const result = await processActionProposal(proposal, {
        agentId, deploymentId: deployment.id, projectId, orgId, autonomyLevel,
      });

      if (result.action !== "blocked") {
        await db.agentJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date(), result: result as any } });
        resumed++;
      } else {
        // Still blocked (e.g. credits ran out mid-resume)
        await db.agentJob.update({ where: { id: job.id }, data: { status: "PENDING", startedAt: null } });
        failed++;
        break; // Stop processing if still out of credits
      }
    } catch (e: any) {
      await db.agentJob.update({ where: { id: job.id }, data: { status: "FAILED", error: e.message, completedAt: new Date() } }).catch(() => {});
      failed++;
    }
  }

  if (resumed > 0) {
    await logActivity(agentId, "deployment", `Resumed ${resumed} blocked action(s) after credit top-up${failed > 0 ? ` (${failed} still pending)` : ""}`);
  }

  return { resumed, failed };
}
