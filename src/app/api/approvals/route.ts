import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/approvals — Pending approvals for user's org
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

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

  // Resolve requestedById → agent (no FK relation defined on the model)
  const requesterIds = [...new Set(approvals.map(a => a.requestedById).filter(Boolean))];
  const requestingAgents = requesterIds.length > 0
    ? await db.agent.findMany({ where: { id: { in: requesterIds } }, select: { id: true, name: true, gradient: true } })
    : [];
  const agentById = Object.fromEntries(requestingAgents.map(a => [a.id, a]));

  const enriched = approvals.map(a => ({
    ...a,
    requestedByAgent: agentById[a.requestedById] ?? null,
  }));

  return NextResponse.json({ data: enriched });
}
