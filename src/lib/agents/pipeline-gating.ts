/**
 * Pure logic for pipeline step state machines.
 *
 * Extracted from API routes and React pages so it can be unit-tested without
 * spinning up Prisma, Next, or React Query.
 */

export type StepStatus = "done" | "running" | "failed" | "skipped" | "waiting";

export interface PipelineStepLite {
  id: string;
  status: StepStatus;
  details?: string;
}

/**
 * Enforce sequential step visibility: a step can only be `running` if every
 * earlier non-skipped step is already `done`. Without this, independently
 * computed statuses (Clarification + Delivery Tasks both running, etc.) can
 * appear active at the same time.
 *
 * Mutates the input array in place. Returns the same reference.
 */
export function applySequentialStepGating<T extends PipelineStepLite>(steps: T[]): T[] {
  let blockedByEarlier = false;
  for (const s of steps) {
    if (blockedByEarlier && s.status === "running") {
      s.status = "waiting";
      s.details = undefined;
    }
    if (s.status !== "done" && s.status !== "skipped") {
      blockedByEarlier = true;
    }
  }
  return steps;
}

// ─── Artefact phase state ─────────────────────────────────────────────────

export type PhaseState = "generating" | "review" | "rejected" | "complete" | "empty";

export interface PhaseStateInput {
  approved: number;
  pending: number;
  rejected: number;
  total: number;
  generating: boolean;
}

/**
 * Classify the phase state shown in the artefacts banner.
 *
 * Critical rules:
 * - REJECTED takes precedence over `complete` — a phase with rejections
 *   cannot advance.
 * - `complete` requires every artefact APPROVED, not merely "no pending".
 *   Earlier the flag flipped true with 6 approved + 1 rejected because
 *   rejected isn't pending.
 */
export function classifyPhaseState(input: PhaseStateInput): PhaseState {
  const { approved, pending, rejected, total, generating } = input;
  if (generating) return "generating";
  if (total === 0) return "empty";
  if (rejected > 0) return "rejected";
  if (approved === total && pending === 0) return "complete";
  return "review";
}
