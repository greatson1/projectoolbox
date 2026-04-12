/**
 * Knowledge-Driven Change Proposal System
 *
 * When the agent detects new information (from meetings, chat, emails, KB updates)
 * that suggests project progress or scope has changed, it:
 *
 *   1. Identifies which tasks/items are affected
 *   2. Proposes specific updates (progress %, dates, status, new risks)
 *   3. Creates a structured change proposal (AgentDecision + Approval)
 *   4. Posts an interactive card in chat with direct approval links
 *   5. On approval → auto-applies changes to tasks, artefacts, and flags dependents
 *   6. On rejection → logs the decision and moves on
 *
 * This replaces the agent silently making changes — everything goes through HITL.
 */

import { db } from "@/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProposedChange {
  /** What is being changed */
  entityType: "task" | "risk" | "artefact" | "budget" | "milestone" | "scope";
  /** DB id of the entity (task ID, risk ID, etc.) */
  entityId?: string;
  /** Human-readable title of the item */
  title: string;
  /** Field being changed */
  field: string;
  /** Current value */
  currentValue: string;
  /** Proposed new value */
  proposedValue: string;
  /** Why this change is being proposed */
  reason: string;
}

export interface ChangeProposal {
  /** What triggered this proposal */
  trigger: "meeting_notes" | "email" | "chat" | "knowledge_update" | "autonomous_cycle" | "risk_trigger" | "milestone_reached";
  /** Source description */
  source: string;
  /** Category of change */
  type: "SCHEDULE_CHANGE" | "BUDGET_CHANGE" | "SCOPE_CHANGE" | "RISK_RESPONSE" | "TASK_ASSIGNMENT";
  /** Short title */
  title: string;
  /** Detailed reasoning */
  reasoning: string;
  /** Confidence (0-1) */
  confidence: number;
  /** Individual changes proposed */
  changes: ProposedChange[];
  /** Impact assessment */
  impact: { schedule: number; cost: number; scope: number; stakeholder: number };
}

// ─── Create a change proposal ────────────────────────────────────────────────

/**
 * Creates an AgentDecision + Approval + chat notification for a proposed change.
 * Returns the approval ID so the chat can link directly to it.
 */
