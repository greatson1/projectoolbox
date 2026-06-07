/**
 * Phase Next-Action Resolver — single source of truth for "what must happen
 * next on this phase?"
 *
 * Before this module existed, the same enforcement decision was duplicated
 * across 8 files (lifecycle-init, phase-advance, approvals/[id]/route,
 * phase-completion/route, cron/agent-tick, pipeline/route, chat/stream,
 * artefacts/regenerate). Each had subtle differences — and any one of them
 * could silently skip a step (e.g. clarification fall-through on pre-project,
 * phase-completion POST advancing without research).
 *
 * Now every code path that needs to decide "should we do X next" calls
 * `getNextRequiredStep()` and respects what it returns. The agent literally
 * cannot skip a step because every entry point asks the resolver first.
 *
 * Authoritative state comes from the Phase row's audit timestamps
 * (researchCompletedAt, clarificationCompletedAt, gateApprovedAt) — NOT
 * from the inferred phaseStatus string or KB tag heuristics, which were
 * the source of the silent-skip bugs.
 */

import { db } from "@/lib/db";
import { getPhaseCompletion } from "@/lib/agents/phase-completion";
import { getActiveSession } from "@/lib/agents/clarification-session";
import { sessionHasUnansweredQuestions } from "@/lib/agents/clarification-session-state";

export type RequiredStep =
  | "research"
  | "research_approval"
  | "clarification"
  | "clarification_in_progress"
  | "generation"
  | "review_artefacts"
  | "delivery_tasks"
  | "gate_approval"
  | "advance"
  | "complete";

export interface NextActionResult {
  step: RequiredStep;
  reason: string;
  blockedBy: string[];
  /** Human-readable label for the chat banner. */
  bannerLabel: string;
  /** Should the agent proactively act on this, or wait for the user? */
  awaitingUser: boolean;
}

/**
 * Position-based progress ceiling for a phase, derived from the resolver's
 * 8-step pipeline. The displayed phase readiness must never exceed where the
 * phase actually IS in this ladder — otherwise the headline % contradicts the
 * stepper (e.g. "100%" while parked at "approve research", step 2 of 8).
 *
 * The displayed readiness is `min(weightedCompletion, stepProgressCeiling)`:
 * the meaningful weighted number shows through when it's lower, but the number
 * can never claim more progress than the pipeline position allows. Only
 * "advance"/"complete" allow a true 100%.
 *
 * Ceilings leave headroom inside each band so finer-grained layer progress
 * (e.g. 2/4 artefacts approved during review_artefacts) can still move the
 * bar within the step.
 */
export function stepProgressCeiling(step: RequiredStep): number {
  switch (step) {
    case "research":                  return 15;
    case "research_approval":         return 25;
    case "clarification":             return 40;
    case "clarification_in_progress": return 40;
    case "generation":                return 55;
    case "review_artefacts":          return 75;
    case "delivery_tasks":            return 90;
    case "gate_approval":             return 99;
    case "advance":                   return 100;
    case "complete":                  return 100;
    default:                          return 100;
  }
}

// Pure banner-composition lives in its own module so the test file can
// import it without dragging in db/Prisma. Re-export for callers that
// already imported from phase-next-action.
export { composeReviewBanner } from "./phase-next-action-banner";
import { composeReviewBanner as _composeReviewBanner } from "./phase-next-action-banner";

interface ResolverInput {
  agentId: string;
  projectId: string;
  phaseName: string;
}

/**
 * Compute what must happen next on a given phase. Idempotent and side-effect
 * free — safe to call from any code path.
 */
