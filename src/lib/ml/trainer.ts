/**
 * ML Trainer — Nightly job that recomputes all predictions and caches them
 * in the MLInsight table. Runs per-org for efficiency.
 *
 * Schedule: Vercel cron hits /api/cron/ml-train once per day.
 * For realtime predictions (not cached), call the predictor functions directly.
 */

import { db } from "@/lib/db";
import { predictApprovalLikelihood } from "./approval-likelihood";
import { predictImpactCalibration } from "./impact-calibration";
import { predictStoryPointCalibration } from "./story-point-calibration";
import { predictRiskMaterialisation } from "./risk-materialisation";
import { upsertProjectEmbedding } from "./similar-projects";

export interface TrainingReport {
  orgId: string;
  approvalBaselines: number;
  impactDeltas: number;
  storyPointModels: number;
  riskPredictions: number;
  embeddingsRefreshed: number;
  errors: string[];
}

/** Train all ML models for a single organisation. */
export async function trainOrgModels(orgId: string): Promise<TrainingReport> {
  const report: TrainingReport = {
    orgId,
    approvalBaselines: 0,
    impactDeltas: 0,
    storyPointModels: 0,
    riskPredictions: 0,
    embeddingsRefreshed: 0,
    errors: [],
  };

  // 1. Approval likelihood per action type (persist baseline rates)
  try {
    const actionTypes = ["PHASE_GATE", "CHANGE_REQUEST", "BUDGET", "RISK_RESPONSE", "SCOPE_CHANGE", "RESOURCE", "COMMUNICATION", "PROCUREMENT"];
    for (const type of actionTypes) {
      const result = await predictApprovalLikelihood({ orgId, type });
      await db.mLInsight.upsert({
        where: { id: `${orgId}-approval-${type}` },
        update: {
          score: result.probability,
          confidence: result.confidence,
          data: { reasoning: result.reasoning, sampleSize: result.sampleSize } as any,
          trainedAt: new Date(),
        },
        create: {
          id: `${orgId}-approval-${type}`,
          orgId,
          kind: "approval_likelihood",
          subjectType: "ApprovalType",
          subjectId: type,
          score: result.probability,
          confidence: result.confidence,
          data: { reasoning: result.reasoning, sampleSize: result.sampleSize } as any,
        },
      }).catch((e) => report.errors.push(`approval ${type}: ${e.message}`));
      report.approvalBaselines++;
    }
  } catch (e: any) { report.errors.push(`approval training: ${e.message}`); }

  // 2. Impact calibration per action type
  try {
    const types = ["PHASE_GATE", "CHANGE_REQUEST", "BUDGET", "SCOPE_CHANGE"];
    for (const type of types) {
      const cal = await predictImpactCalibration(orgId, type);
      if (cal.sampleSize === 0) continue;
      await db.mLInsight.upsert({
        where: { id: `${orgId}-impact-${type}` },
        update: {
          score: cal.confidence,
          confidence: cal.confidence,
          data: { deltas: cal.deltas, sampleSize: cal.sampleSize } as any,
          trainedAt: new Date(),
        },
        create: {
          id: `${orgId}-impact-${type}`,
          orgId,
          kind: "impact_calibration",
          subjectType: "ApprovalType",
          subjectId: type,
          score: cal.confidence,
          confidence: cal.confidence,
          data: { deltas: cal.deltas, sampleSize: cal.sampleSize } as any,
        },
      }).catch((e) => report.errors.push(`impact ${type}: ${e.message}`));
      report.impactDeltas++;
    }
  } catch (e: any) { report.errors.push(`impact training: ${e.message}`); }

  // 3. Story point calibration (org-wide + per key assignees)
  try {
    const cal = await predictStoryPointCalibration(orgId);
    if (cal.sampleSize > 0) {
      await db.mLInsight.upsert({
        where: { id: `${orgId}-storypoint-global` },
        update: {
          score: cal.multiplier,
          confidence: cal.confidence,
          data: { byAssignee: cal.byAssignee, sampleSize: cal.sampleSize } as any,
          trainedAt: new Date(),
        },
        create: {
          id: `${orgId}-storypoint-global`,
          orgId,
          kind: "story_point_calibration",
          subjectType: "Org",
          subjectId: orgId,
          score: cal.multiplier,
          confidence: cal.confidence,
          data: { byAssignee: cal.byAssignee, sampleSize: cal.sampleSize } as any,
        },
      }).catch((e) => report.errors.push(`storypoint: ${e.message}`));
      report.storyPointModels++;
    }
  } catch (e: any) { report.errors.push(`storypoint training: ${e.message}`); }

  // 4. Risk materialisation — score every OPEN risk in the org
  try {
    const openRisks = await db.risk.findMany({
      where: { status: "OPEN", project: { orgId } },
      select: { id: true, category: true, probability: true, impact: true, score: true },
      take: 200,
    });
    for (const risk of openRisks) {
      const pred = await predictRiskMaterialisation({
        orgId,
        category: risk.category,
        probability: risk.probability,
        impact: risk.impact,
        score: risk.score,
      });
      await db.mLInsight.upsert({
        where: { id: `${orgId}-risk-${risk.id}` },
        update: {
          score: pred.probability,
          confidence: pred.confidence,
          data: { reasoning: pred.reasoning, comparable: pred.comparable } as any,
          trainedAt: new Date(),
        },
        create: {
          id: `${orgId}-risk-${risk.id}`,
          orgId,
          kind: "risk_materialisation",
          subjectType: "Risk",
          subjectId: risk.id,
          score: pred.probability,
          confidence: pred.confidence,
          data: { reasoning: pred.reasoning, comparable: pred.comparable } as any,
        },
      }).catch((e) => report.errors.push(`risk ${risk.id}: ${e.message}`));
      report.riskPredictions++;
    }
  } catch (e: any) { report.errors.push(`risk training: ${e.message}`); }

  // 5. Project embeddings — refresh any projects that don't have one (or are >7 days old)
  try {
    const projects = await db.project.findMany({
      where: { orgId },
      select: { id: true, updatedAt: true },
    });
    for (const p of projects) {
      const existing = await db.projectEmbedding.findUnique({
        where: { projectId: p.id },
        select: { createdAt: true },
      }).catch(() => null);
      const needsRefresh = !existing || (Date.now() - existing.createdAt.getTime()) > 7 * 24 * 60 * 60 * 1000;
      if (needsRefresh) {
        await upsertProjectEmbedding(p.id);
        report.embeddingsRefreshed++;
      }
    }
  } catch (e: any) { report.errors.push(`embeddings training: ${e.message}`); }

  return report;
}

/** Train models for every active org. */
export async function trainAllOrgs(): Promise<TrainingReport[]> {
  const orgs = await db.organisation.findMany({ select: { id: true } });
  const reports: TrainingReport[] = [];
  for (const org of orgs) {
    try {
      reports.push(await trainOrgModels(org.id));
    } catch (e: any) {
      reports.push({
        orgId: org.id,
        approvalBaselines: 0, impactDeltas: 0, storyPointModels: 0,
        riskPredictions: 0, embeddingsRefreshed: 0,
        errors: [`training crashed: ${e.message}`],
      });
    }
  }
  return reports;
}
