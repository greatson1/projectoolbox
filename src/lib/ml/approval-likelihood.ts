/**
 * Approval Likelihood Predictor
 *
 * Given an approval proposal, predict P(approval) based on historical decisions
 * in the same org. Uses Bayesian smoothing to avoid overfitting to low counts.
 *
 * Signal: (action type × risk tier × urgency) → approval rate
 * Smoothed via Dirichlet prior (α=2 approved, β=2 rejected) so predictions
 * start at 50% and converge to the true rate as data accumulates.
 */

import { db } from "@/lib/db";

export interface ApprovalLikelihoodInput {
  orgId: string;
  type: string;      // ApprovalType
  urgency?: string;  // LOW, MEDIUM, HIGH, CRITICAL
  impactScores?: { schedule?: number; cost?: number; scope?: number; stakeholder?: number };
}

export interface ApprovalLikelihoodOutput {
  probability: number;   // 0..1
  confidence: number;    // 0..1 based on sample size
  sampleSize: number;
  reasoning: string[];   // human-readable factors
}

const PRIOR_APPROVED = 2;
const PRIOR_REJECTED = 2;

/** Compute P(approval) for a proposed approval using historical data. */
export async function predictApprovalLikelihood(
  input: ApprovalLikelihoodInput,
): Promise<ApprovalLikelihoodOutput> {
  // Fetch all resolved approvals in this org
  const history = await db.approval.findMany({
    where: {
      project: { orgId: input.orgId },
      status: { in: ["APPROVED", "REJECTED"] },
    },
    select: { type: true, urgency: true, impactScores: true, status: true },
  });

  if (history.length === 0) {
    return {
      probability: 0.5,
      confidence: 0,
      sampleSize: 0,
      reasoning: ["No historical approval data yet — prediction will improve as users approve/reject over time."],
    };
  }

  const reasoning: string[] = [];

  // Overall rate
  const overallApproved = history.filter((h) => h.status === "APPROVED").length;
  const overallRate = overallApproved / history.length;
  reasoning.push(`Org baseline: ${Math.round(overallRate * 100)}% of ${history.length} past approvals were accepted.`);

  // Rate by action type
  const typeMatches = history.filter((h) => h.type === input.type);
  const typeRate = typeMatches.length > 0
    ? (typeMatches.filter((h) => h.status === "APPROVED").length + PRIOR_APPROVED) /
      (typeMatches.length + PRIOR_APPROVED + PRIOR_REJECTED)
    : overallRate;
  if (typeMatches.length > 0) {
    reasoning.push(`${input.type} type: ${Math.round(typeRate * 100)}% approval rate (${typeMatches.length} samples).`);
  }

  // Rate by urgency
  let urgencyRate = overallRate;
  if (input.urgency) {
    const urgencyMatches = history.filter((h) => h.urgency === input.urgency);
    if (urgencyMatches.length > 0) {
      urgencyRate = (urgencyMatches.filter((h) => h.status === "APPROVED").length + PRIOR_APPROVED) /
        (urgencyMatches.length + PRIOR_APPROVED + PRIOR_REJECTED);
      reasoning.push(`${input.urgency} urgency: ${Math.round(urgencyRate * 100)}% approval rate.`);
    }
  }

  // Rate by combined risk tier (derived from impact scores)
  let tierRate = overallRate;
  const totalImpact = input.impactScores
    ? (input.impactScores.schedule ?? 0) + (input.impactScores.cost ?? 0) +
      (input.impactScores.scope ?? 0) + (input.impactScores.stakeholder ?? 0)
    : 0;
  if (totalImpact > 0) {
    const tier = totalImpact >= 13 ? "CRITICAL" : totalImpact >= 10 ? "HIGH" : totalImpact >= 7 ? "MEDIUM" : "LOW";
    const tierMatches = history.filter((h) => {
      const scores = (h.impactScores as any) || {};
      const sum = (scores.schedule ?? 0) + (scores.cost ?? 0) + (scores.scope ?? 0) + (scores.stakeholder ?? 0);
      const histTier = sum >= 13 ? "CRITICAL" : sum >= 10 ? "HIGH" : sum >= 7 ? "MEDIUM" : "LOW";
      return histTier === tier;
    });
    if (tierMatches.length > 0) {
      tierRate = (tierMatches.filter((h) => h.status === "APPROVED").length + PRIOR_APPROVED) /
        (tierMatches.length + PRIOR_APPROVED + PRIOR_REJECTED);
      reasoning.push(`${tier} risk tier: ${Math.round(tierRate * 100)}% approval rate.`);
    }
  }

  // Weighted blend: type is strongest signal, then tier, then urgency, then baseline
  const probability =
    0.45 * typeRate +
    0.25 * tierRate +
    0.20 * urgencyRate +
    0.10 * overallRate;

  // Confidence scales with sample size, capped at 1.0 by 50 samples
  const confidence = Math.min(1, history.length / 50);

  return {
    probability: Math.max(0, Math.min(1, probability)),
    confidence,
    sampleSize: history.length,
    reasoning,
  };
}
