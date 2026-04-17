import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";
import { CreditService, orgCanUseFeature } from "@/lib/credits/service";
import { CREDIT_COSTS, insufficientPlanResponse } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/:id/research — Trigger web research
 *
 * Types: "search", "pestle", "stakeholder", "vendor", "news"
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = caller.orgId;
  const { id: agentId } = await params;
  const body = await req.json();
  const { type, query, stakeholder, vendor, items, roles, createArtefact } = body;

  if (!type) return NextResponse.json({ error: "Research type required" }, { status: 400 });

  // ── Plan gate: web research requires Starter or above ───────────────────
  const canResearch = await orgCanUseFeature(orgId, "perplexityResearch");
  if (!canResearch) {
    return NextResponse.json(insufficientPlanResponse("perplexityResearch"), { status: 403 });
  }

  // Determine credit cost — Perplexity calls are metered at PERPLEXITY_RESEARCH per call
  const costs: Record<string, number> = {
    search: CREDIT_COSTS.PERPLEXITY_RESEARCH,
    pestle: CREDIT_COSTS.PERPLEXITY_RESEARCH * 2,  // PESTLE does 6 scans
    stakeholder: CREDIT_COSTS.PERPLEXITY_RESEARCH,
    vendor: CREDIT_COSTS.PERPLEXITY_RESEARCH,
    news: CREDIT_COSTS.PERPLEXITY_RESEARCH,
    procurement: CREDIT_COSTS.PERPLEXITY_RESEARCH,
    resource_rates: CREDIT_COSTS.PERPLEXITY_RESEARCH,
  };
  const cost = costs[type] || CREDIT_COSTS.PERPLEXITY_RESEARCH;

  const hasCredits = await CreditService.checkBalance(orgId, cost);
  if (!hasCredits) {
    return NextResponse.json({ error: `Insufficient credits. This research costs ${cost} credits.`, code: "INSUFFICIENT_CREDITS", upgradeUrl: "/billing" }, { status: 402 });
  }

  // Get project context
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    include: { project: { select: { id: true, name: true, methodology: true, category: true } } },
  });

  const context = { orgId, agentId, projectId: deployment?.projectId };

  try {
    const {
      targetedSearch, pestleScan, stakeholderResearch, vendorResearch, newsMonitor, pestleToRisks,
      procurementResearch, procurementToArtefact, resourceRatesResearch,
    } = await import("@/lib/agents/web-research");

    let result: any;

    switch (type) {
      case "search":
        if (!query) return NextResponse.json({ error: "Query required" }, { status: 400 });
        result = await targetedSearch(query, context);
        break;

      case "pestle":
        const pestleResult = await pestleScan({
          name: deployment?.project?.name || "Project",
          industry: deployment?.project?.category || undefined,
        }, context);

        // Auto-convert findings to risks
        if (deployment?.projectId) {
          const riskResult = await pestleToRisks(pestleResult.findings, deployment.projectId, agentId);
          result = { ...pestleResult, risksCreated: riskResult.risksCreated, risksUpdated: riskResult.risksUpdated };
        } else {
          result = pestleResult;
        }
        break;

      case "stakeholder":
        if (!stakeholder?.name) return NextResponse.json({ error: "Stakeholder name required" }, { status: 400 });
        result = await stakeholderResearch(stakeholder, context);
        break;

      case "vendor":
        if (!vendor?.name) return NextResponse.json({ error: "Vendor name required" }, { status: 400 });
        result = await vendorResearch(vendor, context);
        break;

      case "news":
        result = await newsMonitor({
          name: deployment?.project?.name || "Project",
          industry: deployment?.project?.category || undefined,
        }, context);
        break;

      case "resource_rates":
        if (!roles || !Array.isArray(roles) || roles.length === 0) {
          return NextResponse.json({ error: "Roles list required (array of { title, location?, type?, seniority? })" }, { status: 400 });
        }
        result = await resourceRatesResearch(roles, {
          name: deployment?.project?.name || "Project",
          region: "UK",
          industry: deployment?.project?.category || undefined,
        }, context);
        break;

      case "procurement":
        if (!items || !Array.isArray(items) || items.length === 0) {
          return NextResponse.json({ error: "Items list required (array of { name, quantity?, specs? })" }, { status: 400 });
        }
        const procResult = await procurementResearch(items, {
          name: deployment?.project?.name || "Project",
          region: "UK",
          industry: deployment?.project?.category || undefined,
        }, context);

        // Optionally create artefact and cost entries
        if (createArtefact && deployment?.projectId && procResult.items.length > 0) {
          const artefactResult = await procurementToArtefact(
            procResult.items, procResult.csv, deployment.projectId, agentId,
          );
          result = { ...procResult, artefactId: artefactResult.artefactId, costEntriesCreated: artefactResult.costEntriesCreated };
        } else {
          result = procResult;
        }
        break;

      default:
        return NextResponse.json({ error: "Invalid research type" }, { status: 400 });
    }

    // Deduct credits (cached results cost 1)
    const actualCost = result.cached ? 1 : cost;
    await CreditService.deduct(orgId, actualCost, `Research: ${type}${query ? ` — ${query.slice(0, 50)}` : ""}`, agentId);

    return NextResponse.json({ data: result });
  } catch (e: any) {
    console.error("Research error:", e);
    return NextResponse.json({ error: e.message || "Research failed" }, { status: 500 });
  }
}