export async function createChangeProposal(
  agentId: string,
  projectId: string,
  orgId: string,
  proposal: ChangeProposal,
): Promise<{ decisionId: string; approvalId: string }> {
  // Build affected items list for the approval
  const affectedItems = proposal.changes.map(c => ({
    type: c.entityType,
    id: c.entityId || "",
    title: c.title,
    field: c.field,
    from: c.currentValue,
    to: c.proposedValue,
  }));

  // Create the decision
  const decision = await db.agentDecision.create({
    data: {
      agentId,
      type: proposal.type as any,
      description: proposal.title,
      reasoning: proposal.reasoning,
      confidence: proposal.confidence,
      status: "PENDING",
    },
  });

  // Create linked approval
  const approval = await db.approval.create({
    data: {
      projectId,
      requestedById: agentId,
      type: "CHANGE_REQUEST",
      title: proposal.title,
      description: buildApprovalDescription(proposal),
      status: "PENDING",
      urgency: proposal.impact.schedule >= 3 || proposal.impact.cost >= 3 ? "HIGH" : "MEDIUM",
      impactScores: proposal.impact as any,
      reasoningChain: proposal.reasoning,
      affectedItems: affectedItems as any,
      impact: {
        trigger: proposal.trigger,
        source: proposal.source,
        changeCount: proposal.changes.length,
      } as any,
    },
  });

  // Create a ChangeRequest record so it appears on the Change Control page
  await db.changeRequest.create({
    data: {
      projectId,
      title: proposal.title,
      description: proposal.reasoning,
      status: "SUBMITTED",
      requestedBy: `agent:${agentId}`,
      impact: {
        ...proposal.impact,
        trigger: proposal.trigger,
        source: proposal.source,
        approvalId: approval.id,
        changes: proposal.changes.map(c => ({ title: c.title, field: c.field, from: c.currentValue, to: c.proposedValue })),
      } as any,
    },
  }).catch(() => {});

  // Link decision to approval
  await db.agentDecision.update({
    where: { id: decision.id },
    data: { approvalId: approval.id },
  });

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Proposed ${proposal.changes.length} change(s): ${proposal.title}`,
    },
  }).catch(() => {});

  // Post interactive card to chat
  await db.chatMessage.create({
    data: {
      agentId,
      role: "agent",
      content: "__CHANGE_PROPOSAL__",
      metadata: {
        type: "change_proposal",
        approvalId: approval.id,
        decisionId: decision.id,
        title: proposal.title,
        trigger: proposal.trigger,
        source: proposal.source,
        changeCount: proposal.changes.length,
        changes: proposal.changes.map(c => ({
          title: c.title,
          field: c.field,
          from: c.currentValue,
          to: c.proposedValue,
          reason: c.reason,
        })),
        impact: proposal.impact,
        confidence: proposal.confidence,
      } as any,
    },
  }).catch(() => {});

  // Notify via all configured channels (in-app + email + slack + telegram)
  try {
    const agent = await db.agent.findUnique({ where: { id: agentId }, select: { name: true } });
    const project = await db.project.findUnique({ where: { id: projectId }, select: { name: true } });
    const { dispatchNotification } = await import("@/lib/agents/notification-channels");
    await dispatchNotification(orgId, {
      agentId,
      agentName: agent?.name || "Agent",
      projectName: project?.name,
      title: `Change Proposal: ${proposal.title}`,
      body: `${proposal.changes.length} change(s) proposed. Review and approve.`,
      actionUrl: "/approvals",
      urgency: proposal.impact.schedule >= 3 || proposal.impact.cost >= 3 ? "high" : "medium",
    });
  } catch {}

  return { decisionId: decision.id, approvalId: approval.id };
}

// ─── Apply approved changes ─────────────────────────────────────────────────

/**
 * Called when a change proposal is approved. Applies all proposed changes
 * to tasks, artefacts, risks, etc. and triggers reverse sync.
 */
export async function applyApprovedChanges(approvalId: string): Promise<{ applied: number }> {
  const approval = await db.approval.findUnique({
    where: { id: approvalId },
    select: { affectedItems: true, projectId: true, requestedById: true },
  });
  if (!approval) return { applied: 0 };

  const items = (approval.affectedItems as any[]) || [];
  let applied = 0;

  for (const item of items) {
    try {
      if (item.type === "task" && item.id) {
        const updateData: Record<string, any> = {};

        if (item.field === "progress" || item.field === "% Complete") {
          updateData.progress = parseInt(item.to) || 0;
        } else if (item.field === "status") {
          updateData.status = item.to;
        } else if (item.field === "startDate" || item.field === "Planned Start") {
          updateData.startDate = new Date(item.to);
        } else if (item.field === "endDate" || item.field === "Planned End") {
          updateData.endDate = new Date(item.to);
        } else if (item.field === "estimatedHours") {
          updateData.estimatedHours = parseFloat(item.to) || null;
        } else if (item.field === "priority") {
          updateData.priority = item.to;
        }

        if (Object.keys(updateData).length > 0) {
          updateData.lastEditedBy = `agent:${approval.requestedById}`;
          await db.task.update({ where: { id: item.id }, data: updateData });

          // Trigger reverse sync to update artefact CSV
          try {
            const { syncTaskToArtefact } = await import("@/lib/agents/artefact-sync");
            await syncTaskToArtefact(approval.projectId, item.id, updateData);
          } catch {}

          applied++;
        }
      } else if (item.type === "risk" && item.id) {
        const riskUpdate: Record<string, any> = {};
        if (item.field === "status") riskUpdate.status = item.to;
        if (item.field === "probability") riskUpdate.probability = parseInt(item.to) || 3;
        if (item.field === "impact") riskUpdate.impact = parseInt(item.to) || 3;
        if (item.field === "score") riskUpdate.score = parseInt(item.to) || 9;

        if (Object.keys(riskUpdate).length > 0) {
          await db.risk.update({ where: { id: item.id }, data: riskUpdate });
          applied++;
        }
      } else if (item.type === "milestone") {
        // Milestone changes are tracked as task updates (milestones are tasks with isMilestone flag)
        if (item.id) {
          await db.task.update({
            where: { id: item.id },
            data: { status: item.to === "Completed" ? "DONE" : "IN_PROGRESS", progress: item.to === "Completed" ? 100 : 50 },
          });
          applied++;
        }
      }
    } catch (e) {
      console.error(`[change-proposals] Failed to apply change to ${item.type} ${item.id}:`, e);
    }
  }

  // Log
  if (applied > 0) {
    await db.agentActivity.create({
      data: {
        agentId: approval.requestedById,
        type: "document",
        summary: `Applied ${applied} approved change(s) from "${(approval as any).title || "change request"}"`,
      },
    }).catch(() => {});
  }

  return { applied };
}

// ─── Knowledge scanning ─────────────────────────────────────────────────────

/**
 * Scans recent knowledge base additions for information that implies
 * progress changes, and generates change proposals if found.
 *
 * Called from the autonomous cycle (agent-tick or VPS).
 */
export async function scanKnowledgeForChanges(
  agentId: string,
  projectId: string,
  orgId: string,
): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;

  // Get recent KB items added in the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentKB = await db.knowledgeBaseItem.findMany({
    where: {
      agentId,
      projectId,
      updatedAt: { gte: since },
      type: { in: ["TEXT", "EMAIL", "TRANSCRIPT", "CHAT"] },
    },
    select: { title: true, content: true, type: true, tags: true },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });

  if (recentKB.length === 0) return 0;

  // Check if we already scanned these recently (avoid duplicate proposals)
  const lastScan = await db.agentActivity.findFirst({
    where: { agentId, type: "document", summary: { contains: "knowledge scan" } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (lastScan && Date.now() - lastScan.createdAt.getTime() < 4 * 60 * 60 * 1000) {
    return 0; // Scanned less than 4 hours ago
  }

  // Get current tasks for context
  const tasks = await db.task.findMany({
    where: { projectId, status: { not: "DONE" } },
    select: { id: true, title: true, progress: true, status: true, startDate: true, endDate: true, description: true },
    take: 30,
    orderBy: { updatedAt: "desc" },
  });

  if (tasks.length === 0) return 0;

  // Ask Claude to identify progress changes from the new knowledge
  const kbSummary = recentKB.map(k => `[${k.type}] ${k.title}: ${k.content.slice(0, 300)}`).join("\n\n");
  const taskSummary = tasks.map(t => `- [${t.id.slice(-6)}] "${t.title}" — ${t.progress}% complete, status: ${t.status}`).join("\n");

  const prompt = `You are a project management AI analysing new information for schedule updates.

RECENT KNOWLEDGE (new information from meetings, emails, chat):
${kbSummary}

CURRENT TASKS:
${taskSummary}

Based on the new information, identify any tasks whose progress, status, dates, or priority should change.

For each change, provide:
- taskTitle: exact task title from the list above
- taskId: the ID in brackets (e.g. "abc123")
- field: "progress" | "status" | "startDate" | "endDate" | "priority"
- currentValue: current value from the task list
- proposedValue: what it should change to
- reason: why (reference the specific knowledge item)

RULES:
- Only propose changes supported by the new knowledge — don't guess
- Progress values must be 0-100
- Status values: TODO, IN_PROGRESS, DONE, BLOCKED
- If a meeting confirmed something is complete, set progress to 100 and status to DONE
- If new information suggests a delay, propose updated dates
- If nothing needs changing, return an empty array

Return ONLY a JSON array — no explanation:
[{"taskTitle": "...", "taskId": "...", "field": "progress", "currentValue": "50%", "proposedValue": "100%", "reason": "Meeting confirmed this is done"}]`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return 0;
    const data = await response.json();
    const text = (data.content?.[0]?.text || "").trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return 0;

    const changes: any[] = JSON.parse(match[0]);
    if (changes.length === 0) return 0;

    // Build change proposal
    const proposedChanges: ProposedChange[] = changes.map(c => ({
      entityType: "task" as const,
      entityId: tasks.find(t => t.id.endsWith(c.taskId) || t.title === c.taskTitle)?.id,
      title: c.taskTitle,
      field: c.field,
      currentValue: c.currentValue,
      proposedValue: c.proposedValue,
      reason: c.reason,
    })).filter(c => c.entityId); // Only include changes for tasks we can match

    if (proposedChanges.length === 0) return 0;

    // Assess impact
    const hasDateChanges = proposedChanges.some(c => c.field === "startDate" || c.field === "endDate");
    const impact = {
      schedule: hasDateChanges ? 3 : 1,
      cost: 1,
      scope: 1,
      stakeholder: proposedChanges.length > 3 ? 2 : 1,
    };

    await createChangeProposal(agentId, projectId, orgId, {
      trigger: "knowledge_update",
      source: `${recentKB.length} new knowledge item(s) detected`,
      type: "SCHEDULE_CHANGE",
      title: `Schedule update: ${proposedChanges.length} task(s) based on new information`,
      reasoning: `New knowledge from ${recentKB.map(k => k.type.toLowerCase()).join(", ")} suggests ${proposedChanges.length} task(s) need updating. ${proposedChanges.map(c => `"${c.title}" ${c.field}: ${c.currentValue} → ${c.proposedValue} (${c.reason})`).join("; ")}`,
      confidence: 0.8,
      changes: proposedChanges,
      impact,
    });

    await db.agentActivity.create({
      data: {
        agentId,
        type: "document",
        summary: `Knowledge scan: proposed ${proposedChanges.length} schedule change(s)`,
      },
    }).catch(() => {});

    return proposedChanges.length;
  } catch (e) {
    console.error("[change-proposals] scanKnowledgeForChanges failed:", e);
    return 0;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildApprovalDescription(proposal: ChangeProposal): string {
  const lines = [
    `**Trigger:** ${proposal.trigger.replace(/_/g, " ")} — ${proposal.source}`,
    `**Confidence:** ${Math.round(proposal.confidence * 100)}%`,
    "",
    "**Proposed Changes:**",
    "",
    ...proposal.changes.map(c =>
      `- **${c.title}** → ${c.field}: \`${c.currentValue}\` → \`${c.proposedValue}\`\n  _${c.reason}_`
    ),
    "",
    `**Impact:** Schedule: ${proposal.impact.schedule}/4, Cost: ${proposal.impact.cost}/4, Scope: ${proposal.impact.scope}/4, Stakeholder: ${proposal.impact.stakeholder}/4`,
  ];
  return lines.join("\n");
}
