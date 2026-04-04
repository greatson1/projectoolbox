import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { CreditService } from "@/lib/credits/service";
import { EmailService } from "@/lib/email";
import { createJob } from "@/lib/agents/job-queue";
import { nudgeJobProcessor } from "@/lib/agents/agent-backend";

// POST /api/agents/[id]/deploy — Deploy agent to project
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;
  const body = await req.json();
  const { projectId, config, hitlPhaseGates, hitlBudgetChanges, hitlCommunications, escalationTimeout, autonomyConfig } = body;

  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  // Enforce subscription tier autonomy limit
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { autonomyLevel: true } });
  const org = await db.organisation.findUnique({ where: { id: orgId }, select: { plan: true } });
  if (agent && org) {
    const { enforceAutonomyLimit } = await import("@/lib/agents/decision-classifier");
    const effectiveLevel = enforceAutonomyLimit(agent.autonomyLevel, org.plan);
    if (effectiveLevel < agent.autonomyLevel) {
      await db.agent.update({ where: { id: agentId }, data: { autonomyLevel: effectiveLevel } });
    }
  }

  // Check credits
  const hasCredits = await CreditService.checkBalance(orgId, 10);
  if (!hasCredits) {
    return NextResponse.json({ error: "Insufficient credits. 10 credits required for deployment." }, { status: 402 });
  }

  // Create deployment with HITL governance config
  const deployment = await db.agentDeployment.create({
    data: {
      agentId, projectId, config, isActive: true,
      hitlPhaseGates: hitlPhaseGates ?? true,
      hitlBudgetChanges: hitlBudgetChanges ?? true,
      hitlCommunications: hitlCommunications ?? false,
      escalationTimeout: escalationTimeout ?? 24,
      autonomyConfig: autonomyConfig ?? null,
    },
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

  // Send deployment email
  if (session.user.email) {
    const agent = await db.agent.findUnique({ where: { id: agentId } });
    const project = await db.project.findUnique({ where: { id: projectId } });
    EmailService.sendDeployConfirmation(session.user.email, {
      agentName: agent?.name || "Agent",
      projectName: project?.name || "Project",
      autonomyLevel: agent?.autonomyLevel || 3,
      dashboardUrl: `${process.env.NEXTAUTH_URL}/agents/${agentId}`,
    }).catch(() => {}); // Fire and forget
  }

  // Create lifecycle_init job for the VPS agent backend
  await createJob({
    agentId,
    deploymentId: deployment.id,
    type: "lifecycle_init",
    priority: 1,
    payload: { projectId, methodology: (await db.project.findUnique({ where: { id: projectId } }))?.methodology },
  });

  // Set initial next cycle time
  await db.agentDeployment.update({
    where: { id: deployment.id },
    data: { nextCycleAt: new Date(Date.now() + 10 * 60_000) },
  });

  // Nudge VPS to start processing immediately
  nudgeJobProcessor().catch(() => {});

  return NextResponse.json({ data: { deployment, agentId } }, { status: 201 });
}
