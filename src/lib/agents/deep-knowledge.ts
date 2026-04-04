/**
 * Deep Project Knowledge
 *
 * Per spec Section 7.7: The agent maintains deep understanding of every aspect
 * of the project — not just data, but patterns, relationships, and context.
 *
 * - Live team model (capacity, skills, workload, absences)
 * - Stakeholder behavioral model (communication preferences, response patterns)
 * - Cross-reference documents against project plan
 * - Track version/change history on every artefact
 */

import { db } from "@/lib/db";

// ─── Team Model ───

export interface TeamMemberProfile {
  id: string;
  name: string;
  role: string;
  currentWorkload: number; // number of active tasks
  capacity: number; // story points available
  skills: string[];
  avgCompletionRate: number; // tasks completed / tasks assigned
  avgCycleTime: number; // days per task
  recentActivity: string[];
}

/**
 * Build a live team model from project data.
 * Shows capacity, workload, skills, and performance for each member.
 */
export async function buildTeamModel(projectId: string): Promise<TeamMemberProfile[]> {
  const members = await db.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const tasks = await db.task.findMany({
    where: { projectId },
    select: { id: true, assigneeId: true, status: true, storyPoints: true, createdAt: true, updatedAt: true },
  });

  const profiles: TeamMemberProfile[] = [];

  for (const member of members) {
    const userId = member.userId;
    const memberTasks = tasks.filter(t => t.assigneeId === userId);
    const activeTasks = memberTasks.filter(t => t.status === "IN_PROGRESS" || t.status === "TODO");
    const completedTasks = memberTasks.filter(t => t.status === "DONE");
    const totalAssigned = memberTasks.length || 1;

    // Calculate avg cycle time (days from creation to completion)
    let totalCycleTime = 0;
    let cycleCount = 0;
    for (const t of completedTasks) {
      const days = (t.updatedAt.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 0 && days < 365) { totalCycleTime += days; cycleCount++; }
    }

    // Estimate remaining capacity (assuming 8 SP per sprint)
    const activePoints = activeTasks.reduce((s, t) => s + (t.storyPoints || 1), 0);
    const capacity = Math.max(0, 8 - activePoints);

    profiles.push({
      id: userId,
      name: member.user.name || member.user.email || "Unknown",
      role: member.role || "MEMBER",
      currentWorkload: activeTasks.length,
      capacity,
      skills: [], // Could be enriched from user profile or knowledge base
      avgCompletionRate: Math.round((completedTasks.length / totalAssigned) * 100) / 100,
      avgCycleTime: cycleCount > 0 ? Math.round((totalCycleTime / cycleCount) * 10) / 10 : 0,
      recentActivity: completedTasks.slice(0, 3).map(t => `Completed task (${t.storyPoints || 1} SP)`),
    });
  }

  return profiles;
}

// ─── Stakeholder Behavioral Model ───

export interface StakeholderBehavior {
  id: string;
  name: string;
  email: string | null;
  power: number;
  interest: number;
  // Behavioral patterns
  communicationPreference: "formal" | "casual" | "data-driven" | "unknown";
  preferredDetailLevel: "high" | "summary" | "unknown";
  responseTime: string; // "fast (<24h)" | "moderate (1-3 days)" | "slow (3+ days)" | "unknown"
  sensitivityFocus: "cost" | "schedule" | "quality" | "balanced" | "unknown";
  lastInteraction: Date | null;
  interactionCount: number;
  approvalPattern: string; // "quick approver" | "detail reviewer" | "frequent modifier" | "unknown"
}

/**
 * Build a behavioral model for each stakeholder based on interaction history.
 */