export async function getNextRequiredStep({
  agentId,
  projectId,
  phaseName,
}: ResolverInput): Promise<NextActionResult> {
  const [phase, deployment] = await Promise.all([
    db.phase.findFirst({
      where: { projectId, name: phaseName },
      select: {
        id: true,
        name: true,
        status: true,
        researchCompletedAt: true,
        clarificationCompletedAt: true,
        clarificationSkippedReason: true,
        gateApprovedAt: true,
      },
    }),
    db.agentDeployment.findFirst({
      where: { agentId, projectId, isActive: true },
      select: { id: true, phaseStatus: true },
    }),
  ]);

  if (!phase) {
    return {
      step: "research",
      reason: "Phase row missing",
      blockedBy: [],
      bannerLabel: "Phase not initialised yet",
      awaitingUser: false,
    };
  }

  // Step 1 — research must complete before any other work.
  //
  // Self-heal: research-step bypass detector. If `researchCompletedAt`
  // is null but there's downstream evidence that research clearly
  // happened — artefacts already drafted/approved, clarification
  // session run, research-tagged KB items present — backfill the
  // timestamp instead of falsely claiming the agent is still in the
  // research step. This was the bug behind the chat banner saying
  // "Researching Pre-Project" while the chat body discussed artefact
  // review.
  //
  // Two failure modes this protects against:
  //   1. Deployments older than the audit-timestamp mechanism that
  //      never had `markResearchComplete` wired
  //   2. Research that ran via a non-feasibility-research path (KB
  //      import, manual fact entry, n8n) without calling the helper
  if (!phase.researchCompletedAt) {
    const downstreamEvidence = await detectResearchAlreadyHappened(projectId, phaseName, phase.id, agentId);
    if (downstreamEvidence) {
      await markResearchComplete(projectId, phaseName).catch(() => {});
      // Treat as completed for this resolution pass; carry on to step 1b.
    } else {
      return {
        step: "research",
        reason: `Phase research has not been completed for ${phaseName}.`,
        blockedBy: ["research"],
        bannerLabel: `Researching ${phaseName}…`,
        awaitingUser: false,
      };
    }
  }

  // Step 1b — research findings must be approved by the user. If a
  // research-finding approval is still PENDING for this project, the
  // facts are tagged pending_user_confirmation and excluded from
  // generation prompts. We block clarification here because clarification
  // questions should only be asked AFTER the user has decided which
  // research to trust.
  //
  // BUT only when the phase is genuinely still at the research stage.
  // Approval rows carry no phase column, so a project-wide PENDING count
  // can include stale/orphaned research-finding approvals left over from
  // earlier in the lifecycle (e.g. the user advanced past research without
  // explicitly resolving every finding). Without a guard, those orphans
  // rewind the stepper to "Approve research" even though clarification,
  // generation and the gate have all already happened — which is exactly
  // the bug where the chat body shows "Phase Gate awaiting approval" while
  // the stepper highlights "Approve research".
  //
  // Mirror the self-heal pattern used for research/clarification: if the
  // phase has demonstrably progressed past research approval — clarification
  // is complete/skipped, OR the gate has already been approved — treat the
  // pending research approvals as stale and DON'T block on them here. The
  // approvals still live in the Approvals queue for the user to clear; they
  // just no longer dictate the phase's current step.
  const clarificationDoneOrSkipped =
    !!phase.clarificationCompletedAt ||
    phase.clarificationSkippedReason === "no_questions_needed" ||
    phase.clarificationSkippedReason === "user_skipped_explicit";
  const phaseProgressedPastResearch = clarificationDoneOrSkipped || !!phase.gateApprovedAt;

  if (!phaseProgressedPastResearch) {
    const pendingResearchApprovals = await db.approval.count({
      where: {
        projectId,
        status: "PENDING",
        type: "CHANGE_REQUEST",
        impact: { path: ["subtype"], equals: "research_finding" },
      },
    }).catch(() => 0);
    if (pendingResearchApprovals > 0) {
      return {
        step: "research_approval",
        reason: `${pendingResearchApprovals} research-finding approval${pendingResearchApprovals === 1 ? "" : "s"} awaiting your review.`,
        blockedBy: ["research_approval"],
        bannerLabel: `Approve ${pendingResearchApprovals} research finding${pendingResearchApprovals === 1 ? "" : "s"}`,
        awaitingUser: true,
      };
    }
  }

  // Step 2 — clarification must be either completed OR explicitly skipped
  // for an ALLOWED reason. A null clarificationCompletedAt + null skippedReason
  // means the agent has not yet asked questions for this phase. Falling
  // through (the old bug) is no longer possible — the resolver returns
  // "clarification" until the timestamp is set or an allowed skip reason is
  // recorded.
  if (!phase.clarificationCompletedAt) {
    // If a skip reason was recorded, treat clarification as done. Only two
    // values count as "legitimately skipped"; anything else means a failure
    // happened and we must retry.
    const allowedSkipReasons = ["no_questions_needed", "user_skipped_explicit"];
    if (phase.clarificationSkippedReason && allowedSkipReasons.includes(phase.clarificationSkippedReason)) {
      // Fall through to step 3 (generation)
    } else {
      // Check whether a session is already in flight — if so, surface that
      // distinctly from "needs to start clarification" so the banner can
      // say "Answer the X open questions" instead of "Generating questions".
      const activeSession = await getActiveSession(agentId, projectId).catch(() => null);
      if (activeSession) {
        return {
          step: "clarification_in_progress",
          reason: `Clarification session active — user must answer remaining questions.`,
          blockedBy: ["clarification"],
          bannerLabel: "Answer the open clarification questions",
          awaitingUser: true,
        };
      }
      // Self-heal mirror of the research step. If clarification timestamp
      // is null but artefacts have been drafted/approved (clarification
      // is a gate that precedes generation), the agent has clearly moved
      // past clarification and the missing timestamp is a bookkeeping
      // miss, not a real "clarification still pending" signal.
      const clarificationBypassed = await detectClarificationAlreadyHappened(projectId, phaseName, phase.id, agentId);
      if (clarificationBypassed) {
        await markClarificationSkipped(projectId, phaseName, "no_questions_needed").catch(() => {});
        // Fall through to step 3
      } else {
        return {
          step: "clarification",
          reason: `Clarification has not been completed for ${phaseName}.`,
          blockedBy: ["clarification"],
          bannerLabel: `Clarification questions waiting`,
          awaitingUser: true,
        };
      }
    }
  }

  // Step 3 — artefacts must exist (generation) before review can happen.
  // Use phase-completion's artefact count as the signal.
  const completion = await getPhaseCompletion(projectId, phaseName, agentId).catch(() => null);

  if (!completion) {
    return {
      step: "generation",
      reason: "Phase completion check failed.",
      blockedBy: ["generation"],
      bannerLabel: "Generating artefacts…",
      awaitingUser: false,
    };
  }

  // `total` is the methodology required count or live count, whichever is
  // larger — it can be inflated by methodology requirements when no actual
  // artefacts exist yet (e.g. Planning phase requires WBS + Cost Plan →
  // total=2 even when DB has 0 artefacts). `liveCount` is what actually
  // sits in the DB regardless of methodology, so it's the right signal for
  // "should the user review drafts" vs "the agent needs to generate".
  // Previously: total === 0 was the only generation gate, which caused the
  // chat banner to say "Review 2 draft artefacts" while the agent text
  // said "Missing required: WBS, Cost Management Plan" — the resolver fell
  // through to review_artefacts even though zero drafts existed.
  const liveArtefactCount = completion.artefacts.liveCount ?? completion.artefacts.total;

  if (liveArtefactCount === 0) {
    return {
      step: "generation",
      reason: completion.artefacts.total > 0
        ? `${completion.artefacts.total} required ${phaseName} artefact${completion.artefacts.total === 1 ? "" : "s"} not yet generated.`
        : `No artefacts have been generated for ${phaseName}.`,
      blockedBy: ["generation"],
      bannerLabel: `Generate ${phaseName} artefacts`,
      awaitingUser: true,
    };
  }

  // Step 4 — artefacts must be approved (review). The "X draft" count uses
  // LIVE artefacts (what's actually in the DB) minus approved, so the
  // bannerLabel never claims drafts exist that don't.
  if (completion.artefacts.pct < 100) {
    const draftCount = Math.max(0, liveArtefactCount - completion.artefacts.done);
    const missingRequired = completion.artefacts.missingRequiredCount ?? 0;
    const composed = _composeReviewBanner({ draftCount, missingRequired, phaseName });
    return {
      step: "review_artefacts",
      reason: `${completion.artefacts.done}/${completion.artefacts.total} artefacts approved${composed.reasonExtras}.`,
      blockedBy: ["artefact_review"],
      bannerLabel: composed.bannerLabel,
      awaitingUser: true,
    };
  }

  // Step 5 — delivery + PM tasks must clear the threshold (canAdvance handles
  // both). canAdvance also checks per-methodology gate prerequisites.
  if (!completion.canAdvance) {
    const blockerSummary = completion.blockers[0] || "Phase work is incomplete.";
    return {
      step: "delivery_tasks",
      reason: blockerSummary,
      blockedBy: completion.blockers,
      bannerLabel: blockerSummary,
      awaitingUser: true,
    };
  }

  // Step 6 — gate approval. canAdvance can be true even if no gate has been
  // approved (the gate row might not exist yet or might be PENDING).
  if (!phase.gateApprovedAt) {
    return {
      step: "gate_approval",
      reason: `${phaseName} gate awaiting approval.`,
      blockedBy: ["gate_approval"],
      bannerLabel: `Approve the ${phaseName} phase gate`,
      awaitingUser: true,
    };
  }

  // Step 7 — gate approved, ready to advance to next phase. The advance
  // itself is triggered by the approval handler; the resolver returns
  // "advance" so callers can detect the green-light state.
  if (deployment?.phaseStatus !== "advanced") {
    return {
      step: "advance",
      reason: `${phaseName} complete — ready to advance to next phase.`,
      blockedBy: [],
      bannerLabel: `${phaseName} complete — advancing`,
      awaitingUser: false,
    };
  }

  return {
    step: "complete",
    reason: `${phaseName} fully complete.`,
    blockedBy: [],
    bannerLabel: `${phaseName} complete`,
    awaitingUser: false,
  };
}

