import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/credits — Credit balance & usage
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation — session may still be loading" }, { status: 403 });

  const org = await db.organisation.findUnique({
    where: { id: orgId },
    select: { creditBalance: true, plan: true, autoTopUp: true },
  });

  const transactions = await db.creditTransaction.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Usage by agent
  const agentUsage = await db.creditTransaction.groupBy({
    by: ["agentId"],
    where: { orgId, type: "USAGE" },
    _sum: { amount: true },
  });

  return NextResponse.json({
    data: {
      balance: org?.creditBalance || 0,
      plan: org?.plan,
      autoTopUp: org?.autoTopUp,
      transactions,
      agentUsage,
    },
  });
}
