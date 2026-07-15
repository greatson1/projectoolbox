/**
 * Shared phase-advance flow.
 *
 * Both the phase-gate APPROVED handler and the explicit "Generate <Next Phase>"
 * button funnel through this so every transition gets the same treatment:
 *
 *   1. Set phaseStatus = "researching"
 *   2. Run phase-specific Perplexity research, post Research Findings card
 *   3. Set phaseStatus = "awaiting_clarification" + start clarification session
 *      (when the user finishes answering, the session-complete handler triggers
 *       artefact generation — that's the existing flow, unchanged)
 *   4. If no clarifiable artefacts exist for the new phase, generate immediately
 *      and create the next gate approval
 *
 * Caller is responsible for synchronously updating deployment.currentPhase +
 * Phase row statuses BEFORE invoking this. This helper is fire-and-forget —
 * call it without await so the HTTP response returns immediately.
 */

import { db } from "@/lib/db";
import { transitionPhaseStatus } from "@/lib/agents/lifecycle-machine";

export interface PhaseAdvanceContext {
  agentId: string;
  deploymentId: string;
  projectId: string;
  projectName: string;
  orgId: string;
  fromPhase: string | null;
  toPhase: string;
  /** User to attribute follow-up phase-gate creation to. Falls back to org owner. */
  requestedById?: string | null;
}

