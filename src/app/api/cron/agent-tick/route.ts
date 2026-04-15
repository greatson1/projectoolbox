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

    // 0b. Generate daily digest (once per day per org)
    try {
      const { generateDailyDigest } = await import("@/lib/agents/daily-digest");
      await generateDailyDigest();
    } catch {}

    // 0b2. Fire any due report schedules (fire-and-forget, runs hourly effective)
    try {
      const dueSchedules = await db.reportSchedule.findMany({
        where: { isActive: true, nextRunAt: { lte: new Date() }, projectId: { not: null } },
        take: 5, // cap per tick to avoid overrunning timeout
      });
      if (dueSchedules.length > 0) {
        const { calcNextRun } = await import("@/app/api/reports/schedule/route");
        const { gatherProjectData, generateReportContent } = await import("@/lib/agents/report-generator");
        for (const sched of dueSchedules) {
          try {
            const projectData = await gatherProjectData(sched.projectId!);
            const content = await generateReportContent(sched.templateId.toUpperCase(), [], projectData);
            const templateNames: Record<string, string> = { status: "Status Report", executive: "Executive Summary", risk: "Risk Report", evm: "EVM Report", sprint: "Sprint Review", stakeholder: "Stakeholder Update", budget: "Budget Report", phase_gate: "Phase Gate Report" };
            const typeMap: Record<string, any> = { status: "STATUS", executive: "EXECUTIVE", risk: "RISK", evm: "EVM", sprint: "SPRINT", stakeholder: "STAKEHOLDER", budget: "BUDGET", phase_gate: "PHASE_GATE" };
            await db.report.create({ data: { orgId: sched.orgId, projectId: sched.projectId!, title: `${templateNames[sched.templateId] || sched.name} — ${new Date().toLocaleDateString("en-GB")}`, type: typeMap[sched.templateId] || "STATUS", status: "PUBLISHED", format: "HTML", content, templateId: sched.templateId, creditsUsed: 10, publishedAt: new Date(), recipients: sched.recipients } });
            const cronParts = sched.cronExpression.split(" ");
            const nextRunAt = calcNextRun(sched.frequency, parseInt(cronParts[4]) || 1, parseInt(cronParts[2]) || 1, parseInt(cronParts[1]) || 9);
            await db.reportSchedule.update({ where: { id: sched.id }, data: { lastRunAt: new Date(), nextRunAt } });
          } catch (e) { console.error(`[cron] Report schedule ${sched.id} failed:`, e); }
        }
      }
    } catch (e) { console.error("[cron] Report schedule runner failed:", e); }

    // 0c. Self-heal: if any active deployment has a currentPhase but zero artefacts,
    //     generate them now — UNLESS the deployment is still in the onboarding flow
    //     (researching / awaiting_clarification). Those statuses mean the user hasn't
    //     completed Research → Review → Clarification yet.
    try {
      const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
      const uninitialised = await db.agentDeployment.findMany({
        where: {
          isActive: true,
          currentPhase: { not: null },
          phaseStatus: { notIn: ["researching", "awaiting_clarification"] },
          agent: { status: "ACTIVE" },
        },
        select: { id: true, agentId: true, projectId: true, currentPhase: true },
      });
      for (const dep of uninitialised) {
        if (!dep.projectId) continue;
        const artCount = await db.agentArtefact.count({
          where: { projectId: dep.projectId, agentId: dep.agentId },
        });
        if (artCount === 0) {
          generatePhaseArtefacts(dep.agentId, dep.projectId, dep.currentPhase ?? undefined)
            .catch(e => console.error(`[self-heal] artefact generation failed for ${dep.agentId}:`, e));
        }
      }
    } catch (e) {
      console.error("Self-heal artefact check failed:", e);
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
    // 3b. Always process any pending lifecycle_init jobs on Vercel (full implementation).
    //     The VPS stub marks them COMPLETED without generating artefacts — so we re-run
    //     generatePhaseArtefacts here if those jobs produced no artefacts.
    try {
      const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
      const pendingInits = await db.agentJob.findMany({
        where: { type: "lifecycle_init", status: "PENDING" },
        select: { id: true, agentId: true, deploymentId: true, payload: true },
        take: 5,
      });
      for (const job of pendingInits) {
        const payload = job.payload as any;
        const projectId = payload?.projectId;
        if (!projectId) continue;
        await db.agentJob.update({ where: { id: job.id }, data: { status: "CLAIMED", startedAt: new Date() } });
        try {
          const { runLifecycleInit } = await import("@/lib/agents/lifecycle-init");
          await runLifecycleInit(job.agentId, job.deploymentId!);
          await db.agentJob.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date(), result: { processedAt: new Date().toISOString(), source: "vercel-inline" } as any } });
        } catch (e: any) {
          await db.agentJob.update({ where: { id: job.id }, data: { status: "FAILED", error: e.message, completedAt: new Date() } });
        }
      }
    } catch (e) {
      console.error("Inline lifecycle_init processing failed:", e);
    }

    let inlineProcessed = 0;
    if (!nudge.ok) {
      try {
        const { AgentLLM } = await import("@/lib/agents/llm");
        const { processActionProposal } = await import("@/lib/agents/action-executor");

        for (const dep of dueDeployments) {
          try {
            const orgId = dep.agent.org?.id || dep.agent.orgId;

            // 4a. Run monitoring loop (methodology playbook + interventions)
            try {
              const { runMonitoringLoop } = await import("@/lib/agents/monitoring-loop");
              const monitoring = await runMonitoringLoop(dep.agentId, dep.id, dep.projectId);
              for (const proposal of monitoring.proposals) {
                await processActionProposal(proposal, {
                  agentId: dep.agentId, deploymentId: dep.id,
                  projectId: dep.projectId, orgId, autonomyLevel: dep.agent.autonomyLevel,
                });
              }
            } catch (e) {
              console.error(`Monitoring loop failed for agent ${dep.agentId}:`, e);
            }

            // 4b. Run LLM autonomous cycle (open-ended analysis)
            const proposals = await AgentLLM.autonomousCycle(dep.agentId);
            for (const proposal of proposals) {
              await processActionProposal(proposal, {
                agentId: dep.agentId, deploymentId: dep.id,
                projectId: dep.projectId, orgId, autonomyLevel: dep.agent.autonomyLevel,
              });
            }

            // 4c. Run proactive alerts
            try {
              const { runProactiveAlerts } = await import("@/lib/agents/proactive-alerts");
              await runProactiveAlerts(dep.agentId, dep.projectId, orgId, dep.agent.autonomyLevel);
            } catch (e) {
              console.error(`Proactive alerts failed for agent ${dep.agentId}:`, e);
            }

            // 4c2. Scan knowledge for schedule change proposals
            try {
              const { scanKnowledgeForChanges } = await import("@/lib/agents/change-proposals");
              await scanKnowledgeForChanges(dep.agentId, dep.projectId, orgId);
            } catch (e) {
              console.error(`Knowledge scan failed for agent ${dep.agentId}:`, e);
            }

            // 4c3. Process timed-out proactive questions (auto-proceed with defaults)
            try {
              const { processTimedOutQuestions } = await import("@/lib/agents/proactive-outreach");
              await processTimedOutQuestions(dep.agentId);
            } catch {}

            // 4d. Run calibration loop (weekly — checks if enough decisions have accumulated)
            try {
              const { runCalibrationLoop } = await import("@/lib/agents/learning-loop");
              const decisions = await db.agentDecision.count({ where: { agentId: dep.agentId } });
              // Only calibrate if 10+ decisions and it's been >7 days since last calibration
              if (decisions >= 10) {
                const lastCal = await db.knowledgeBaseItem.findFirst({
                  where: { agentId: dep.agentId, tags: { has: "calibration" } },
                  orderBy: { createdAt: "desc" },
                  select: { createdAt: true },
                });
                const daysSinceCal = lastCal ? (Date.now() - lastCal.createdAt.getTime()) / (1000 * 60 * 60 * 24) : 999;
                if (daysSinceCal >= 7) {
                  await runCalibrationLoop(dep.agentId);
                }
              }
            } catch (e) {
              console.error(`Calibration loop failed for agent ${dep.agentId}:`, e);
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
