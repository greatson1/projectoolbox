import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CreditService } from "@/lib/credits/service";
import { EmailService } from "@/lib/email";
import { createJob } from "@/lib/agents/job-queue";
import { nudgeJobProcessor } from "@/lib/agents/agent-backend";
import { resolveApiCaller } from "@/lib/api-auth";

// POST /api/agents/[id]/deploy — Deploy agent to project
// Accepts: browser session cookie OR Authorization: Bearer ptx_live_<key>
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = caller.orgId;
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

  // Auto-generate agent email address namespaced by org slug
  const existingEmail = await db.agentEmail.findUnique({ where: { agentId } });
  if (!existingEmail) {
    const agentRecord = await db.agent.findUnique({ where: { id: agentId }, select: { name: true, orgId: true } });
    const orgRecord = await db.organisation.findUnique({ where: { id: agentRecord?.orgId || orgId }, select: { slug: true } });
    const agentSlug = (agentRecord?.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const orgSlug = (orgRecord?.slug || "org").replace(/[^a-z0-9-]/g, "").slice(0, 15);
    // Format: agentname.orgslug@agents.projectoolbox.com — globally unique per org
    const address = `${agentSlug}.${orgSlug}@agents.projectoolbox.com`;
    const collision = await db.agentEmail.findUnique({ where: { address } });
    await db.agentEmail.create({
      data: { agentId, address: collision ? `${agentSlug}.${orgSlug}-${agentId.slice(-4)}@agents.projectoolbox.com` : address, isActive: true },
    });
  }

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

  // Always queue a lifecycle_init job first — this is the guaranteed path.
  // Even if inline init succeeds, the job will be a no-op (generatePhaseArtefacts is idempotent).
  await createJob({
    agentId,
    deploymentId: deployment.id,
    type: "lifecycle_init",
    priority: 1,
    payload: { projectId, methodology: (await db.project.findUnique({ where: { id: projectId } }))?.methodology },
  });
  nudgeJobProcessor().catch(() => {});

  return NextResponse.json({ data: { deployment, agentId } }, { status: 201 });
}
