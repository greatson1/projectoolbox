/**
 * Agent Tick — Vercel Cron job that runs every minute.
 * Finds active agent deployments due for a cycle, creates jobs, and nudges the VPS.
 *
 * Cron schedule: * * * * * (every minute)
 * Protected by CRON_SECRET header (set by Vercel automatically).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createJob, getDueDeployments, getEffectiveCycleInterval } from "@/lib/agents/job-queue";
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
    // 0a. Idempotent schema top-up — ensure Organisation.currency column exists.
    //     First tick after a deploy that adds the column runs the ALTER; subsequent
    //     ticks are no-ops thanks to IF NOT EXISTS.
    try {
      await db.$executeRawUnsafe(`ALTER TABLE "Organisation" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'GBP'`);
    } catch {}

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

    // 0b1-pre. Self-heal AgentArtefact rows with empty projectId. This is the
    //       single nastiest leak: rows with projectId='' are INVISIBLE to
    //       /projects/:id/artefacts (filters by exact projectId match), so
    //       the user sees the agent saying "Cost Management Plan needs your
    //       review" while the artefacts page shows nothing. The create_artefact
    //       tool now refuses empty projectId (see chat/stream/route.ts), but
    //       this sweep catches anything historical or from other writers.
    //       Relinks to the active deployment for the same agentId.
    try {
      const healed: number = await db.$executeRawUnsafe(`
        UPDATE "AgentArtefact" a
        SET "projectId" = d."projectId", "updatedAt" = NOW()
        FROM "AgentDeployment" d
        WHERE (a."projectId" IS NULL OR a."projectId" = '')
          AND d."agentId" = a."agentId"
          AND d."isActive" = true
      `);
      if (typeof healed === "number" && healed > 0) {
        console.log(`[agent-tick] Self-healed ${healed} orphan artefact(s) by relinking projectId.`);
      }
    } catch (e) {
      console.error("[agent-tick] orphan-projectId artefact self-heal failed:", e);
    }

    // 0b1. Self-heal orphan artefacts (phaseId IS NULL).
    //      AgentArtefact rows must always have a phaseId — otherwise the
    //      phase-tracker can't count them and the visible completion %
    //      silently halves. Several create paths can leak NULL on edge
    //      cases (race against Phase row creation, webhook callers that
    //      forget to include phaseId, etc). Relinks each orphan to its
    //      project's Phase ROW ID (preferred) so the strict id-based
    //      consumers join correctly. Falls back to the deployment's
    //      currentPhase NAME if no matching Phase row exists yet — the
    //      phase-tracker accepts both forms for compatibility.
    try {
      const healed: number = await db.$executeRawUnsafe(`
        UPDATE "AgentArtefact" a
        SET "phaseId" = COALESCE(p."id", d."currentPhase"), "updatedAt" = NOW()
        FROM "AgentDeployment" d
        LEFT JOIN "Phase" p
          ON p."projectId" = d."projectId"
         AND p."name" = d."currentPhase"
        WHERE a."phaseId" IS NULL
          AND d."projectId" = a."projectId"
          AND d."isActive" = true
          AND d."currentPhase" IS NOT NULL
      `);
      if (typeof healed === "number" && healed > 0) {
        console.log(`[agent-tick] Self-healed ${healed} orphan artefact(s) by relinking phaseId.`);
      }
    } catch (e) {
      console.error("[agent-tick] orphan artefact self-heal failed:", e);
    }

    // 0b1b. Self-heal orphan tasks (phaseId IS NULL).
    //       Same pattern as artefacts — prefer Phase.id over the name, fall
    //       back to the name when the Phase row hasn't been created yet.
    //       The Gantt groups by phase; NULL tasks bunch under "Unassigned".
    try {
      const healed: number = await db.$executeRawUnsafe(`
        UPDATE "Task" t
        SET "phaseId" = COALESCE(p."id", d."currentPhase"), "updatedAt" = NOW()
        FROM "AgentDeployment" d
        LEFT JOIN "Phase" p
          ON p."projectId" = d."projectId"
         AND p."name" = d."currentPhase"
        WHERE t."phaseId" IS NULL
          AND d."projectId" = t."projectId"
          AND d."isActive" = true
          AND d."currentPhase" IS NOT NULL
      `);
      if (typeof healed === "number" && healed > 0) {
        console.log(`[agent-tick] Self-healed ${healed} orphan task(s) by relinking phaseId.`);
      }
    } catch (e) {
      console.error("[agent-tick] orphan task self-heal failed:", e);
    }

    // 0b1c. Stale-completed Phase rows. Phase.status was written to
    //       "COMPLETED" by legacy writers before getPhaseCompletion gained
    //       its mandatory-prereq + research-audit checks. The phase-tracker
    //       route already remaps these to "STALE" at read time (so the
    //       "Done" badge no longer sits next to a 3-item BLOCKERS list),
    //       but the underlying DB row stays COMPLETED, which can fool
    //       other consumers (agent prompt context, the pipeline page's
    //       "Gate done" check). Downgrade to STALE for any phase whose
    //       gate.preRequisites include at least one isMandatory=true
    //       entry that resolves to manual-confirmation prereqs the row
    //       can't have satisfied — proxy this as "ACTIVE deployment with
    //       a currentPhase set, and there's at least one earlier phase
    //       still marked COMPLETED with researchCompletedAt=NULL". This
    //       is the historical fast-path artefact pattern that produced
    //       the inconsistency. Idempotent: only flips COMPLETED → STALE,
    //       never the other way.
    try {
      const healed: number = await db.$executeRawUnsafe(`
        UPDATE "Phase" p
        SET "status" = 'STALE', "updatedAt" = NOW()
        WHERE p."status" = 'COMPLETED'
          AND p."researchCompletedAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM "AgentDeployment" d
            WHERE d."projectId" = p."projectId"
              AND d."isActive" = true
          )
      `);
      if (typeof healed === "number" && healed > 0) {
        console.log(`[agent-tick] Downgraded ${healed} stale COMPLETED phase row(s) → STALE (missing researchCompletedAt).`);
      }
    } catch (e) {
      console.error("[agent-tick] stale-phase self-heal failed:", e);
    }

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

    // 0c. Self-heal stuck deployments: if deployment has been in awaiting_clarification
    //     for over 1 hour with zero artefacts and no active clarification session,
    //     the lifecycle init likely failed silently. Reset to "active" so self-heal or
    //     the user clicking "Generate Artefacts" can proceed.
    try {
      const stuckDeployments = await db.agentDeployment.findMany({
        where: {
          isActive: true,
          phaseStatus: { in: ["researching", "awaiting_clarification"] },
          lastCycleAt: { lt: new Date(Date.now() - 60 * 60_000) }, // stuck > 1 hour
        },
        select: { id: true, agentId: true, projectId: true, currentPhase: true, phaseStatus: true },
      });
      for (const dep of stuckDeployments) {
        if (!dep.projectId) continue;
        const [artCount, factCount] = await Promise.all([
          db.agentArtefact.count({ where: { projectId: dep.projectId, agentId: dep.agentId } }),
          db.knowledgeBaseItem.count({
            where: {
              agentId: dep.agentId,
              projectId: dep.projectId,
              trustLevel: "HIGH_TRUST",
              tags: { has: "user_confirmed" },
            },
          }).catch(() => 0),
        ]);
        // Check if there's a real clarification session active
        let hasSession = false;
        try {
          const { getActiveSession } = await import("@/lib/agents/clarification-session");
          hasSession = !!(await getActiveSession(dep.agentId, dep.projectId));
        } catch {}

        // Unstick if: no session active AND (no artefacts OR user has answered questions)
        const shouldUnstick = !hasSession && (artCount === 0 || factCount > 0);
        if (shouldUnstick) {
          await db.agentDeployment.update({
            where: { id: dep.id },
            data: { phaseStatus: "active", lastCycleAt: new Date() },
          });
          const reason = factCount > 0
            ? `${factCount} user-confirmed facts exist — user has answered clarification but state was stuck in "${dep.phaseStatus}".`
            : `no artefacts and no session — stuck in "${dep.phaseStatus}" for over 1 hour.`;
          await db.agentActivity.create({
            data: { agentId: dep.agentId, type: "system", summary: `Self-heal: ${reason} Reset to active.` },
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error("Self-heal stuck deployment check failed:", e);
    }

    // 0c2. Cancel premature / stale phase gates. Two passes:
    //
    //   Pass A — REJECT obviously-bogus gates (0 artefacts in the project, or
    //   description literally says "generated 0 artefact"). These should never
    //   have been raised; mark them REJECTED so the user sees the cleanup
    //   trail.
    //
    //   Pass B — DEFER gates that aren't obviously bogus but no longer pass
    //   the canonical getPhaseCompletion check. These may have been raised
    //   legitimately and then a downstream change (rejected artefact, deleted
    //   task, etc.) made the phase un-advance-ready. Marking DEFERRED — not
    //   REJECTED — leaves room for the agent to re-raise once the blocker
    //   clears. This uses the same source-of-truth resolver the page consults,
    //   so badge, page and gate guard can't disagree.
    try {
      const { sweepStalePhaseGateApprovals } = await import("@/lib/agents/phase-gate-guard");
      const prematureGates = await db.approval.findMany({
        where: {
          status: "PENDING",
          type: "PHASE_GATE",
        },
        select: { id: true, projectId: true, description: true, reasoningChain: true, requestedById: true, title: true },
      });
      // Pass A — hard-reject obviously-bogus gates.
      const survivors: typeof prematureGates = [];
      for (const gate of prematureGates) {
        const artCount = await db.agentArtefact.count({ where: { projectId: gate.projectId } });
        const text = ((gate.description || "") + " " + (gate.reasoningChain || "")).toLowerCase();
        const textSaysZero = /generated\s+0\s+artefact/i.test(text) || /0\s+artefact\(s\)/i.test(text);
        if (artCount === 0 || textSaysZero) {
          await db.approval.update({
            where: { id: gate.id },
            data: {
              status: "REJECTED",
              comment: "Auto-cancelled: phase gate requested before any artefacts were generated. The agent must produce and get artefacts approved before a phase gate can be meaningfully reviewed.",
              resolvedAt: new Date(),
            },
          }).catch(() => {});
          if (gate.requestedById) {
            await db.agentActivity.create({
              data: { agentId: gate.requestedById, type: "system", summary: `Cleanup: cancelled premature phase gate "${gate.title}" — 0 artefacts existed.` },
            }).catch(() => {});
          }
        } else {
          survivors.push(gate);
        }
      }
      // Pass B — defer non-bogus gates whose phase is no longer advance-ready.
      // Group survivors by projectId so we only sweep each project once.
      const byProject = new Map<string, typeof prematureGates>();
      for (const g of survivors) {
        const arr = byProject.get(g.projectId) ?? [];
        arr.push(g);
        byProject.set(g.projectId, arr);
      }
      for (const [projectId, gates] of byProject.entries()) {
        // sweepStalePhaseGateApprovals needs an agentId for getPhaseCompletion.
        // Use the gate's requestedById if it points at an Agent — otherwise
        // fall back to any active deployment on the project.
        let agentId: string | null = null;
        const dep = await db.agentDeployment.findFirst({
          where: { projectId, isActive: true },
          select: { agentId: true },
        });
        if (dep) agentId = dep.agentId;
        if (!agentId) continue;
        try {
          await sweepStalePhaseGateApprovals(projectId, agentId);
        } catch (e) {
          console.error(`[gate-sweep] project=${projectId} gates=${gates.length} failed:`, e);
        }
      }
    } catch (e) {
      console.error("Premature phase gate cleanup failed:", e);
    }

    // 0d. Self-heal: if any active deployment has a currentPhase but zero artefacts,
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
          // Skip if an active clarification session exists — user hasn't finished the Q&A flow
          try {
            const { getActiveSession } = await import("@/lib/agents/clarification-session");
            const hasActiveSession = await getActiveSession(dep.agentId, dep.projectId);
            if (hasActiveSession) {
              console.log(`[self-heal] skipping ${dep.agentId} — active clarification session in progress`);
              continue;
            }
          } catch {}
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

      // Update next cycle time using the phase-aware interval — setup
      // phases get 24h, execution phases get the configured cycleInterval.
      const intervalMs = getEffectiveCycleInterval(deployment) * 60_000;
      await db.agentDeployment.update({
        where: { id: deployment.id },
        data: { nextCycleAt: new Date(Date.now() + intervalMs) },
      });
    }

    // 2b. Process timed-out proactive questions for all due deployments — runs
    //     regardless of whether the VPS handles the cycle, so the onboarding
    //     flow always advances when users don't respond within the timeout.
    try {
      const { processTimedOutQuestions } = await import("@/lib/agents/proactive-outreach");
      for (const dep of dueDeployments) {
        await processTimedOutQuestions(dep.agentId).catch(() => {});
      }
    } catch {}

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

            // ── autonomousCycle plan gate ────────────────────────────────
            // FREE-plan orgs don't get background runs. Their agents stay
            // dormant between user-driven actions in chat. STARTER and up
            // get the inline loop; without this check the cron would
            // happily burn credits on FREE orgs that haven't paid for the
            // feature. orgCanUseFeature is an async DB read but it's
            // outside the request hot path (cron tick) so the latency
            // doesn't matter; the alternative of caching the flag on the
            // Deployment row would drift on plan change.
            const { orgCanUseFeature } = await import("@/lib/credits/service");
            if (!(await orgCanUseFeature(orgId, "autonomousCycle"))) {
              continue;
            }

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
