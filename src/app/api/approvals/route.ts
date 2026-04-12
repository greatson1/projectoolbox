import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/approvals — Pending approvals for user's org
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation — session may still be loading" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "PENDING";
  const type = searchParams.get("type");
  const priority = searchParams.get("priority");

  const where: any = {
    project: { orgId },
    ...(status !== "all" && { status }),
    ...(type && { type }),
  };

  const approvals = await db.approval.findMany({
    where,
    include: {
      project: true,
      assignedTo: true,
      decision: { include: { agent: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Resolve requestedById → agent (no FK relation — requestedById may be agentId or userId)
  // Also check impact.agentId and decision.agentId as fallbacks
  const candidateIds = [...new Set(approvals.flatMap(a => {
    const ids = [a.requestedById];
    const impact = a.impact as any;
    if (impact?.agentId) ids.push(impact.agentId);
    if (a.decision?.agentId) ids.push(a.decision.agentId);
    return ids;
  }).filter(Boolean))];

  const requestingAgents = candidateIds.length > 0
    ? await db.agent.findMany({ where: { id: { in: candidateIds } }, select: { id: true, name: true, gradient: true } })
    : [];
  const agentById = Object.fromEntries(requestingAgents.map(a => [a.id, a]));

  const enriched = approvals.map(a => {
    const impact = a.impact as any;
    const resolvedAgent = agentById[a.requestedById]
      || (impact?.agentId ? agentById[impact.agentId] : null)
      || a.decision?.agent
      || null;
    return { ...a, requestedByAgent: resolvedAgent };
  });

  return NextResponse.json({ data: enriched });
}
