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

  // Idempotency: if this agent is already actively deployed to this project,
  // return the existing deployment instead of stacking a duplicate.
  // Belt-and-braces against double-fires that slipped past upstream guards.
  // (AgentDeployment uses `deployedAt`, not `createdAt` — a previous
  // refactor left this query referring to a field that doesn't exist on
  // the model, which 5xx'd every deploy at the very first DB call.)
  const existingDeployment = await db.agentDeployment.findFirst({
    where: { agentId, projectId, isActive: true },
    orderBy: { deployedAt: "desc" },
  });
  if (existingDeployment) {
    return NextResponse.json(
      { data: { deployment: existingDeployment, agentId }, idempotent: true },
      { status: 200 },
    );
  }

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

  // ── Persist deploy-form data to canonical tables ─────────────────────────
  // The wizard collects budget, sponsor/PM/stakeholders, and team members. Up
  // until now those values were only kept inside deployment.config JSON, so
  // pages reading from db.stakeholder / db.projectMember / project.budget
  // showed empty even though the user had filled the form. This block lifts
  // that data into the dedicated tables on first deployment so every page
  // (Stakeholders, Cost, Resources, PM Tracker prereqs) has it from t=0.
  try {
    const cfg = (config as any) || {};

    // Project-level fields — only set when project doesn't already have them
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { budget: true, startDate: true, endDate: true, description: true },
    });
    if (project) {
      const projectUpdate: Record<string, unknown> = {};
      const formBudget = typeof cfg.budget === "number" ? cfg.budget : parseFloat(cfg.budget || "");
      if (!project.budget && Number.isFinite(formBudget) && formBudget > 0) {
        projectUpdate.budget = formBudget;
      }
      if (!project.startDate && cfg.startDate) {
        const d = new Date(cfg.startDate);
        if (!isNaN(d.getTime())) projectUpdate.startDate = d;
      }
      if (!project.endDate && cfg.endDate) {
        const d = new Date(cfg.endDate);
        if (!isNaN(d.getTime())) projectUpdate.endDate = d;
      }
      if (!project.description && typeof cfg.description === "string" && cfg.description.trim()) {
        projectUpdate.description = cfg.description.trim();
      }
      if (Object.keys(projectUpdate).length > 0) {
        await db.project.update({ where: { id: projectId }, data: projectUpdate });
      }
    }

    // Stakeholders — { name, role, org, power, interest } from the wizard
    if (Array.isArray(cfg.stakeholders)) {
      for (const s of cfg.stakeholders) {
        const name = typeof s?.name === "string" ? s.name.trim() : "";
        if (!name) continue;
        // Upsert by (projectId, name) — re-deploys shouldn't duplicate.
        const existing = await db.stakeholder.findFirst({
          where: { projectId, name },
          select: { id: true },
        });
        if (existing) {
          await db.stakeholder.update({
            where: { id: existing.id },
            data: {
              role: s.role || undefined,
              organisation: s.org || undefined,
              power: typeof s.power === "number" ? s.power : undefined,
              interest: typeof s.interest === "number" ? s.interest : undefined,
            },
          });
        } else {
          await db.stakeholder.create({
            data: {
              projectId,
              name,
              role: s.role || null,
              organisation: s.org || null,
              power: typeof s.power === "number" ? s.power : 50,
              interest: typeof s.interest === "number" ? s.interest : 50,
            },
          });
        }
      }
    }

    // Sponsor + project manager — captured separately on the wizard. Promote
    // to Stakeholder rows with a clear role tag so the People page surfaces
    // them and downstream prereq checks (e.g. "Sponsor identified and
    // confirmed") evaluate as met.
    const promoteSingle = async (raw: unknown, role: string) => {
      const name = typeof raw === "string" ? raw.trim() : "";
      if (!name) return;
      const existing = await db.stakeholder.findFirst({
        where: { projectId, name },
        select: { id: true, role: true },
      });
      if (existing) {
        if (!existing.role) {
          await db.stakeholder.update({ where: { id: existing.id }, data: { role } });
        }
      } else {
        await db.stakeholder.create({
          data: { projectId, name, role, power: 80, interest: 80 },
        });
      }
    };
    await promoteSingle(cfg.sponsor, "Project Sponsor");
    await promoteSingle(cfg.projectManager || cfg.pm, "Project Manager");
    // Client / commissioning organisation — wizard Step 1 "Client" field
    await promoteSingle(cfg.client, "Client Organisation");

    // Team members — wizard's team array → ProjectMember rows. Each entry
    // typically has { userId | name, role, hourlyRate }. We only persist
    // entries with a userId (the team page uses the User join); name-only
    // entries fall through to free-text display elsewhere.
    if (Array.isArray(cfg.team)) {
      for (const m of cfg.team) {
        const userId = typeof m?.userId === "string" ? m.userId : null;
        if (!userId) continue;
        const exists = await db.projectMember.findFirst({
          where: { projectId, userId },
          select: { id: true },
        });
        if (!exists) {
          await db.projectMember.create({
            data: {
              projectId,
              userId,
              role: m.role || "MEMBER",
              hourlyRate: typeof m.hourlyRate === "number" ? m.hourlyRate : null,
              skills: Array.isArray(m.skills) ? m.skills : [],
            },
          });
        }
      }
    }
  } catch (e) {
    // Persistence failures here must NOT block deployment — the agent can
    // still operate, the user can fix any missing rows from the UI later.
    console.error("[deploy] persist deploy-form data failed:", e);
  }

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
