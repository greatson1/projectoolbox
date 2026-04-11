import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/credits/usage — Detailed credit usage breakdown
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: null });

  const [org, agentUsage, recentTxns, totalUsage] = await Promise.all([
    db.organisation.findUnique({ where: { id: orgId }, select: { creditBalance: true, plan: true, autoTopUp: true } }),
    db.creditTransaction.groupBy({
      by: ["agentId"],
      where: { orgId, type: "USAGE", agentId: { not: null } },
      _sum: { amount: true },
      _count: true,
    }),
    db.creditTransaction.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.creditTransaction.aggregate({
      where: { orgId, type: "USAGE" },
      _sum: { amount: true },
    }),
  ]);

  // Get agent names for the usage breakdown
  const agentIds = agentUsage.map(a => a.agentId).filter(Boolean) as string[];
  const agents = agentIds.length > 0 ? await db.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true, gradient: true },
  }) : [];

  const agentMap: Record<string, any> = {};
  agents.forEach(a => { agentMap[a.id] = a; });

  return NextResponse.json({
    data: {
      balance: org?.creditBalance || 0,
      plan: org?.plan,
      autoTopUp: org?.autoTopUp,
      totalUsed: Math.abs(totalUsage._sum.amount || 0),
      agentBreakdown: agentUsage.map(a => ({
        agentId: a.agentId,
        agentName: a.agentId ? agentMap[a.agentId]?.name || "Unknown" : "System",
        agentGradient: a.agentId ? agentMap[a.agentId]?.gradient : null,
        creditsUsed: Math.abs(a._sum.amount || 0),
        actionCount: a._count,
      })),
      recentTransactions: recentTxns,
    },
  });
}
