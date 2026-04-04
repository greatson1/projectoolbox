/**
 * Agent Tick — Vercel Cron job that runs every minute.
 * Finds active agent deployments due for a cycle, creates jobs, and nudges the VPS.
 *
 * Cron schedule: * * * * * (every minute)
 * Protected by CRON_SECRET header (set by Vercel automatically).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createJob, getDueDeployments } from "@/lib/agents/job-queue";
import { nudgeJobProcessor } from "@/lib/agents/agent-backend";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // seconds

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 0. Check approval timeouts (runs every tick regardless of deployments)
    let escalationResult = { reminders: 0, escalations: 0, overdue: 0 };
    try {
      const { checkApprovalTimeouts } = await import("@/lib/agents/approval-escalation");
      escalationResult = await checkApprovalTimeouts();
    } catch (e) {
      console.error("Approval escalation check failed:", e);
    }

    // 1. Find all active deployments due for a cycle
    const dueDeployments = await getDueDeployments();

    if (dueDeployments.length === 0) {
      return NextResponse.json({ ok: true, jobs: 0, message: "No deployments due", escalation: escalationResult });
    }

    // 2. Create jobs for each due deployment
    let jobsCreated = 0;
    for (const deployment of dueDeployments) {
      const job = await createJob({
        agentId: deployment.agentId,
        deploymentId: deployment.id,
        type: "autonomous_cycle",
        priority: 5,
        payload: {
          projectId: deployment.projectId,
          projectName: deployment.project.name,
          methodology: deployment.project.methodology,
          autonomyLevel: deployment.agent.autonomyLevel,
          currentPhase: deployment.currentPhase,
          phaseStatus: deployment.phaseStatus,
        },
      });

      if (job.status === "PENDING") jobsCreated++;

      // Update next cycle time
      const intervalMs = (deployment.cycleInterval || 10) * 60_000;
      await db.agentDeployment.update({
        where: { id: deployment.id },
        data: { nextCycleAt: new Date(Date.now() + intervalMs) },
      });
    }

    // 3. Try VPS first, fall back to inline processing
    const nudge = await nudgeJobProcessor();

    // 4. If VPS unavailable, run autonomous cycles inline (serverless)
    let inlineProcessed = 0;
    if (!nudge.ok) {
      try {
        const { AgentLLM } = await import("@/lib/agents/llm");
        const { processActionProposal } = await import("@/lib/agents/action-executor");

        for (const dep of dueDeployments) {
          try {
            const proposals = await AgentLLM.autonomousCycle(dep.agentId);
            for (const proposal of proposals) {
              await processActionProposal(proposal, {
                agentId: dep.agentId,
                deploymentId: dep.id,
                projectId: dep.projectId,
                orgId: dep.agent.org?.id || dep.agent.orgId,
                autonomyLevel: dep.agent.autonomyLevel,
              });
            }
            // Run proactive alerts alongside autonomous actions
            try {
              const { runProactiveAlerts } = await import("@/lib/agents/proactive-alerts");
              await runProactiveAlerts(dep.agentId, dep.projectId, dep.agent.org?.id || dep.agent.orgId, dep.agent.autonomyLevel);
            } catch (e) {
              console.error(`Proactive alerts failed for agent ${dep.agentId}:`, e);
            }

            inlineProcessed++;

            // Update last cycle time
            await db.agentDeployment.update({
              where: { id: dep.id },
              data: { lastCycleAt: new Date() },
            });
          } catch (e) {
            console.error(`Inline cycle failed for agent ${dep.agentId}:`, e);
          }
        }
      } catch (e) {
        console.error("Inline processing failed:", e);
      }
    }

    return NextResponse.json({
      ok: true,
      deploymentsDue: dueDeployments.length,
      jobsCreated,
      vpsNudge: nudge.ok ? "sent" : nudge.error,
      inlineProcessed,
    });
  } catch (err: any) {
    console.error("agent-tick cron error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
