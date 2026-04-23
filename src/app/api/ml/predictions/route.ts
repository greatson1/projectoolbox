/**
 * Public ML Predictions API
 *
 * GET /api/ml/predictions?kind=approval_likelihood&type=PHASE_GATE&urgency=HIGH
 * GET /api/ml/predictions?kind=risk_materialisation&riskId=cmXXX
 * GET /api/ml/predictions?kind=story_point_calibration
 * GET /api/ml/predictions?kind=impact_calibration&type=PHASE_GATE
 * GET /api/ml/predictions?kind=similar_projects&projectId=cmXXX&k=5
 *
 * Returns live predictions (not cached) unless ?cached=true.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const cached = url.searchParams.get("cached") === "true";

  if (!kind) return NextResponse.json({ error: "kind parameter required" }, { status: 400 });

  try {
    switch (kind) {
      case "approval_likelihood": {
        const type = url.searchParams.get("type") || "CHANGE_REQUEST";
        const urgency = url.searchParams.get("urgency") || undefined;
        const projectId = url.searchParams.get("projectId") || undefined;
        if (cached) {
          const row = await db.mLInsight.findFirst({
            where: { orgId, kind, subjectId: type },
            orderBy: { trainedAt: "desc" },
          });
          return NextResponse.json({ data: row });
        }
        const { predictApprovalLikelihood } = await import("@/lib/ml/approval-likelihood");
        const result = await predictApprovalLikelihood({ orgId, type, urgency, projectId });
        return NextResponse.json({ data: result });
      }

      case "risk_materialisation": {
        const riskId = url.searchParams.get("riskId");
        if (!riskId) return NextResponse.json({ error: "riskId required" }, { status: 400 });
        const risk = await db.risk.findFirst({
          where: { id: riskId, project: { orgId } },
          select: { category: true, probability: true, impact: true, score: true, projectId: true },
        });
        if (!risk) return NextResponse.json({ error: "Risk not found" }, { status: 404 });
        const { predictRiskMaterialisation } = await import("@/lib/ml/risk-materialisation");
        const result = await predictRiskMaterialisation({ orgId, ...risk });
        return NextResponse.json({ data: result });
      }

      case "risk_materialisation_bulk": {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
        const risks = await db.risk.findMany({
          where: { projectId, project: { orgId }, status: { in: ["OPEN", "open", "MITIGATING", "mitigating", "WATCHING", "watching"] } },
          select: { id: true, category: true, probability: true, impact: true, score: true },
        });
        const { predictRiskMaterialisation } = await import("@/lib/ml/risk-materialisation");
        const predictions = await Promise.all(
          risks.map(async (r) => ({ riskId: r.id, prediction: await predictRiskMaterialisation({ orgId, ...r }) })),
        );
        return NextResponse.json({ data: predictions });
      }

      case "story_point_calibration": {
        const assignee = url.searchParams.get("assignee") || undefined;
        const { predictStoryPointCalibration } = await import("@/lib/ml/story-point-calibration");
        const result = await predictStoryPointCalibration(orgId, assignee);
        return NextResponse.json({ data: result });
      }

      case "impact_calibration": {
        const type = url.searchParams.get("type") || "CHANGE_REQUEST";
        const { predictImpactCalibration } = await import("@/lib/ml/impact-calibration");
        const result = await predictImpactCalibration(orgId, type);
        return NextResponse.json({ data: result });
      }

      case "similar_projects": {
        const projectId = url.searchParams.get("projectId");
        const k = parseInt(url.searchParams.get("k") || "5", 10);
        if (projectId) {
          const project = await db.project.findFirst({
            where: { id: projectId, orgId },
            select: { id: true },
          });
          if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
          const { findSimilarProjects } = await import("@/lib/ml/similar-projects");
          const results = await findSimilarProjects(projectId, k);
          return NextResponse.json({ data: results });
        }
        // Free-text preview mode (deploy wizard): embed description + category + methodology directly
        const description = url.searchParams.get("description") || "";
        const category = url.searchParams.get("category") || "";
        const methodology = url.searchParams.get("methodology") || "";
        const name = url.searchParams.get("name") || "New project";
        if (!description && !category && !methodology) {
          return NextResponse.json({ error: "projectId or description required" }, { status: 400 });
        }
        const { findSimilarByText } = await import("@/lib/ml/similar-projects");
        const results = await findSimilarByText(orgId, { name, description, category, methodology }, k);
        return NextResponse.json({ data: results });
      }

      default:
        return NextResponse.json({ error: `Unknown kind: ${kind}` }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[ml/predictions] error:", e);
    return NextResponse.json({ error: e.message || "Prediction failed" }, { status: 500 });
  }
}