// ─── Audit-trail helpers ──────────────────────────────────────────────────────

/** Record that phase research completed. Idempotent — only writes on first call. */
export async function markResearchComplete(projectId: string, phaseName: string): Promise<void> {
  await db.phase.updateMany({
    where: { projectId, name: phaseName, researchCompletedAt: null },
    data: { researchCompletedAt: new Date() },
  }).catch(() => {});
}

/**
 * Record that clarification was completed (user answered all questions). Use
 * markClarificationSkipped() instead when no session ran — they're distinct
 * states for audit and resolver behaviour.
 */
export async function markClarificationComplete(projectId: string, phaseName: string): Promise<void> {
  await db.phase.updateMany({
    where: { projectId, name: phaseName, clarificationCompletedAt: null },
    data: { clarificationCompletedAt: new Date() },
  }).catch(() => {});
}

/**
 * Record that clarification was deliberately skipped with an allowed reason.
 * `reason` MUST be one of the allowed values — anything else is rejected
 * because it implies a failure that should retry rather than skip.
 */
export async function markClarificationSkipped(
  projectId: string,
  phaseName: string,
  reason: "no_questions_needed" | "user_skipped_explicit",
): Promise<void> {
  await db.phase.updateMany({
    where: { projectId, name: phaseName, clarificationSkippedReason: null },
    data: { clarificationSkippedReason: reason },
  }).catch(() => {});
}