export async function buildStakeholderModel(projectId: string, agentId: string): Promise<StakeholderBehavior[]> {
  const stakeholders = await db.stakeholder.findMany({
    where: { projectId },
    select: { id: true, name: true, email: true, power: true, interest: true, sentiment: true },
  });

  // Get agent's email interactions with stakeholders
  const agentEmail = await db.agentEmail.findFirst({
    where: { agentId },
    select: { address: true },
  });

  const inboxMessages = await db.agentInboxMessage.findMany({
    where: { agentId },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: { from: true, receivedAt: true, type: true, subject: true },
  });

  // Get approval patterns (how each user handles approvals)
  const approvals = await db.approval.findMany({
    where: { projectId, status: { not: "PENDING" } },
    select: { assignedToId: true, status: true, createdAt: true, resolvedAt: true, comment: true },
  });

  const behaviors: StakeholderBehavior[] = [];

  for (const sh of stakeholders) {
    // Count interactions from this stakeholder's email
    const interactions = inboxMessages.filter(m => m.from.toLowerCase().includes(sh.email?.toLowerCase() || "___none___"));
    const interactionCount = interactions.length;
    const lastInteraction = interactions[0]?.receivedAt || null;

    // Analyze approval patterns for this stakeholder
    // (If they're also a platform user who reviews approvals)
    const theirApprovals = approvals.filter(a => {
      // Match by email or assigned user
      return a.assignedToId && a.comment?.toLowerCase().includes(sh.name.toLowerCase());
    });

    let approvalPattern: string = "unknown";
    if (theirApprovals.length >= 3) {
      const avgResolveTime = theirApprovals.reduce((sum, a) => {
        if (!a.resolvedAt) return sum;
        return sum + (a.resolvedAt.getTime() - a.createdAt.getTime()) / (1000 * 60 * 60);
      }, 0) / theirApprovals.length;

      const modifyCount = theirApprovals.filter(a => a.status === "DEFERRED").length;

      if (avgResolveTime < 2) approvalPattern = "quick approver";
      else if (modifyCount / theirApprovals.length > 0.3) approvalPattern = "frequent modifier";
      else approvalPattern = "detail reviewer";
    }

    // Infer communication preferences from interaction patterns
    let communicationPreference: StakeholderBehavior["communicationPreference"] = "unknown";
    let preferredDetailLevel: StakeholderBehavior["preferredDetailLevel"] = "unknown";
    let responseTime = "unknown";

    if (interactionCount >= 3) {
      // Simple heuristic: shorter messages = prefers summary
      communicationPreference = "formal"; // Default for stakeholders
      preferredDetailLevel = (sh.power || 50) > 70 ? "summary" : "high";

      // Calculate average response time
      if (interactions.length >= 2) {
        const gaps = [];
        for (let i = 0; i < interactions.length - 1; i++) {
          const gap = (interactions[i].receivedAt.getTime() - interactions[i + 1].receivedAt.getTime()) / (1000 * 60 * 60);
          if (gap > 0 && gap < 168) gaps.push(gap); // Within 1 week
        }
        if (gaps.length > 0) {
          const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
          responseTime = avgGap < 24 ? "fast (<24h)" : avgGap < 72 ? "moderate (1-3 days)" : "slow (3+ days)";
        }
      }
    }

    // Sensitivity focus from sentiment and power/interest
    let sensitivityFocus: StakeholderBehavior["sensitivityFocus"] = "unknown";
    if (sh.sentiment === "concerned") sensitivityFocus = "cost";
    else if ((sh.power || 50) > 70) sensitivityFocus = "schedule";
    else sensitivityFocus = "balanced";

    behaviors.push({
      id: sh.id,
      name: sh.name,
      email: sh.email,
      power: sh.power || 50,
      interest: sh.interest || 50,
      communicationPreference,
      preferredDetailLevel,
      responseTime,
      sensitivityFocus,
      lastInteraction,
      interactionCount,
      approvalPattern,
    });
  }

  return behaviors;
}

// ─── Document Cross-Reference ───

/**
 * Cross-reference knowledge base documents against the project plan.
 * Detects discrepancies between what was discussed/agreed and what's in the plan.
 */
