/**
 * Decision Classification Engine
 *
 * Pure deterministic logic — no LLM calls. Scores each proposed action
 * across 4 dimensions and determines whether it can auto-execute or
 * must route to the HITL approval queue.
 *
 * Risk Score = Schedule + Cost + Scope + Stakeholder (range 4–16)
 *   LOW:      4–6   → auto-execute at L3+
 *   MEDIUM:   7–9   → auto-execute at L4+
 *   HIGH:    10–12  → auto-execute at L5 only
 *   CRITICAL: 13–16 → ALWAYS requires human approval
 */

// ─── Types ───

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ActionProposal {
  type: DecisionType;
  description: string;
  reasoning: string;
  confidence: number; // 0-1

  // Impact dimensions (1–4 each)
  scheduleImpact: number;   // 1=none, 2=≤1 week, 3=1–4 weeks, 4=>1 month or critical path
  costImpact: number;       // 1=none, 2=<5%, 3=5–15%, 4=>15%
  scopeImpact: number;      // 1=none, 2=minor adjustment, 3=deliverable modified, 4=deliverable added/removed
  stakeholderImpact: number; // 1=internal team only, 2=project team, 3=client/sponsor, 4=steering committee/board

  // Optional context
  affectedItems?: { type: string; id: string; title: string }[];
  suggestedAlternatives?: { description: string; impactScores?: Record<string, number>; creditCost?: number }[];
  creditCost?: number;
}

export type DecisionType =
  | "TASK_ASSIGNMENT"
  | "RISK_RESPONSE"
  | "SCHEDULE_CHANGE"
  | "RESOURCE_ALLOCATION"
  | "ESCALATION"
  | "BUDGET_CHANGE"
  | "SCOPE_CHANGE"
  | "COMMUNICATION"
  | "DOCUMENT_GENERATION"
  | "PHASE_GATE";

export interface DeploymentConfig {
  hitlPhaseGates: boolean;
  hitlBudgetChanges: boolean;
  hitlCommunications: boolean;
  autonomyConfig?: {
    budgetApprovalThreshold?: number;
    scopeChangeLimit?: number;
    autoApprovePhases?: string[];
    requireApprovalFor?: string[];
  };
}

export interface ClassificationResult {
  riskScore: number;       // 4–16
  riskTier: RiskTier;
  canAutoExecute: boolean;
  requiresApproval: boolean;
  approvalType: string;    // maps to ApprovalType enum
  urgency: string;         // LOW, MEDIUM, HIGH, CRITICAL
  impactScores: {
    schedule: number;
    cost: number;
    scope: number;
    stakeholder: number;
  };
}

// ─── Credit Costs per Action Type ───

export const CREDIT_COSTS: Record<string, number> = {
  TASK_ASSIGNMENT: 3,
  RISK_RESPONSE: 3,
  SCHEDULE_CHANGE: 3,
  RESOURCE_ALLOCATION: 3,
  BUDGET_CHANGE: 5,
  SCOPE_CHANGE: 5,
  ESCALATION: 1,
  COMMUNICATION: 5,
  DOCUMENT_GENERATION: 8,
  PHASE_GATE: 3,
  // Chat costs
  SIMPLE_QUERY: 1,
  DATA_ANALYSIS: 3,
  COMPLEX_ANALYSIS: 5,
  REPORT_GENERATION: 10,
  PROACTIVE_ALERT: 1,
};

// ─── Risk Tier Boundaries ───

function getRiskTier(score: number): RiskTier {
  if (score <= 6) return "LOW";
  if (score <= 9) return "MEDIUM";
  if (score <= 12) return "HIGH";
  return "CRITICAL";
}

// ─── Autonomy Level Thresholds ───
// Maps autonomy level → maximum risk tier that can be auto-executed

const AUTO_EXECUTE_THRESHOLDS: Record<number, { maxTier: RiskTier; allowedTypes?: DecisionType[] }> = {
  1: { maxTier: "LOW", allowedTypes: [] }, // L1: read-only, never auto-execute
  2: { maxTier: "LOW", allowedTypes: [] }, // L2: advisor, all recommendations go to HITL
  3: { maxTier: "LOW", allowedTypes: [   // L3: co-pilot, auto-execute LOW risk
    "TASK_ASSIGNMENT", "RISK_RESPONSE", "RESOURCE_ALLOCATION", "DOCUMENT_GENERATION",
  ]},
  4: { maxTier: "MEDIUM", allowedTypes: [ // L4: autonomous, auto-execute LOW + MEDIUM
    "TASK_ASSIGNMENT", "RISK_RESPONSE", "SCHEDULE_CHANGE", "RESOURCE_ALLOCATION",
    "COMMUNICATION", "DOCUMENT_GENERATION", "BUDGET_CHANGE",
  ]},
  5: { maxTier: "HIGH", allowedTypes: [   // L5: strategic, auto-execute LOW + MEDIUM + HIGH
    "TASK_ASSIGNMENT", "RISK_RESPONSE", "SCHEDULE_CHANGE", "RESOURCE_ALLOCATION",
    "COMMUNICATION", "DOCUMENT_GENERATION", "BUDGET_CHANGE", "SCOPE_CHANGE", "ESCALATION",
  ]},
};

// ─── Map DecisionType → ApprovalType ───

