/**
 * Lifecycle state machine — the single owner of AgentDeployment.phaseStatus
 * (review P2b, docs/REVIEW-2026-07-10.md).
 *
 * Before this module, phaseStatus was free text written inline by ~30 call
 * sites with no validation, no transition log, and two competing spellings
 * of the review state ("waiting_approval" from the advance flow vs
 * "pending_approval" from the artefact PATCH — a documented cadence bug).
 * Every write now goes through transitionPhaseStatus(): values are
 * canonicalised, transitions validated against an explicit matrix, and every
 * change lands in AuditLog as LIFECYCLE_TRANSITION with from/to/source.
 *
 * Rollout: OBSERVE mode by default — an off-matrix transition is applied
 * (behaviour unchanged) but recorded as DRIFT_INVALID_TRANSITION so the
 * matrix can be corrected or the caller fixed from evidence. Set
 * LIFECYCLE_ENFORCE_TRANSITIONS=1 to refuse off-matrix transitions once the
 * drift count has stayed at zero. (Four days of drift telemetry showed zero
 * state drift — the goal here is keeping it that way, not repairing.)
 */

import { db } from "@/lib/db";
import { recordDrift } from "@/lib/agents/drift-telemetry";

export const PHASE_STATUSES = [
  "researching",
  "awaiting_research_approval",
  "awaiting_clarification",
  "waiting_approval",
  "blocked_tasks_incomplete",
  "active",
  "complete",
] as const;

export type PhaseStatus = (typeof PHASE_STATUSES)[number];

/**
 * Canonicalise the historical spelling variants:
 *  - "pending_approval" → "waiting_approval" (the dual-spelling bug)
 *  - "completed"        → "complete" (schema comment / defensive readers)
 *  - null/unknown       → "active" (the column default and every reader's
 *                          existing fallback)
 */
export function normalizePhaseStatus(raw: string | null | undefined): PhaseStatus {
  const s = (raw ?? "active").toLowerCase().trim();
  if (s === "pending_approval") return "waiting_approval";
  if (s === "completed" || s === "advanced") return "complete";
  return (PHASE_STATUSES as readonly string[]).includes(s) ? (s as PhaseStatus) : "active";
}

/**
 * Allowed transitions, derived from the actual flows in the codebase
 * (lifecycle-init → phase-advance → approvals → closure, plus the
 * self-heal/unlock and reset/revert paths). `active` is the universal
 * recovery target: every unlock self-heal lands there by design.
 */
const ALLOWED: Record<PhaseStatus, ReadonlySet<PhaseStatus>> = {
  researching: new Set(["awaiting_research_approval", "awaiting_clarification", "active"]),
  awaiting_research_approval: new Set(["awaiting_clarification", "researching", "active"]),
  awaiting_clarification: new Set(["active", "researching", "awaiting_clarification"]),
  waiting_approval: new Set(["active", "blocked_tasks_incomplete", "researching", "waiting_approval"]),
  blocked_tasks_incomplete: new Set(["active", "waiting_approval", "researching"]),
  active: new Set(["researching", "awaiting_clarification", "waiting_approval", "blocked_tasks_incomplete", "complete", "active"]),
  // Terminal, but revert/reset/unarchive legitimately reopen a closed lifecycle.
  complete: new Set(["active", "researching", "awaiting_clarification"]),
};

export function isTransitionAllowed(from: PhaseStatus, to: PhaseStatus): boolean {
  return ALLOWED[from]?.has(to) ?? false;
}

export interface TransitionArgs {
  deploymentId: string;
  to: string; // canonicalised internally
  /** Short machine-readable origin, e.g. "phase-advance", "gate-approved", "self-heal:stuck" */
  source: string;
  /** Optional human-readable context for the audit trail */
  reason?: string;
  /** Extra AgentDeployment fields to write in the SAME update (currentPhase, nextCycleAt, isActive, …) */
  extraData?: Record<string, unknown>;
}

export interface TransitionResult {
  ok: boolean;
  from: PhaseStatus | null;
  to: PhaseStatus;
  refused?: boolean;
}

const ENFORCE = () => process.env.LIFECYCLE_ENFORCE_TRANSITIONS === "1";

/**
 * The ONLY sanctioned way to change AgentDeployment.phaseStatus.
 * Canonicalises, validates against the matrix, writes (with any extraData
 * merged into the same update), and records the transition in AuditLog.
 * In observe mode an off-matrix transition still applies but raises
 * DRIFT_INVALID_TRANSITION; in enforce mode it is refused (extraData is
 * still written so callers' side-fields are never silently dropped).
 */
export async function transitionPhaseStatus(args: TransitionArgs): Promise<TransitionResult> {
  const to = normalizePhaseStatus(args.to);
  const dep = await db.agentDeployment.findUnique({
    where: { id: args.deploymentId },
    select: { id: true, phaseStatus: true, projectId: true, agentId: true, agent: { select: { orgId: true } } },
  });
  if (!dep) return { ok: false, from: null, to };

  const from = normalizePhaseStatus(dep.phaseStatus);
  const allowed = isTransitionAllowed(from, to);

  if (!allowed) {
    await recordDrift(
      "DRIFT_INVALID_TRANSITION",
      "deployment",
      [{ entityId: dep.id, projectId: dep.projectId }],
      `phaseStatus transition "${from}" → "${to}" (source: ${args.source}) is not in the lifecycle matrix — ${ENFORCE() ? "REFUSED (enforce mode)" : "applied anyway (observe mode)"}. Either the matrix is missing a real flow or the caller is broken.`,
    );
    if (ENFORCE()) {
      if (args.extraData && Object.keys(args.extraData).length > 0) {
        await db.agentDeployment.update({ where: { id: dep.id }, data: args.extraData as any }).catch(() => {});
      }
      return { ok: false, from, to, refused: true };
    }
  }

  await db.agentDeployment.update({
    where: { id: dep.id },
    data: { phaseStatus: to, ...(args.extraData ?? {}) } as any,
  });

  // Transition log — cheap (transitions are rare) and makes the lifecycle
  // fully reconstructable from the audit trail.
  if (from !== to && dep.agent?.orgId) {
    await db.auditLog.create({
      data: {
        orgId: dep.agent.orgId,
        action: "LIFECYCLE_TRANSITION",
        target: `${from} → ${to}`,
        entityType: "deployment",
        entityId: dep.id,
        projectId: dep.projectId,
        agentId: dep.agentId,
        rationale: args.reason ?? null,
        details: { from, to, source: args.source } as any,
      },
    }).catch((e) => console.error("[lifecycle-machine] transition log failed (transition applied):", e));
  }

  return { ok: true, from, to };
}
