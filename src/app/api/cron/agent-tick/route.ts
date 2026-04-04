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
    // 1. Find all active deployments due for a cycle
    const dueDeployments = await getDueDeployments();

    if (dueDeployments.length === 0) {
      return NextResponse.json({ ok: true, jobs: 0, message: "No deployments due" });
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

    // 3. Nudge VPS to process jobs (fire-and-forget)
    const nudge = await nudgeJobProcessor();

    return NextResponse.json({
      ok: true,
      deploymentsDue: dueDeployments.length,
      jobsCreated,
      vpsNudge: nudge.ok ? "sent" : nudge.error,
    });
  } catch (err: any) {
    console.error("agent-tick cron error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