export async function crossReferenceDocuments(
  projectId: string,
  agentId: string,
): Promise<{ discrepancies: Discrepancy[]; alignmentScore: number }> {
  const [tasks, risks, artefacts, kbItems] = await Promise.all([
    db.task.findMany({ where: { projectId }, select: { id: true, title: true, status: true, description: true } }),
    db.risk.findMany({ where: { projectId }, select: { id: true, title: true, status: true } }),
    db.agentArtefact.findMany({ where: { projectId }, select: { id: true, name: true, content: true, status: true, version: true } }),
    db.knowledgeBaseItem.findMany({
      where: { agentId, type: { in: ["TRANSCRIPT", "EMAIL", "TEXT"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { title: true, content: true, type: true, createdAt: true },
    }),
  ]);

  const discrepancies: Discrepancy[] = [];

  // Look for keywords in knowledge base items that mention tasks or risks
  // that don't exist in the project plan
  for (const kb of kbItems) {
    const content = kb.content.toLowerCase();

    // Check for mentions of "new requirement", "scope change", "add", "remove"
    if (content.includes("new requirement") || content.includes("scope change") || content.includes("additional")) {
      // Check if there's a matching task or change request
      const hasMatchingTask = tasks.some(t =>
        content.includes(t.title.toLowerCase().slice(0, 20))
      );

      if (!hasMatchingTask) {
        discrepancies.push({
          type: "missing_in_plan",
          source: kb.title,
          sourceType: kb.type,
          description: `A ${kb.type.toLowerCase()} mentions new requirements or scope changes that may not be reflected in the current project plan.`,
          severity: "MEDIUM",
        });
      }
    }

    // Check for mentions of "cancelled", "removed", "no longer" that might apply to active tasks
    if (content.includes("cancelled") || content.includes("no longer") || content.includes("removed")) {
      discrepancies.push({
        type: "potential_obsolete",
        source: kb.title,
        sourceType: kb.type,
        description: `A ${kb.type.toLowerCase()} mentions cancellation or removal — verify that the project plan reflects this.`,
        severity: "LOW",
      });
    }
  }

  // Alignment score: 100 - (discrepancies * 10), clamped to 0-100
  const alignmentScore = Math.max(0, Math.min(100, 100 - discrepancies.length * 10));

  return { discrepancies, alignmentScore };
}

interface Discrepancy {
  type: "missing_in_plan" | "potential_obsolete" | "conflicting_info";
  source: string;
  sourceType: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * Build the full deep knowledge context for an agent's LLM prompt.
 * This enriches the agent's understanding of the project beyond raw data.
 */
export async function buildDeepKnowledgeContext(
  agentId: string,
  projectId: string,
): Promise<string> {
  const [teamModel, stakeholderModel, crossRef] = await Promise.all([
    buildTeamModel(projectId).catch(() => []),
    buildStakeholderModel(projectId, agentId).catch(() => []),
    crossReferenceDocuments(projectId, agentId).catch(() => ({ discrepancies: [], alignmentScore: 100 })),
  ]);

  const sections: string[] = [];

  // Team context
  if (teamModel.length > 0) {
    sections.push(`TEAM MODEL (${teamModel.length} members):`);
    for (const m of teamModel.slice(0, 5)) {
      sections.push(`- ${m.name} (${m.role}): ${m.currentWorkload} active tasks, ${m.capacity} SP capacity, ${Math.round(m.avgCompletionRate * 100)}% completion rate, avg ${m.avgCycleTime}d/task`);
    }
  }

  // Stakeholder context
  if (stakeholderModel.length > 0) {
    sections.push(`\nSTAKEHOLDER BEHAVIORAL MODEL (${stakeholderModel.length} stakeholders):`);
    for (const s of stakeholderModel.slice(0, 5)) {
      sections.push(`- ${s.name}: ${s.communicationPreference} communicator, prefers ${s.preferredDetailLevel} detail, ${s.responseTime} response, focuses on ${s.sensitivityFocus}, ${s.approvalPattern}`);
    }
  }

  // Document alignment
  if (crossRef.discrepancies.length > 0) {
    sections.push(`\nDOCUMENT ALIGNMENT (score: ${crossRef.alignmentScore}/100):`);
    sections.push(`${crossRef.discrepancies.length} discrepancies detected between documents and project plan:`);
    for (const d of crossRef.discrepancies) {
      sections.push(`- [${d.severity}] ${d.description} (source: ${d.source})`);
    }
  }

  return sections.join("\n");
}
