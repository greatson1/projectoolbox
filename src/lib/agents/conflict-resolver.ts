/**
 * Multi-Agent Conflict Resolution
 *
 * Before executing a RESOURCE_ALLOCATION or TASK_ASSIGNMENT action,
 * checks if another agent has a pending/recent action on the same resource.
 * Per spec Section 8.4.
 */

import { db } from "@/lib/db";
import type { ActionProposal } from "./decision-classifier";

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingAgent?: { id: string; name: string; projectName: string };
  conflictingAction?: string;
  resolution?: string;
}

export async function checkConflicts(
  proposal: ActionProposal,
  agentId: string,
  projectId: string,
): Promise<ConflictCheckResult> {
  // Only check for resource/task conflicts
  if (!["TASK_ASSIGNMENT", "RESOURCE_ALLOCATION", "SCHEDULE_CHANGE"].includes(proposal.type)) {
    return { hasConflict: false };
  }

  const affectedIds = (proposal.affectedItems || [])
    .filter(i => i.type === "task")
    .map(i => i.id);

  if (affectedIds.length === 0) return { hasConflict: false };

  // Check if any other agent has a PENDING decision affecting the same items
  const recentWindow = new Date(Date.now() - 60 * 60 * 1000); // last hour

  const conflictingDecisions = await db.agentDecision.findMany({
    where: {
      agentId: { not: agentId },
      status: { in: ["PENDING", "AUTO_APPROVED"] },
      createdAt: { gte: recentWindow },
    },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          deployments: {
            where: { isActive: true },
            include: { project: { select: { name: true } } },
            take: 1,
          },
        },
      },
      approval: { select: { affectedItems: true } },
    },
  });

  for (const decision of conflictingDecisions) {
    // Check if the approval's affected items overlap with ours
    const theirItems = (decision.approval?.affectedItems as any[] || [])
      .filter((i: any) => i.type === "task")
      .map((i: any) => i.id);

    const overlap = affectedIds.filter(id => theirItems.includes(id));

    if (overlap.length > 0) {
      const otherAgent = decision.agent;
      const otherProject = otherAgent.deployments[0]?.project?.name || "Unknown project";

      return {
        hasConflict: true,
        conflictingAgent: { id: otherAgent.id, name: otherAgent.name, projectName: otherProject },
        conflictingAction: decision.description,
        resolution: `Agent ${otherAgent.name} (${otherProject}) has a ${decision.status === "PENDING" ? "pending" : "recent"} action on the same resource. Escalating to human for resolution.`,
      };
    }
  }

  return { hasConflict: false };
}