/** Record that the phase gate was approved by the user. */
export async function markGateApproved(projectId: string, phaseName: string): Promise<void> {
  await db.phase.updateMany({
    where: { projectId, name: phaseName, gateApprovedAt: null },
    data: { gateApprovedAt: new Date() },
  }).catch(() => {});
}

// ─── Self-heal detectors ──────────────────────────────────────────────────────
//
// The resolver returns the EARLIEST step whose timestamp is null. That's
// correct when the agent is genuinely still at that step — but if a
// downstream step has already happened (artefacts drafted, user has
// answered questions, gate has been approved), then the missing
// timestamp is a bookkeeping miss, not a real "still pending" signal.
// The helpers below detect that pattern and the resolver backfills the
// timestamp so the banner reflects real state.

/**
 * True if there's clear evidence research has happened for this phase
 * even though `Phase.researchCompletedAt` is null. Signals (any one
 * sufficient):
 *   - Any artefact exists for this phase (artefacts can't be generated
 *     without research being the prior gate)
 *   - Research-tagged KB items exist for this phase
 *   - Clarification has happened (clarification follows research)
 *   - Gate was already approved
 */
async function detectResearchAlreadyHappened(
  projectId: string,
  phaseName: string,
  phaseId: string,
  agentId: string,
): Promise<boolean> {
  try {
    const [anyArtefact, researchKB] = await Promise.all([
      db.agentArtefact.findFirst({
        where: {
          projectId,
          OR: [{ phaseId }, { phaseId: phaseName }],
        },
        select: { id: true },
      }),
      db.knowledgeBaseItem.findFirst({
        where: {
          projectId,
          agentId,
          tags: { hasSome: ["research", "feasibility", "phase_research"] },
        },
        select: { id: true },
      }),
    ]);
    return !!(anyArtefact || researchKB);
  } catch (e) {
    console.error("[phase-next-action] detectResearchAlreadyHappened failed:", e);
    return false;
  }
}

