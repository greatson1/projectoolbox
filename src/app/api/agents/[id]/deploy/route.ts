import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CreditService } from "@/lib/credits/service";
import { EmailService } from "@/lib/email";
import { createJob } from "@/lib/agents/job-queue";
import { nudgeJobProcessor } from "@/lib/agents/agent-backend";
import { resolveApiCaller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

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
  if (caller.userId) {
    await db.notification.create({
      data: {
        userId: caller.userId,
        type: "AGENT_ALERT",
        title: "Agent deployed",
        body: `Your agent has been deployed and is now active.`,
        actionUrl: `/agents/${agentId}`,
      },
    });
  }

  // Send deployment email
  if (caller.userId) {
    const callerUser = await db.user.findUnique({ where: { id: caller.userId }, select: { email: true } });
    if (callerUser?.email) {
      const agent = await db.agent.findUnique({ where: { id: agentId } });
      const project = await db.project.findUnique({ where: { id: projectId } });
      EmailService.sendDeployConfirmation(callerUser.email, {
        agentName: agent?.name || "Agent",
        projectName: project?.name || "Project",
        autonomyLevel: agent?.autonomyLevel || 2,
        dashboardUrl: `${process.env.NEXTAUTH_URL}/agents/${agentId}`,
      }).catch(() => {}); // Fire and forget
    }
  }

  // Create ReportSchedule from deploy config
  try {
    const reportFreq = (config as any)?.reportSchedule || "weekly";
    const cronMap: Record<string, string> = {
      daily: "0 8 * * 1-5",     // 8am weekdays
      weekly: "0 9 * * 1",      // 9am Monday
      biweekly: "0 9 * * 1/2",  // every other Monday
      monthly: "0 9 1 * *",     // 1st of month
    };
    const callerUser = caller.userId ? await db.user.findUnique({ where: { id: caller.userId }, select: { email: true } }) : null;
    const agentRecord = await db.agent.findUnique({ where: { id: agentId }, select: { name: true } });
    await db.reportSchedule.create({
      data: {
        name: `${agentRecord?.name || "Agent"} — Status Report`,
        templateId: "status_report",
        projectId,
        orgId: caller.orgId,
        frequency: reportFreq.toUpperCase(),
        cronExpression: cronMap[reportFreq] || cronMap.weekly,
        nextRunAt: new Date(Date.now() + 7 * 86_400_000), // first run in ~1 week
        recipients: callerUser?.email ? [callerUser.email] : [],
        isActive: true,
      },
    });
  } catch (e) {
    console.error("[deploy] ReportSchedule creation failed:", e);
  }

  // Run lifecycle init directly inline — do not rely on VPS stub.
  // Fire-and-forget so the deploy response is instant. The function is idempotent.
  (async () => {
    try {
      const { runLifecycleInit } = await import("@/lib/agents/lifecycle-init");
      await runLifecycleInit(agentId, deployment.id);
    } catch (e) {
      console.error(`[deploy] inline lifecycle_init failed for ${agentId}:`, e);
      // Fallback: queue a job so the cron picks it up
      try {
        await createJob({
          agentId,
          deploymentId: deployment.id,
          type: "lifecycle_init",
          priority: 1,
          payload: { projectId },
        });
        nudgeJobProcessor().catch(() => {});
      } catch {}
    }
  })();

  return NextResponse.json({ data: { deployment, agentId } }, { status: 201 });
}
