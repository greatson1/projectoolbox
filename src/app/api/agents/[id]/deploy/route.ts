import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { CreditService } from "@/lib/credits/service";

// POST /api/agents/[id]/deploy — Deploy agent to project
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;
  const body = await req.json();
  const { projectId, config } = body;

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Check credits
  const hasCredits = await CreditService.checkBalance(orgId, 10);
  if (!hasCredits) {
    return NextResponse.json({ error: "Insufficient credits. 10 credits required for deployment." }, { status: 402 });
  }

  // Create deployment
  const deployment = await db.agentDeployment.create({
    data: { agentId, projectId, config, isActive: true },
  });

  // Activate agent
  await db.agent.update({
    where: { id: agentId },
    data: { status: "ACTIVE" },
  });

  // Deduct credits
  await CreditService.deduct(orgId, 10, `Agent deployment to project`, agentId);

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "deployment",
      summary: `Deployed to project`,
      metadata: { projectId, deploymentId: deployment.id },
    },
  });

  // Create notification
  await db.notification.create({
    data: {
      userId: session.user.id!,
      type: "AGENT_ALERT",
      title: "Agent deployed",
      body: `Your agent has been deployed and is now active.`,
      actionUrl: `/agents/${agentId}`,
    },
  });

  return NextResponse.json({ data: { deployment, agentId } }, { status: 201 });
}
