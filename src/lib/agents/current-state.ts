/**
 * Single source of truth for "what is the agent currently doing?"
 *
 * All UI surfaces (pipeline, status bar, agent detail, chat prompt) should
 * call this helper instead of deriving state independently — that's what
 * caused the observed inconsistency (pipeline saying "researching" while
 * chat said "developing artefacts").
 *
 * State priority (highest to lowest):
 *   1. blocked_tasks_incomplete     → BLOCKED
 *   2. awaiting_clarification + active session → QUESTIONS_WAITING
 *   3. researching                   → RESEARCHING
 *   4. pending_approval / waiting_approval → AWAITING_APPROVAL
 *   5. active + draft artefacts      → REVIEW
 *   6. active + generating now       → GENERATING
 *   7. active + all approved, no next phase → COMPLETE
 *   8. active (default)              → MONITORING
 */

export type AgentCurrentState =
  | "blocked"
  | "questions_waiting"
  | "researching"
  | "awaiting_approval"
  | "generating"
  | "review"
  | "monitoring"
  | "complete"
  | "idle";

export interface StateInput {
  phaseStatus: string | null | undefined;
  hasActiveClarificationSession: boolean;
  draftArtefactCount: number;
  approvedArtefactCount: number;
  totalArtefactsInPhase: number;
  hasPendingPhaseGate: boolean;
  hasActiveDeployment: boolean;
  hasNextPhase: boolean;
  minutesSinceLastArtefact: number | null;
}

export interface StateResult {
  state: AgentCurrentState;
  label: string;          // Short uppercase label (for badges)
  friendlyLabel: string;  // Sentence-case (for chat)
  priority: number;       // 0 = highest urgency
  isPulsing: boolean;     // Should the animated pulse run?
}

export function getAgentCurrentState(input: StateInput): StateResult {
  if (!input.hasActiveDeployment) {
    return { state: "idle", label: "IDLE", friendlyLabel: "Idle", priority: 9, isPulsing: false };
  }

  // 1. Blocked — explicit system state
  if (input.phaseStatus === "blocked_tasks_incomplete") {
    return {
      state: "blocked",
      label: "BLOCKED",
      friendlyLabel: "Blocked on outstanding tasks",
      priority: 0,
      isPulsing: false,
    };
  }

  // 2. Awaiting clarification — active session
  if (input.hasActiveClarificationSession || input.phaseStatus === "awaiting_clarification") {
    return {
      state: "questions_waiting",
      label: "QUESTIONS WAITING",
      friendlyLabel: "Waiting for your answers",
      priority: 1,
      isPulsing: true,
    };
  }

  // 3. Researching
  if (input.phaseStatus === "researching") {
    return {
      state: "researching",
      label: "RESEARCHING",
      friendlyLabel: "Running research",
      priority: 2,
      isPulsing: true,
    };
  }

  // 4. Waiting for approval
  if (input.phaseStatus === "pending_approval" || input.phaseStatus === "waiting_approval" || input.hasPendingPhaseGate) {
    return {
      state: "awaiting_approval",
      label: "AWAITING APPROVAL",
      friendlyLabel: "Awaiting phase gate approval",
      priority: 3,
      isPulsing: false,
    };
  }

  // 5. Draft artefacts pending review
  if (input.draftArtefactCount > 0) {
    return {
      state: "review",
      label: "REVIEW",
      friendlyLabel: `${input.draftArtefactCount} document${input.draftArtefactCount === 1 ? "" : "s"} ready for review`,
      priority: 4,
      isPulsing: false,
    };
  }

  // 6. Active generation — recent artefact activity
  const isGeneratingNow = input.phaseStatus === "active"
    && input.minutesSinceLastArtefact !== null
    && input.minutesSinceLastArtefact <= 5;
  if (isGeneratingNow) {
    return {
      state: "generating",
      label: "GENERATING",
      friendlyLabel: "Generating artefacts",
      priority: 5,
      isPulsing: true,
    };
  }

  // 7. Complete
  if ((input.phaseStatus === "complete" || !input.hasNextPhase)
      && input.approvedArtefactCount > 0
      && input.totalArtefactsInPhase === input.approvedArtefactCount) {
    return {
      state: "complete",
      label: "COMPLETE",
      friendlyLabel: "All phases complete",
      priority: 7,
      isPulsing: false,
    };
  }

  // 8. Default: monitoring
  return {
    state: "monitoring",
    label: "MONITORING",
    friendlyLabel: "Monitoring project",
    priority: 6,
    isPulsing: false,
  };
}
