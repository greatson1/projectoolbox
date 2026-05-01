/**
 * Centralised gate-readiness guard for PHASE_GATE approval creation.
 *
 * Why this exists:
 *   PHASE_GATE approvals were being created from several call sites
 *   (artefact approval handler, pipeline route, agent-tick cron,
 *   monitoring loop, lifecycle init, phase-advance helper) and each
 *   had its own ad-hoc readiness rule — usually just "all artefacts
 *   approved". Other readiness signals (PM tasks done, gate prereqs
 *   met, clarification answered, delivery tasks at threshold) were
 *   ignored. Result: a PHASE_GATE approval would land in the queue
 *   with title "→ Initiation" while the underlying phase was still
 *   blocked, and the user could approve a gate that getPhaseCompletion
 *   would refuse to advance through.
 *
 * The fix:
 *   - assertPhaseAdvanceReady consults getPhaseCompletion (the single
 *     source of truth) AND checks that no other PHASE_GATE approval
 *     for this phase is already PENDING (avoids dupes).
 *   - createPhaseGateApprovalIfReady is a thin wrapper around
 *     db.approval.create that runs the guard first. Returns the new
 *     approval id on success or { skipped: true, reason } when the
 *     gate isn't ready / already exists. Every PHASE_GATE creation
 *     site uses this so misaligned approvals can't land at all.
 *
 *   - sweepStalePhaseGateApprovals is the cleanup half: scans PENDING
 *     PHASE_GATE approvals on a project and DEFERS any whose phase is
 *     no longer advance-ready (e.g. an artefact got rejected after
 *     the gate was raised). Run from the artefact PATCH handler
 *     whenever an APPROVED artefact gets reverted to DRAFT.
 */

import { db } from "@/lib/db";
import { getPhaseCompletion } from "./phase-completion";

export interface GateReadinessResult {
  ready: boolean;
  /** Reasons why advancement is blocked. Empty when ready. */
  blockers: string[];
  /** Existing PENDING approval id for this phase, if any. Used to dedupe. */
  existingApprovalId?: string;
}

/**
 * Returns whether the phase can advance, with the blocker list straight
 * from getPhaseCompletion plus a duplicate-approval check.
 */
export async function assertPhaseAdvanceReady(
  projectId: string,
  phaseName: string,
  agentId: string,
): Promise<GateReadinessResult> {
  const blockers: string[] = [];

  // Layer 1: existing PENDING gate for this phase (avoid duplicates)
  const phaseLC = phaseName.toLowerCase();
  const pending = await db.approval.findFirst({
    where: {
      projectId,
      type: "PHASE_GATE",
      status: "PENDING",
    },
    select: { id: true, title: true },
  });
  if (pending) {
    const titleLC = (pending.title || "").toLowerCase();
    if (titleLC.startsWith(phaseLC) || titleLC.includes(`gate: ${phaseLC}`) || titleLC.includes(`${phaseLC} →`)) {
      return { ready: false, blockers: ["A phase gate approval is already pending for this phase"], existingApprovalId: pending.id };
    }
  }

  // Layer 2: getPhaseCompletion blockers
  try {
    const completion = await getPhaseCompletion(projectId, phaseName, agentId);
    if (!completion.canAdvance) {
      blockers.push(...completion.blockers);
    }
  } catch (e) {
    blockers.push("Phase completion check failed — refusing to raise gate");
    console.error("[phase-gate-guard] getPhaseCompletion failed:", e);
  }

  return { ready: blockers.length === 0, blockers };
}

export interface CreatePhaseGateInput {
  projectId: string;
  phaseName: string;
  nextPhaseName: string;
  agentId: string;
  /** Optional richer description; default mentions readiness state. */
  description?: string;
  urgency?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export type CreateGateOutcome =
  | { skipped: true; reason: string; blockers: string[]; existingApprovalId?: string }
  | { skipped: false; approvalId: string };

/**
 * Wraps db.approval.create with the readiness guard. Use this from every
 * PHASE_GATE creation site so misaligned approvals can't be raised.
 */
export async function createPhaseGateApprovalIfReady(
  input: CreatePhaseGateInput,
): Promise<CreateGateOutcome> {
  const readiness = await assertPhaseAdvanceReady(input.projectId, input.phaseName, input.agentId);
  if (!readiness.ready) {
    return {
      skipped: true,
      reason: readiness.existingApprovalId
        ? "duplicate"
        : "not-advance-ready",
      blockers: readiness.blockers,
      existingApprovalId: readiness.existingApprovalId,
    };
  }

  const approval = await db.approval.create({
    data: {
      projectId: input.projectId,
      requestedById: input.agentId,
      type: "PHASE_GATE",
      title: `Phase Gate: ${input.phaseName} → ${input.nextPhaseName}`,
      description: input.description
        ?? `All readiness checks for the ${input.phaseName} phase passed. Review and approve to advance to ${input.nextPhaseName}.`,
      status: "PENDING",
      urgency: input.urgency || "MEDIUM",
      impactScores: { schedule: 2, cost: 1, scope: 1, stakeholder: 1 } as any,
    },
  });
  return { skipped: false, approvalId: approval.id };
}

/**
 * Cleanup: defer any PENDING PHASE_GATE approval on this project whose
 * phase is no longer advance-ready. Returns the count deferred so the
 * caller can audit-log it.
 */
export async function sweepStalePhaseGateApprovals(
  projectId: string,
  agentId: string,
): Promise<{ deferred: number; deferredIds: string[] }> {
  const pending = await db.approval.findMany({
    where: { projectId, type: "PHASE_GATE", status: "PENDING" },
    select: { id: true, title: true },
  });
  if (pending.length === 0) return { deferred: 0, deferredIds: [] };

  const deferredIds: string[] = [];
  for (const a of pending) {
    // Title format is "Phase Gate: <Phase> → <Next>"
    const m = (a.title || "").match(/Phase Gate:\s*([^→]+?)\s*→/i);
    const phaseName = m ? m[1].trim() : null;
    if (!phaseName) continue;
    const readiness = await assertPhaseAdvanceReady(projectId, phaseName, agentId);
    if (!readiness.ready && !readiness.existingApprovalId) {
      // Block reason here is genuine (not just a duplicate-of-itself).
      await db.approval.update({
        where: { id: a.id },
        data: {
          status: "DEFERRED",
          comment: `Auto-deferred — phase ${phaseName} is no longer advance-ready: ${readiness.blockers.slice(0, 3).join("; ")}`,
        },
      }).catch(() => {});
      deferredIds.push(a.id);
    }
  }
  return { deferred: deferredIds.length, deferredIds };
}
