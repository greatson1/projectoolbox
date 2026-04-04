import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { CreditService } from "@/lib/credits/service";

/**
 * POST /api/agents/:id/research — Trigger web research
 *
 * Types: "search", "pestle", "stakeholder", "vendor", "news"
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const { id: agentId } = await params;
  const body = await req.json();
  const { type, query, stakeholder, vendor } = body;

  if (!type) return NextResponse.json({ error: "Research type required" }, { status: 400 });

  // Determine credit cost
  const costs: Record<string, number> = { search: 3, pestle: 8, stakeholder: 5, vendor: 5, news: 3 };
  const cost = costs[type] || 3;

  const hasCredits = await CreditService.checkBalance(orgId, cost);
  if (!hasCredits) {
    return NextResponse.json({ error: `Insufficient credits. This research costs ${cost} credits.` }, { status: 402 });
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
