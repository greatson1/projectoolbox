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

  // 1. Phase research — capture latest context before generating docs
  try {
    await db.agentDeployment.update({
      where: { id: ctx.deploymentId },
      data: { phaseStatus: "researching" },
    }).catch(() => {});

    const { runPhaseResearch } = await import("@/lib/agents/feasibility-research");
    const research = await runPhaseResearch(ctx.agentId, ctx.projectId, ctx.orgId, ctx.toPhase);

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
          } as any,
        },
      }).catch(() => {});
    }
  } catch (e) {
    console.error(`[phase-advance:${ctx.toPhase}] research failed:`, e);
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
      await db.agentDeployment.update({
        where: { id: ctx.deploymentId },
        data: { phaseStatus: "awaiting_clarification" },
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
    await db.agentDeployment.update({
      where: { id: ctx.deploymentId },
      data: { phaseStatus: "active" },
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
        await db.approval.create({
          data: {
            projectId: ctx.projectId,
            requestedById,
            title: `${ctx.toPhase} Gate: Review and approve to advance`,
            description: `The agent has completed the ${ctx.toPhase} phase and generated ${result.generated} artefact(s). Review them and approve to advance to the next phase.`,
            type: "PHASE_GATE",
            status: "PENDING",
            impact: { level: "MEDIUM", description: "Phase gate approval" } as any,
          },
        }).catch(() => {});
      }
      await db.agentActivity.create({
        data: {
          agentId: ctx.agentId,
          type: "approval",
          summary: `${ctx.toPhase} gate approval requested — ${result.generated} artefact(s) ready for review`,
        },
      }).catch(() => {});
      await db.agentDeployment.update({
        where: { id: ctx.deploymentId },
        data: { phaseStatus: "waiting_approval" },
      }).catch(() => {});
    }
  } catch (e) {
    console.error(`[phase-advance:${ctx.toPhase}] generation failed:`, e);
  }
}
