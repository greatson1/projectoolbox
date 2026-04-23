/**
 * Impact Score Calibration
 *
 * Claude proposes impact scores (schedule/cost/scope/stakeholder) for each
 * approval. Users often adjust these. This module learns the correction
 * factors per action type so future proposals come pre-calibrated.
 *
 * We track (proposed, final) pairs in AuditLog metadata. This predictor
 * returns a delta to add to Claude's proposed scores.
 */

import { db } from "@/lib/db";

type Dimension = "schedule" | "cost" | "scope" | "stakeholder";

export interface ImpactCalibrationOutput {
  deltas: Record<Dimension, number>; // add these to Claude's proposed scores
  sampleSize: number;
  confidence: number;
}

/** Learn org-specific impact score deltas per action type. */
export async function predictImpactCalibration(
  orgId: string,
  actionType: string,
): Promise<ImpactCalibrationOutput> {
  // Pull approvals where we have both agent-proposed and human-edited impact scores
  // Agent-proposed scores live in the original impactScores; edits change them.
  // Use AuditLog.dataSnapshot for before/after when available.
  const auditedEdits = await db.auditLog.findMany({
    where: {
      orgId,
      action: { contains: "approval" },
      entityType: "approval",
    },
    select: { details: true, dataSnapshot: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  }).catch(() => []);

  if (auditedEdits.length === 0) {
    return {
      deltas: { schedule: 0, cost: 0, scope: 0, stakeholder: 0 },
      sampleSize: 0,
      confidence: 0,
    };
  }

  const dims: Dimension[] = ["schedule", "cost", "scope", "stakeholder"];
  const deltas: Record<Dimension, number[]> = {
    schedule: [], cost: [], scope: [], stakeholder: [],
  };

  for (const audit of auditedEdits) {
    const snapshot = (audit.dataSnapshot as any) || {};
    const before = snapshot.before?.impactScores || snapshot.proposed;
    const after = snapshot.after?.impactScores || snapshot.final;
    if (!before || !after) continue;

    for (const d of dims) {
      const b = Number(before[d]);
      const a = Number(after[d]);
      if (!isNaN(b) && !isNaN(a) && b !== a) {
        deltas[d].push(a - b); // positive = user increased, negative = user decreased
      }
    }
  }

  const result: Record<Dimension, number> = { schedule: 0, cost: 0, scope: 0, stakeholder: 0 };
  let totalSamples = 0;
  for (const d of dims) {
    if (deltas[d].length > 0) {
      const mean = deltas[d].reduce((s, v) => s + v, 0) / deltas[d].length;
      result[d] = Math.round(mean * 10) / 10; // 1 decimal
      totalSamples += deltas[d].length;
    }
  }

  return {
    deltas: result,
    sampleSize: totalSamples,
    confidence: Math.min(1, totalSamples / 40),
  };
}

/** Apply calibration deltas to a set of proposed scores. */
export function applyImpactCalibration(
  proposed: { schedule: number; cost: number; scope: number; stakeholder: number },
  deltas: Record<Dimension, number>,
) {
  const clamp = (v: number) => Math.max(1, Math.min(4, Math.round(v)));
  return {
    schedule: clamp(proposed.schedule + deltas.schedule),
    cost: clamp(proposed.cost + deltas.cost),
    scope: clamp(proposed.scope + deltas.scope),
    stakeholder: clamp(proposed.stakeholder + deltas.stakeholder),
  };
}
