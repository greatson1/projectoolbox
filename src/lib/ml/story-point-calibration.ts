/**
 * Story Point Calibration
 *
 * Agile teams estimate story points (or hours) then record actual hours.
 * Teams are consistently optimistic or pessimistic by a learnable factor.
 *
 * This predictor returns a multiplier:
 *   multiplier > 1.0 → team under-estimates, scale up new estimates
 *   multiplier < 1.0 → team over-estimates, scale down
 *   multiplier = 1.0 → well calibrated
 *
 * Computed per-assignee when enough data exists, else org-wide average.
 */

import { db } from "@/lib/db";

export interface StoryPointCalibrationOutput {
  multiplier: number;       // apply to raw estimate to get calibrated estimate
  sampleSize: number;
  confidence: number;
  byAssignee?: Record<string, { multiplier: number; samples: number }>;
}

const MIN_SAMPLES_FOR_ASSIGNEE = 5;
const MAX_MULTIPLIER = 3.0; // clamp to prevent wild corrections

/** Learn estimate correction factor from estimated vs actual hours. */
export async function predictStoryPointCalibration(
  orgId: string,
  assigneeName?: string,
): Promise<StoryPointCalibrationOutput> {
  const completed = await db.task.findMany({
    where: {
      project: { orgId },
      status: { in: ["DONE", "completed"] },
      estimatedHours: { not: null, gt: 0 },
      actualHours: { not: null, gt: 0 },
    },
    select: { estimatedHours: true, actualHours: true, assigneeName: true },
    take: 500,
  }).catch(() => []);

  if (completed.length === 0) {
    return { multiplier: 1.0, sampleSize: 0, confidence: 0 };
  }

  // Per-assignee breakdown
  const byAssignee: Record<string, { ratios: number[] }> = {};
  const allRatios: number[] = [];

  for (const task of completed) {
    const est = task.estimatedHours!;
    const actual = task.actualHours!;
    if (est <= 0 || actual <= 0) continue;
    const ratio = actual / est;
    if (ratio > MAX_MULTIPLIER || ratio < 1 / MAX_MULTIPLIER) continue; // outlier
    allRatios.push(ratio);
    const name = task.assigneeName || "__unknown__";
    if (!byAssignee[name]) byAssignee[name] = { ratios: [] };
    byAssignee[name].ratios.push(ratio);
  }

  const summarise = (ratios: number[]) => ({
    multiplier: ratios.length > 0 ? ratios.reduce((s, r) => s + r, 0) / ratios.length : 1.0,
    samples: ratios.length,
  });

  const assigneeMap: Record<string, { multiplier: number; samples: number }> = {};
  for (const [name, { ratios }] of Object.entries(byAssignee)) {
    if (ratios.length >= MIN_SAMPLES_FOR_ASSIGNEE) {
      assigneeMap[name] = summarise(ratios);
    }
  }

  // Pick multiplier: specific assignee if we have one, else org-wide
  let multiplier = summarise(allRatios).multiplier;
  if (assigneeName && assigneeMap[assigneeName]) {
    multiplier = assigneeMap[assigneeName].multiplier;
  }

  return {
    multiplier: Math.round(multiplier * 100) / 100,
    sampleSize: allRatios.length,
    confidence: Math.min(1, allRatios.length / 30),
    byAssignee: assigneeMap,
  };
}

/** Apply calibration to a raw estimate. */
export function applyStoryPointCalibration(
  rawEstimateHours: number,
  multiplier: number,
): number {
  return Math.round(rawEstimateHours * multiplier * 10) / 10;
}
