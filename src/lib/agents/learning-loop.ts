/**
 * Machine Learning / Continuous Improvement Loop
 *
 * Per spec Section 7.7: The agent learns from every approve/reject/modify cycle.
 * - Decision feedback loop (every outcome stored with context)
 * - Calibration from human modifications
 * - Active learning requests (agent asks for guidance where it's weakest)
 * - Guardrails that prevent learning from pushing into unsafe behaviour
 */

import { db } from "@/lib/db";

interface CalibrationResult {
  adjustments: CalibrationAdjustment[];
  activeLearningQuestions: string[];
  overallAccuracy: number;
}

interface CalibrationAdjustment {
  actionType: string;
  direction: "increase_caution" | "maintain" | "increase_confidence";
  reason: string;
  newThreshold?: string; // e.g. "Route COMMUNICATION to HITL even at L4"
}

/**
 * Analyse the agent's decision history and produce calibration adjustments.
 * Called after each project phase completes or on-demand.
 */
export async function runCalibrationLoop(agentId: string): Promise<CalibrationResult> {
  const adjustments: CalibrationAdjustment[] = [];
  const questions: string[] = [];

  // Get all decisions for this agent
  const decisions = await db.agentDecision.findMany({
    where: { agentId },
    include: { approval: { select: { status: true, comment: true, type: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  if (decisions.length < 5) {
    return { adjustments: [], activeLearningQuestions: ["Not enough decisions to calibrate (need 5+)"], overallAccuracy: 100 };
  }

  // ── 1. Rejection pattern analysis ──
  // Group decisions by type and count outcomes
  const byType: Record<string, { approved: number; rejected: number; deferred: number; autoApproved: number }> = {};

  for (const d of decisions) {
    const type = d.type;
    if (!byType[type]) byType[type] = { approved: 0, rejected: 0, deferred: 0, autoApproved: 0 };

    if (d.status === "APPROVED") byType[type].approved++;
    else if (d.status === "REJECTED") byType[type].rejected++;
    else if (d.status === "DEFERRED") byType[type].deferred++;
    else if (d.status === "AUTO_APPROVED") byType[type].autoApproved++;
  }

  for (const [type, counts] of Object.entries(byType)) {
    const total = counts.approved + counts.rejected + counts.deferred;
    if (total < 3) continue; // Not enough data for this type

    const rejectionRate = counts.rejected / total;
    const deferralRate = counts.deferred / total;

    // If >40% rejection rate: increase caution
    if (rejectionRate > 0.4) {
      adjustments.push({
        actionType: type,
        direction: "increase_caution",
        reason: `${Math.round(rejectionRate * 100)}% of ${type} decisions were rejected (${counts.rejected}/${total}). Routing this action type to HITL by default.`,
        newThreshold: `Force HITL for ${type} regardless of autonomy level`,
      });
    }
    // If >30% deferral rate: agent's proposals need refinement
    else if (deferralRate > 0.3) {
      adjustments.push({
        actionType: type,
        direction: "increase_caution",
        reason: `${Math.round(deferralRate * 100)}% of ${type} decisions required changes (${counts.deferred}/${total}). Agent recommendations need refinement for this action type.`,
      });

      // Generate active learning question
      questions.push(`For ${type.replace(/_/g, " ").toLowerCase()} actions: what criteria should I prioritise when making recommendations? ${counts.deferred} of my last ${total} proposals were sent back for changes.`);
    }
    // If >90% approval rate with many auto-approvals: maintaining well
    else if (counts.approved / total > 0.9) {
      adjustments.push({
        actionType: type,
        direction: "maintain",
        reason: `${Math.round((counts.approved / total) * 100)}% approval rate for ${type} — calibration is accurate.`,
      });
    }
  }

  // ── 2. Feedback content analysis ──
  // Look for patterns in deferral comments
  const deferredDecisions = decisions.filter(d => d.status === "DEFERRED" && d.approval?.comment);
  const feedbackKeywords: Record<string, number> = {};

  for (const d of deferredDecisions) {
    const comment = (d.approval?.comment || "").toLowerCase();
    const keywords = ["cost", "budget", "schedule", "scope", "stakeholder", "risk", "too aggressive", "too conservative", "wrong", "missing"];
    for (const kw of keywords) {
      if (comment.includes(kw)) feedbackKeywords[kw] = (feedbackKeywords[kw] || 0) + 1;
    }
  }

  const topFeedbackIssues = Object.entries(feedbackKeywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (topFeedbackIssues.length > 0) {
    questions.push(
      `The most common feedback themes when my recommendations are sent back are: ${topFeedbackIssues.map(([k, v]) => `"${k}" (${v}x)`).join(", ")}. Can you help me understand what I should adjust?`
    );
  }

  // ── 3. Overall accuracy ──
  const totalDecisions = decisions.length;
  const successfulDecisions = decisions.filter(d => d.status === "APPROVED" || d.status === "AUTO_APPROVED").length;
  const overallAccuracy = Math.round((successfulDecisions / totalDecisions) * 100);

  // ── 4. Safety guardrail ──
  // Never let learning push the agent into auto-approving CRITICAL actions
  // or bypassing HITL for phase gates/budget
  adjustments.push({
    actionType: "_SAFETY_GUARDRAIL",
    direction: "maintain",
    reason: "Safety: CRITICAL actions, phase gates, and budget changes >10% always require HITL regardless of learning adjustments.",
  });

  // ── 5. Save calibration results to knowledge base ──
  await db.knowledgeBaseItem.create({
    data: {
      orgId: (await db.agent.findUnique({ where: { id: agentId }, select: { orgId: true } }))?.orgId || "",
      agentId,
      layer: "AGENT",
      type: "DECISION",
      title: `Calibration Report — ${new Date().toISOString().slice(0, 10)}`,
      content: JSON.stringify({ adjustments, questions, overallAccuracy, totalDecisions, analyzedAt: new Date().toISOString() }),
      tags: ["calibration", "auto-generated", "learning"],
    },
  });

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "proactive_alert",
      summary: `Self-calibration complete: ${overallAccuracy}% overall accuracy across ${totalDecisions} decisions. ${adjustments.filter(a => a.direction === "increase_caution").length} action types flagged for increased caution.`,
      metadata: { type: "calibration", accuracy: overallAccuracy, adjustments: adjustments.length },
    },
  });

  return { adjustments, activeLearningQuestions: questions, overallAccuracy };
}

/**
 * Check if the agent should override its autonomy level for a specific action type
 * based on learned calibration data.
 */
export async function shouldForceHitl(agentId: string, actionType: string): Promise<boolean> {
  // Check the most recent calibration report
  const latestCalibration = await db.knowledgeBaseItem.findFirst({
    where: {
      agentId,
      type: "DECISION",
      tags: { has: "calibration" },
    },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });

  if (!latestCalibration) return false;

  try {
    const data = JSON.parse(latestCalibration.content);
    const adjustment = data.adjustments?.find(
      (a: CalibrationAdjustment) => a.actionType === actionType && a.direction === "increase_caution"
    );
    return !!adjustment;
  } catch {
    return false;
  }
}

/**
 * Get active learning questions for display in the agent's chat or dashboard.
 */
export async function getActiveLearningQuestions(agentId: string): Promise<string[]> {
  const latestCalibration = await db.knowledgeBaseItem.findFirst({
    where: {
      agentId,
      type: "DECISION",
      tags: { has: "calibration" },
    },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });

  if (!latestCalibration) return [];

  try {
    const data = JSON.parse(latestCalibration.content);
    return data.questions || [];
  } catch {
    return [];
  }
}
