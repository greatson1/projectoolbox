import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[id]/chat/action — Execute an action proposed in chat
 * Handles inline approve/reject from the chat interface.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;
  const body = await req.json();
  const { action, proposal, messageId } = body; // action: "approve" | "reject" | "modify"

  if (!action || !proposal) {
    return NextResponse.json({ error: "action and proposal required" }, { status: 400 });
  }

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: { deployments: { where: { isActive: true }, take: 1 } },
  });

  if (!agent || agent.orgId !== orgId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const deployment = agent.deployments[0];
  if (!deployment) {
    return NextResponse.json({ error: "Agent not deployed" }, { status: 400 });
  }

  if (action === "approve") {
    // Execute the action through the standard pipeline
    const { processActionProposal } = await import("@/lib/agents/action-executor");
    const result = await processActionProposal(
      {
        ...proposal,
        // Force low impact scores since user is manually approving
        scheduleImpact: proposal.scheduleImpact || 1,
        costImpact: proposal.costImpact || 1,
        scopeImpact: proposal.scopeImpact || 1,
        stakeholderImpact: proposal.stakeholderImpact || 1,
        confidence: 1.0, // User approved = full confidence
      },
      {
        agentId,
        deploymentId: deployment.id,
        projectId: deployment.projectId,
        orgId,
        autonomyLevel: 4, // User approval overrides autonomy — treat as max level
      },
    );

    // Log in chat
    await db.chatMessage.create({
      data: {
        agentId, role: "agent",
        content: result.success
          ? `Done. I've executed: "${proposal.description}". ${result.creditsUsed ? `(${result.creditsUsed} credits used)` : ""}`
          : `I wasn't able to execute that action: ${result.error || "unknown error"}`,
        metadata: { actionResult: result.action, success: result.success },
      },
    });

    return NextResponse.json({ data: { success: result.success, action: result.action } });
  }

  if (action === "reject") {
    // Log rejection
    await db.agentDecision.create({
      data: {
        agentId,
        type: proposal.type || "TASK_ASSIGNMENT",
        description: proposal.description || "Chat action rejected",
        reasoning: "User rejected via chat",
        confidence: 0,
        status: "REJECTED",
      },
    });

    await db.chatMessage.create({
      data: {
        agentId, role: "agent",
        content: `Understood. I won't proceed with "${proposal.description}". Is there an alternative approach you'd prefer?`,
      },
    });

    return NextResponse.json({ data: { success: true, action: "rejected" } });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