const DECISION_TO_APPROVAL_TYPE: Record<string, string> = {
  TASK_ASSIGNMENT: "RESOURCE",
  RISK_RESPONSE: "RISK_RESPONSE",
  SCHEDULE_CHANGE: "SCOPE_CHANGE",
  RESOURCE_ALLOCATION: "RESOURCE",
  BUDGET_CHANGE: "BUDGET",
  SCOPE_CHANGE: "SCOPE_CHANGE",
  COMMUNICATION: "COMMUNICATION",
  ESCALATION: "RISK_RESPONSE",
  DOCUMENT_GENERATION: "COMMUNICATION",
  PHASE_GATE: "PHASE_GATE",
};

// ─── Main Classifier ───

export function classifyDecision(
  proposal: ActionProposal,
  autonomyLevel: number,
  deploymentConfig: DeploymentConfig,
  globalPolicy?: { requireApprovalAbove?: string; maxAutonomyLevel?: number } | null,
): ClassificationResult {
  // Clamp impact scores to 1–4
  const schedule = Math.max(1, Math.min(4, Math.round(proposal.scheduleImpact)));
  const cost = Math.max(1, Math.min(4, Math.round(proposal.costImpact)));
  const scope = Math.max(1, Math.min(4, Math.round(proposal.scopeImpact)));
  const stakeholder = Math.max(1, Math.min(4, Math.round(proposal.stakeholderImpact)));

  const riskScore = schedule + cost + scope + stakeholder;
  const riskTier = getRiskTier(riskScore);

  const impactScores = { schedule, cost, scope, stakeholder };
  const approvalType = DECISION_TO_APPROVAL_TYPE[proposal.type] || "SCOPE_CHANGE";

  // Urgency mirrors risk tier
  const urgency = riskTier;

  // ── Apply global policy ceiling ──
  let effectiveLevel = autonomyLevel;
  if (globalPolicy?.maxAutonomyLevel && effectiveLevel > globalPolicy.maxAutonomyLevel) {
    effectiveLevel = globalPolicy.maxAutonomyLevel;
  }

  // ── CRITICAL always requires approval ──
  if (riskTier === "CRITICAL") {
    return { riskScore, riskTier, canAutoExecute: false, requiresApproval: true, approvalType, urgency, impactScores };
  }

  // ── HITL override checks (force approval regardless of score) ──
  if (proposal.type === "PHASE_GATE" && deploymentConfig.hitlPhaseGates) {
    return { riskScore, riskTier, canAutoExecute: false, requiresApproval: true, approvalType: "PHASE_GATE", urgency: "HIGH", impactScores };
  }
  if (proposal.type === "BUDGET_CHANGE" && deploymentConfig.hitlBudgetChanges) {
    return { riskScore, riskTier, canAutoExecute: false, requiresApproval: true, approvalType: "BUDGET", urgency, impactScores };
  }
  if (proposal.type === "COMMUNICATION" && deploymentConfig.hitlCommunications) {
    return { riskScore, riskTier, canAutoExecute: false, requiresApproval: true, approvalType: "COMMUNICATION", urgency, impactScores };
  }

  // ── Global policy override ──
  if (globalPolicy?.requireApprovalAbove) {
    const globalThreshold = getRiskTier(
      globalPolicy.requireApprovalAbove === "LOW" ? 7
      : globalPolicy.requireApprovalAbove === "MEDIUM" ? 10
      : globalPolicy.requireApprovalAbove === "HIGH" ? 13 : 4
    );
    const tiers: RiskTier[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    if (tiers.indexOf(riskTier) >= tiers.indexOf(globalThreshold)) {
      return { riskScore, riskTier, canAutoExecute: false, requiresApproval: true, approvalType, urgency, impactScores };
    }
  }

  // ── Autonomy level threshold check ──
  const threshold = AUTO_EXECUTE_THRESHOLDS[effectiveLevel];
  if (!threshold) {
    // Unknown level — require approval
    return { riskScore, riskTier, canAutoExecute: false, requiresApproval: true, approvalType, urgency, impactScores };
  }

  // Check if the risk tier is within the auto-execute ceiling
  const tierOrder: RiskTier[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const canTierAutoExecute = tierOrder.indexOf(riskTier) <= tierOrder.indexOf(threshold.maxTier);

  // Check if this action type is in the allowed list for this level
  const typeAllowed = !threshold.allowedTypes || threshold.allowedTypes.length === 0
    ? false // empty list = nothing allowed (L1, L2)
    : threshold.allowedTypes.includes(proposal.type);

  const canAutoExecute = canTierAutoExecute && typeAllowed;

  return {
    riskScore,
    riskTier,
    canAutoExecute,
    requiresApproval: !canAutoExecute,
    approvalType,
    urgency,
    impactScores,
  };
}

/**
 * Get the credit cost for a given action type.
 * Returns the cost from the lookup table, defaulting to 3.
 */
export function getActionCreditCost(type: string): number {
  return CREDIT_COSTS[type] || 3;
}

/**
 * Validate that an ActionProposal has all required fields.
 * Used to sanity-check LLM output before classification.
 */
export function validateProposal(proposal: any): proposal is ActionProposal {
  return (
    typeof proposal?.type === "string" &&
    typeof proposal?.description === "string" &&
    typeof proposal?.scheduleImpact === "number" &&
    typeof proposal?.costImpact === "number" &&
    typeof proposal?.scopeImpact === "number" &&
    typeof proposal?.stakeholderImpact === "number" &&
    proposal.scheduleImpact >= 1 && proposal.scheduleImpact <= 4 &&
    proposal.costImpact >= 1 && proposal.costImpact <= 4 &&
    proposal.scopeImpact >= 1 && proposal.scopeImpact <= 4 &&
    proposal.stakeholderImpact >= 1 && proposal.stakeholderImpact <= 4
  );
}
