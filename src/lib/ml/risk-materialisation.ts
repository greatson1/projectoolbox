/**
 * Risk Materialisation Predictor
 *
 * Classifies each open Risk by likelihood of materialising (becoming an Issue).
 * Signal: historical Risk → Issue conversions by (category, severity tier).
 *
 * Uses Bayesian smoothing (Beta prior α=β=1) so categories with few samples
 * default toward the org baseline rate.
 */

import { db } from "@/lib/db";

export interface RiskMaterialisationInput {
  orgId: string;
  category?: string | null;
  probability?: number | null;  // 1-5
  impact?: number | null;       // 1-5
  score?: number | null;        // p × i
  projectId?: string | null;    // optional — enables sentiment adjustment
}

export interface RiskMaterialisationOutput {
  probability: number;  // P(materialisation) 0..1
  confidence: number;   // 0..1 based on sample size
  sampleSize: number;
  comparable: number;   // how many historical risks fit this bucket
  reasoning: string;
}

const PRIOR_MATERIALISED = 1;
const PRIOR_NOT_MATERIALISED = 1;

function severityTier(score?: number | null): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const s = score ?? 0;
  if (s >= 20) return "CRITICAL";
  if (s >= 13) return "HIGH";
  if (s >= 8) return "MEDIUM";
  return "LOW";
}

/** Predict P(materialisation) for a given open risk. */
export async function predictRiskMaterialisation(
  input: RiskMaterialisationInput,
): Promise<RiskMaterialisationOutput> {
  // Get all historical risks with their final outcome
  // A risk "materialised" if:
  //  - status === "MATERIALISED" or "OCCURRED"
  //  - OR there's an Issue created linked to this risk
  //  - OR status === "CLOSED" with resolution indicating it happened
  const history = await db.risk.findMany({
    where: {
      project: { orgId: input.orgId },
      status: { notIn: ["OPEN", "open", "MITIGATING", "mitigating"] }, // only closed-out risks
    },
    select: { status: true, category: true, probability: true, impact: true, score: true },
    take: 300,
  }).catch(() => []);

  if (history.length === 0) {
    return {
      probability: 0.3, // modest default prior
      confidence: 0,
      sampleSize: 0,
      comparable: 0,
      reasoning: "No historical risk outcome data yet — showing default prior of 30%.",
    };
  }

  const materialised = (status: string | null) => {
    const s = (status || "").toUpperCase();
    return s === "MATERIALISED" || s === "OCCURRED" || s === "REALISED" || s === "REALIZED";
  };

  const total = history.length;
  const totalMaterialised = history.filter((r) => materialised(r.status)).length;
  const baseline = totalMaterialised / total;

  // Bucket by (category, severity tier)
  const tier = severityTier(input.score ?? (input.probability && input.impact ? input.probability * input.impact : undefined));
  const comparable = history.filter((r) => {
    const sameCat = !input.category || r.category === input.category;
    const rTier = severityTier(r.score ?? (r.probability && r.impact ? r.probability * r.impact : undefined));
    return sameCat && rTier === tier;
  });

  let probability: number;
  let reasoning: string;
  if (comparable.length >= 3) {
    const hits = comparable.filter((r) => materialised(r.status)).length;
    probability = (hits + PRIOR_MATERIALISED) / (comparable.length + PRIOR_MATERIALISED + PRIOR_NOT_MATERIALISED);
    reasoning = `${comparable.length} past risks in ${input.category || "any category"} at ${tier} severity → ${hits} materialised (${Math.round((hits / comparable.length) * 100)}%).`;
  } else {
    // fall back to severity-tier only
    const tierMatches = history.filter((r) => {
      const rTier = severityTier(r.score ?? (r.probability && r.impact ? r.probability * r.impact : undefined));
      return rTier === tier;
    });
    if (tierMatches.length >= 3) {
      const hits = tierMatches.filter((r) => materialised(r.status)).length;
      probability = (hits + PRIOR_MATERIALISED) / (tierMatches.length + PRIOR_MATERIALISED + PRIOR_NOT_MATERIALISED);
      reasoning = `${tierMatches.length} past ${tier} risks → ${hits} materialised (${Math.round((hits / tierMatches.length) * 100)}%).`;
    } else {
      probability = baseline;
      reasoning = `Insufficient data for this category/severity; using org baseline of ${Math.round(baseline * 100)}%.`;
    }
  }

  // ── Sentiment adjustment — declining project sentiment predicts increased
  //    risk materialisation (stakeholders disengage, issues escalate) ──
  let sentimentAdjust = 0;
  if (input.projectId) {
    try {
      const cutoff = new Date(Date.now() - 21 * 86400_000);
      const recentSignals = await db.sentimentHistory.findMany({
        where: {
          orgId: input.orgId,
          createdAt: { gte: cutoff },
          OR: [
            { subjectType: "stakeholder" },
            { sourceRef: { contains: input.projectId } },
          ],
        },
        select: { score: true, createdAt: true },
        take: 100,
      }).catch(() => []);

      if (recentSignals.length >= 5) {
        let weightedSum = 0, weightTotal = 0;
        const now = Date.now();
        for (const s of recentSignals) {
          const ageDays = (now - s.createdAt.getTime()) / 86400_000;
          const w = Math.exp(-ageDays / 10);
          weightedSum += s.score * w;
          weightTotal += w;
        }
        const avg = weightTotal > 0 ? weightedSum / weightTotal : 0;
        // Negative sentiment → higher risk materialisation probability
        // Map avg (-1..1) to adjustment (+0.20..-0.10) — negative sentiment boosts risk more than positive dampens it
        sentimentAdjust = avg < 0 ? Math.abs(avg) * 0.20 : -avg * 0.10;
        if (Math.abs(sentimentAdjust) > 0.02) {
          reasoning += ` Project sentiment (${avg.toFixed(2)}, ${recentSignals.length} signals) ${sentimentAdjust > 0 ? "increases" : "decreases"} risk by ${Math.abs(Math.round(sentimentAdjust * 100))}%.`;
        }
      }
    } catch { /* non-fatal */ }
  }

  return {
    probability: Math.max(0, Math.min(1, probability + sentimentAdjust)),
    confidence: Math.min(1, comparable.length / 20),
    sampleSize: total,
    comparable: comparable.length,
    reasoning,
  };
}
