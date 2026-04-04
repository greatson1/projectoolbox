/**
 * Source Traceability & Confidence System
 *
 * Per spec Section 7.7: Every output includes full source citations.
 * Source Trust Hierarchy (5 tiers), Confidence Levels, and
 * Verified/Calculated/Inferred labels on every data point.
 *
 * Anti-Hallucination: The Zero-Hallucination Principle
 * - Only verified sources, explicit uncertainty when data is missing
 * - Visual labelling of every data point
 */

// ─── Source Trust Hierarchy (5 tiers) ───

export type SourceTrust = "AUTHORITATIVE" | "VERIFIED" | "CORROBORATED" | "SINGLE_SOURCE" | "INFERRED";

export interface SourceCitation {
  id: string;
  title: string;
  type: "project_data" | "document" | "email" | "transcript" | "research" | "user_input" | "calculation" | "inference";
  trust: SourceTrust;
  url?: string;
  date?: string;
  excerpt?: string;
}

export interface ConfidenceAssessment {
  level: "HIGH" | "MEDIUM" | "LOW";
  score: number; // 0-100
  reasons: string[];
  missingData?: string[]; // What data would improve confidence
}

export interface DataPointLabel {
  value: any;
  label: "VERIFIED" | "CALCULATED" | "INFERRED";
  source?: string;
  lastUpdated?: string;
}

/**
 * Source Trust Hierarchy — ranked from most to least trusted.
 * When sources conflict, escalate to human.
 *
 *   1. AUTHORITATIVE — Official project data (DB records, approved documents)
 *   2. VERIFIED — Multiple corroborating sources (2+ independent sources agree)
 *   3. CORROBORATED — Single source + supporting evidence
 *   4. SINGLE_SOURCE — One unverified source (email, verbal report, single web result)
 *   5. INFERRED — Agent's own analysis/calculation with no external backing
 */
export const SOURCE_TRUST_CONFIG: Record<SourceTrust, { rank: number; label: string; color: string; description: string }> = {
  AUTHORITATIVE: { rank: 1, label: "Authoritative", color: "#10B981", description: "Official project data — database records, approved documents" },
  VERIFIED: { rank: 2, label: "Verified", color: "#6366F1", description: "Multiple corroborating sources confirm this data" },
  CORROBORATED: { rank: 3, label: "Corroborated", color: "#22D3EE", description: "Single source with supporting evidence" },
  SINGLE_SOURCE: { rank: 4, label: "Single Source", color: "#F59E0B", description: "One unverified source — treat with caution" },
  INFERRED: { rank: 5, label: "Inferred", color: "#EF4444", description: "Agent analysis/calculation — no external verification" },
};

/**
 * Classify the trust level of a source.
 */
export function classifySourceTrust(source: {
  type: string;
  corroborations?: number; // How many other sources agree
  isProjectData?: boolean;
  isApproved?: boolean;
}): SourceTrust {
  // Tier 1: Official project data
  if (source.isProjectData || source.isApproved) return "AUTHORITATIVE";

  // Tier 2: Multiple sources agree
  if ((source.corroborations || 0) >= 2) return "VERIFIED";

  // Tier 3: One source with some supporting evidence
  if ((source.corroborations || 0) === 1) return "CORROBORATED";

  // Tier 4: Single external source
  if (source.type === "email" || source.type === "research" || source.type === "transcript") return "SINGLE_SOURCE";

  // Tier 5: Agent inference
  return "INFERRED";
}

/**
 * Assess confidence level for an agent recommendation.
 */
export function assessConfidence(params: {
  sourceCount: number;
  highestTrust: SourceTrust;
  dataCompleteness: number; // 0-1 (what % of needed data is available)
  historicalAccuracy?: number; // 0-1 (how accurate similar past recommendations were)
  missingFields?: string[];
}): ConfidenceAssessment {
  const reasons: string[] = [];
  const missingData: string[] = params.missingFields || [];
  let score = 50; // Start neutral

  // Source quality
  const trustRank = SOURCE_TRUST_CONFIG[params.highestTrust].rank;
  if (trustRank <= 2) { score += 20; reasons.push("Based on authoritative/verified sources"); }
  else if (trustRank === 3) { score += 10; reasons.push("Corroborated by supporting evidence"); }
  else if (trustRank === 4) { score += 0; reasons.push("Based on single unverified source"); }
  else { score -= 10; reasons.push("Based on inference — no external verification"); }

  // Source count
  if (params.sourceCount >= 3) { score += 15; reasons.push(`Supported by ${params.sourceCount} sources`); }
  else if (params.sourceCount >= 2) { score += 10; }
  else if (params.sourceCount === 1) { score -= 5; reasons.push("Only 1 source available"); }
  else { score -= 20; reasons.push("No external sources — agent inference only"); }

  // Data completeness
  if (params.dataCompleteness >= 0.9) { score += 15; reasons.push("All required data available"); }
  else if (params.dataCompleteness >= 0.7) { score += 5; }
  else if (params.dataCompleteness >= 0.5) { score -= 5; reasons.push(`${Math.round((1 - params.dataCompleteness) * 100)}% of required data missing`); }
  else { score -= 15; reasons.push("Significant data gaps — recommendation may be unreliable"); }

  // Historical accuracy
  if (params.historicalAccuracy !== undefined) {
    if (params.historicalAccuracy >= 0.9) { score += 10; reasons.push("High historical accuracy for similar recommendations"); }
    else if (params.historicalAccuracy < 0.7) { score -= 10; reasons.push("Low historical accuracy — past similar recommendations were often modified"); }
  }

  // Clamp score
  score = Math.max(10, Math.min(95, score));

  // Determine level
  const level = score >= 75 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW";

  // Add missing data reasons
  if (missingData.length > 0) {
    reasons.push(`Missing: ${missingData.join(", ")}`);
  }

  return { level, score, reasons, missingData: missingData.length > 0 ? missingData : undefined };
}