/**
 * True if there's clear evidence clarification has happened for this
 * phase even though both `clarificationCompletedAt` and
 * `clarificationSkippedReason` are null. Signals:
 *   - Any artefact exists for this phase (clarification precedes
 *     generation in the canonical flow, so an artefact's existence
 *     implies clarification ran or was rationally skipped)
 *   - The user has answered at least one clarification question in
 *     the past for this project (user_confirmed / user_answer KB items)
 *
 * IMPORTANT: an active clarification session with >0 unanswered
 * questions overrides the above signals. An artefact may exist from a
 * prior phase / earlier round / partial path, but if there are open
 * questions sitting in the active session the user hasn't been asked
 * yet, then clarification has NOT meaningfully happened — and the chat
 * agent must NOT short-circuit with "no pending questions" while the
 * status card simultaneously says "19 Open questions". The session is
 * the source of truth for "what's left to ask".
 */
export async function detectClarificationAlreadyHappened(
  projectId: string,
  phaseName: string,
  phaseId: string,
  agentId: string,
): Promise<boolean> {
  try {
    const [anyArtefact, userAnswers, activeSession] = await Promise.all([
      db.agentArtefact.findFirst({
        where: {
          projectId,
          OR: [{ phaseId }, { phaseId: phaseName }],
        },
        select: { id: true },
      }),
      db.knowledgeBaseItem.findFirst({
        where: {
          projectId,
          agentId,
          tags: { hasSome: ["user_confirmed", "user_answer"] },
        },
        select: { id: true },
      }),
      db.knowledgeBaseItem.findFirst({
        where: {
          projectId,
          agentId,
          title: "__clarification_session__",
          tags: { has: "active" },
        },
        select: { content: true },
      }),
    ]);

    // Source-of-truth check: if the active session still carries
    // unanswered questions, clarification is provably NOT done — no
    // matter what artefacts or prior answers exist.
    if (sessionHasUnansweredQuestions(activeSession?.content)) return false;

    return !!(anyArtefact || userAnswers);
  } catch (e) {
    console.error("[phase-next-action] detectClarificationAlreadyHappened failed:", e);
    return false;
  }
}