/** Execute the post-advance research → clarification → generation pipeline. */
export async function runPhaseAdvanceFlow(ctx: PhaseAdvanceContext): Promise<void> {
  // 0. Scaffold the new phase's PM + delivery tasks. Without this, the PM
  // Tracker / pipeline "Delivery Tasks" step shows "No tasks scaffolded for
  // this phase" and the 3-layer phase-completion check has nothing to count.
  // Idempotent: onPhaseAdvanced first marks any leftover scaffolded tasks
  // from the previous phase as done, then scaffolds the new phase. Safe to
  // call even on the first phase transition.
  try {
    const { onPhaseAdvanced } = await import("@/lib/agents/task-scaffolding");
    await onPhaseAdvanced(ctx.agentId, ctx.projectId, ctx.fromPhase || "", ctx.toPhase);
  } catch (e) {
    console.error(`[phase-advance:${ctx.toPhase}] task scaffolding failed:`, e);
  }

  // 1. Phase context-gathering — class-specific.
  //
  //   - "front" phases (Pre-Project / Initiation / Planning / etc.) run
  //     the outward Perplexity research that already existed: benchmarks,
  //     governance norms, market rates. The team still needs to figure
  //     out *what* to build, so external context is useful.
  //
  //   - "execution" phases scan the project's own data instead: schedule
  //     drift, risk materialisation, cost variance, open issues. By now
  //     the team is *delivering*, not deciding, so a web search for
  //     "scope creep prevention best practices" is noise — what they
  //     need is "is this project on track?".
  //
  //   - "closing" phases sweep for closure-readiness: outstanding work,
  //     lessons captured, benefits realisation evidence, final budget
  //     position. Same "scan your own project" pattern.
  //
  // All three return the same ResearchResult shape so the chat
  // __RESEARCH_FINDINGS__ card and the clarification seeder don't need
  // to branch on which scan ran.
  try {
    await transitionPhaseStatus({
      deploymentId: ctx.deploymentId,
      to: "researching",
      source: "phase-advance:start-research",
      reason: `Advancing into ${ctx.toPhase} — running phase context-gathering research`,
    }).catch(() => {});

    const { classifyPhase } = await import("@/lib/agents/phase-class");
    const phaseClass = classifyPhase(ctx.toPhase);

    let research;
    if (phaseClass === "execution") {
      const { runExecutionProgressScan } = await import("@/lib/agents/execution-progress-scan");
      research = await runExecutionProgressScan(ctx.agentId, ctx.projectId, ctx.toPhase);
    } else if (phaseClass === "closing") {
      const { runClosureScan } = await import("@/lib/agents/closure-scan");
      research = await runClosureScan(ctx.agentId, ctx.projectId, ctx.toPhase);
    } else {
      const { runPhaseResearch } = await import("@/lib/agents/feasibility-research");
      research = await runPhaseResearch(ctx.agentId, ctx.projectId, ctx.orgId, ctx.toPhase);
    }

    if (research.factsDiscovered > 0) {
      await db.chatMessage.create({
        data: {
          agentId: ctx.agentId,
          role: "agent",
          content: "__RESEARCH_FINDINGS__",
          metadata: {
            type: "research_findings",
            projectName: ctx.projectName,
            factsCount: research.factsDiscovered,
            sections: research.sections,
            facts: research.facts,
            phase: ctx.toPhase,
            phaseClass,
          } as any,
        },
      }).catch(() => {});

      // Persist execution/closing scan facts as HIGH_TRUST KB items so the
      // existing getProjectKnowledgeContext pulls them into the artefact
      // generation prompt. Without this, the Status Report Sonnet drafts
      // during Execution wouldn't know "23 tasks behind, 2 high-score risks
      // materialised" — the user would have to type those into clarification
      // every time. Front phases' Perplexity research is already persisted
      // by feasibility-research.ts so we only do this for execution/closing.
      if (phaseClass === "execution" || phaseClass === "closing") {
        try {
          const scanTag = `${phaseClass}_scan`;
          const phaseTag = ctx.toPhase.toLowerCase();
          // Clear any prior snapshot for this phase so the next generation
          // doesn't read stale data on top of fresh data.
          await db.knowledgeBaseItem.deleteMany({
            where: {
              projectId: ctx.projectId,
              agentId: ctx.agentId,
              tags: { hasEvery: ["phase_scan", scanTag] },
            },
          }).catch(() => {});

          // One KB item per section + one per fact — the prompt builder
          // truncates each at ~400 chars so we don't want to dump
          // everything in one giant item.
          const items: { title: string; content: string }[] = [];
          for (const s of research.sections) {
            items.push({
              title: `[live ${phaseClass} scan — ${s.label}]`,
              content: s.content,
            });
          }
          for (const f of research.facts) {
            items.push({
              title: `[live ${phaseClass} scan — ${f.title}]`,
              content: f.content,
            });
          }

          if (items.length > 0) {
            const now = new Date();
            await db.knowledgeBaseItem.createMany({
              data: items.map((it) => ({
                agentId: ctx.agentId,
                projectId: ctx.projectId,
                orgId: ctx.orgId,
                layer: "PROJECT" as const,
                type: "fact",
                title: it.title,
                content: it.content,
                trustLevel: "HIGH_TRUST",
                tags: ["phase_scan", scanTag, phaseTag, "live_snapshot"],
                source: "phase_scan",
                createdAt: now,
                updatedAt: now,
              })),
              skipDuplicates: true,
            }).catch((e: unknown) => {
              console.error(`[phase-advance:${ctx.toPhase}] persist scan KB failed:`, e);
            });
          }
        } catch (e) {
          console.error(`[phase-advance:${ctx.toPhase}] scan persistence failed:`, e);
        }
      }
    }
  } catch (e) {
    console.error(`[phase-advance:${ctx.toPhase}] phase scan failed:`, e);
  }

  // 2. Clarification — phase-specific questions seeded from research + KB gaps
  try {
    const nextPhaseRow = await db.phase.findFirst({
      where: { projectId: ctx.projectId, name: ctx.toPhase },
      select: { artefacts: true },
    });
    const artefactNames = Array.isArray(nextPhaseRow?.artefacts)
      ? (nextPhaseRow.artefacts as string[])
      : [];
    if (artefactNames.length > 0) {
      // Strict-sequencing checkpoint — same as lifecycle-init. If the
      // phase research above produced pending research-finding approvals,
      // hold here. The research-approval handler will fire clarification
      // once the user clears the queue.
      const pendingResearchApprovals = await db.approval.count({
        where: {
          projectId: ctx.projectId,
          status: "PENDING",
          type: "CHANGE_REQUEST",
          impact: { path: ["subtype"], equals: "research_finding" },
        },
      }).catch(() => 0);

      if (pendingResearchApprovals > 0) {
        await transitionPhaseStatus({
          deploymentId: ctx.deploymentId,
          to: "awaiting_research_approval",
          source: "phase-advance:research-approval",
          reason: `${ctx.toPhase} research complete — pending research-finding approvals must be cleared before clarification`,
        }).catch(() => {});
        await db.chatMessage.create({
          data: {
            agentId: ctx.agentId,
            role: "agent",
            content: [
              `## ${ctx.toPhase} research is in — your turn`,
              ``,
              `I've completed the ${ctx.toPhase} research and posted ${pendingResearchApprovals === 1 ? "an approval bundle" : `${pendingResearchApprovals} approval bundles`} on the Approvals page.`,
              ``,
              `Once you've reviewed and approved the findings, I'll post clarification questions before drafting the ${ctx.toPhase} artefacts.`,
              ``,
              `[Open Approvals](/approvals)`,
            ].join("\n"),
          },
        }).catch(() => {});
        await db.agentActivity.create({
          data: { agentId: ctx.agentId, type: "chat", summary: `${ctx.toPhase} research complete — awaiting your approval on ${pendingResearchApprovals} research finding bundle${pendingResearchApprovals === 1 ? "" : "s"} before clarification can begin.` },
        }).catch(() => {});
        return;
      }

      await transitionPhaseStatus({
        deploymentId: ctx.deploymentId,
        to: "awaiting_clarification",
        source: "phase-advance:clarification",
        reason: `${ctx.toPhase} research complete with no pending approvals — starting clarification`,
      }).catch(() => {});
      const { startClarificationSession } = await import("@/lib/agents/clarification-session");
      const { markClarificationSkipped } = await import("@/lib/agents/phase-next-action");
      const outcome = await startClarificationSession(ctx.agentId, ctx.projectId, ctx.orgId, artefactNames);
      // Discriminated handling — never silently skip on failure. The
      // "started"/"already_active" branches defer to the session-complete
      // handler. "no_questions" records the legitimate skip and falls
      // through to direct generation. "failed" surfaces a chat message
      // and stops here so the user can retry.
      if (outcome.outcome === "started" || outcome.outcome === "already_active") {
        return;
      }
      if (outcome.outcome === "no_questions") {
        await markClarificationSkipped(ctx.projectId, ctx.toPhase, "no_questions_needed");
        // fall through to step 3 (generation)
      } else {
        console.error(`[phase-advance:${ctx.toPhase}] clarification FAILED: ${outcome.reason}`);
        await db.chatMessage.create({
          data: {
            agentId: ctx.agentId,
            role: "agent",
            content: [
              `## Clarification for ${ctx.toPhase} hit a snag`,
              ``,
              `I couldn't generate clarification questions for the new phase. Reason: \`${outcome.reason}\``,
              ``,
              `Reply **"Skip questions and generate"** to proceed with [TBC] markers, or send me what you'd like me to know about ${ctx.toPhase} and I'll save it as a fact.`,
            ].join("\n"),
            metadata: { type: "clarification_failed", reason: outcome.reason, phase: ctx.toPhase } as any,
          },
        }).catch(() => {});
        return;
      }
    }
  } catch (e) {
    console.error(`[phase-advance:${ctx.toPhase}] clarification failed:`, e);
  }

  // 3. No clarifiable artefacts — generate now and create the gate approval
  try {
    await transitionPhaseStatus({
      deploymentId: ctx.deploymentId,
      to: "active",
      source: "phase-advance:generated",
      reason: `No clarifiable artefacts for ${ctx.toPhase} — generating immediately`,
    }).catch(() => {});

    const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
    const result = await generatePhaseArtefacts(ctx.agentId, ctx.projectId, ctx.toPhase);

    if (result.generated > 0) {
      let requestedById = ctx.requestedById ?? null;
      if (!requestedById) {
        const owner = await db.user.findFirst({
          where: { orgId: ctx.orgId, role: { in: ["OWNER", "ADMIN"] } },
          select: { id: true },
        });
        requestedById = owner?.id ?? null;
      }
      if (requestedById) {
        // Guarded create — refuses if PM tasks / clarification / prereqs
        // are still outstanding. Without this we were raising a gate just
        // because artefacts were generated, missing the other layers.
        const { createPhaseGateApprovalIfReady } = await import("./phase-gate-guard");
        const nextPhaseName = (() => {
          // ctx.toPhase is the phase being advanced INTO; we need the
          // CURRENT phase + the next as separate names. Use ctx fields if
          // available, else derive from methodology.
          // Falls back to "next phase" when not resolvable.
          return (ctx as any).nextPhase || "next phase";
        })();
        const outcome = await createPhaseGateApprovalIfReady({
          projectId: ctx.projectId,
          phaseName: ctx.toPhase,
          nextPhaseName,
          agentId: ctx.agentId,
          description: `The agent has completed the ${ctx.toPhase} phase and generated ${result.generated} artefact(s). Review them and approve to advance to the next phase.`,
          urgency: "MEDIUM",
        });
        if (outcome.skipped) {
          console.log(`[phase-advance] gate not raised (${outcome.reason}): ${outcome.blockers.join("; ")}`);
        }
      }
      await db.agentActivity.create({
        data: {
          agentId: ctx.agentId,
          type: "approval",
          summary: `${ctx.toPhase} gate approval requested — ${result.generated} artefact(s) ready for review`,
        },
      }).catch(() => {});
      await transitionPhaseStatus({
        deploymentId: ctx.deploymentId,
        to: "waiting_approval",
        source: "phase-advance:gate-pending",
        reason: `${ctx.toPhase} artefacts generated — gate approval requested`,
      }).catch(() => {});
    }
  } catch (e) {
    console.error(`[phase-advance:${ctx.toPhase}] generation failed:`, e);
  }
}