/**
 * Label a data point as Verified/Calculated/Inferred.
 * Used in chat responses, reports, and approval cards.
 */
export function labelDataPoint(params: {
  value: any;
  fromDatabase?: boolean;
  fromCalculation?: boolean;
  fromInference?: boolean;
  source?: string;
}): DataPointLabel {
  if (params.fromDatabase) {
    return { value: params.value, label: "VERIFIED", source: params.source || "Project database", lastUpdated: new Date().toISOString() };
  }
  if (params.fromCalculation) {
    return { value: params.value, label: "CALCULATED", source: params.source || "Derived from project data" };
  }
  return { value: params.value, label: "INFERRED", source: params.source || "Agent analysis" };
}

/**
 * Format source citations for inclusion in chat responses.
 * Returns markdown-formatted citation block.
 */
export function formatCitations(sources: SourceCitation[]): string {
  if (sources.length === 0) return "";

  const sorted = [...sources].sort((a, b) =>
    SOURCE_TRUST_CONFIG[a.trust].rank - SOURCE_TRUST_CONFIG[b.trust].rank
  );

  const lines = sorted.map((s, i) => {
    const trustConfig = SOURCE_TRUST_CONFIG[s.trust];
    const trustBadge = `[${trustConfig.label}]`;
    return `${i + 1}. ${trustBadge} ${s.title}${s.date ? ` (${s.date})` : ""}${s.url ? ` — ${s.url}` : ""}`;
  });

  return `\n\n**Sources:**\n${lines.join("\n")}`;
}

/**
 * Format confidence assessment for inclusion in outputs.
 */
export function formatConfidence(assessment: ConfidenceAssessment): string {
  const emoji = assessment.level === "HIGH" ? "🟢" : assessment.level === "MEDIUM" ? "🟡" : "🔴";
  return `${emoji} Confidence: **${assessment.level}** (${assessment.score}%) — ${assessment.reasons[0]}`;
}

/**
 * Detect source conflicts and recommend escalation.
 * Per spec: when sources disagree, escalate to human.
 */
export function detectSourceConflicts(sources: SourceCitation[]): {
  hasConflict: boolean;
  conflictDescription?: string;
} {
  // Group sources by trust tier
  const byTrust: Record<string, SourceCitation[]> = {};
  for (const s of sources) {
    if (!byTrust[s.trust]) byTrust[s.trust] = [];
    byTrust[s.trust].push(s);
  }

  // Check if higher-trust sources disagree with lower-trust ones
  const trustLevels = Object.keys(byTrust).sort((a, b) =>
    SOURCE_TRUST_CONFIG[a as SourceTrust].rank - SOURCE_TRUST_CONFIG[b as SourceTrust].rank
  );

  if (trustLevels.length > 1) {
    return {
      hasConflict: true,
      conflictDescription: `Sources at different trust levels: ${trustLevels.map(t => `${SOURCE_TRUST_CONFIG[t as SourceTrust].label} (${byTrust[t].length})`).join(" vs ")}. Recommend human review to resolve.`,
    };
  }

  return { hasConflict: false };
}

/**
 * Build uncertainty statement when data is missing.
 * Per spec: agent states exactly what's missing and asks rather than filling gaps.
 */
export function buildUncertaintyStatement(missingFields: string[]): string {
  if (missingFields.length === 0) return "";

  return `**Note:** This recommendation is incomplete because the following data is not available: ${missingFields.join(", ")}. ` +
    `I've made no assumptions about missing values. Please provide this data for a more accurate assessment, or confirm that I should proceed with the available information.`;
}
