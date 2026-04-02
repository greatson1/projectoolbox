import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PLAN_LIMITS } from "@/lib/utils";

// GET /api/billing — Current plan & usage
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: null });

  const org = await db.organisation.findUnique({
    where: { id: orgId },
    select: {
      plan: true, creditBalance: true, stripeCustomerId: true, stripeSubId: true,
      billingEmail: true, autoTopUp: true,
    },
  });

  const invoices = await db.invoice.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const limits = PLAN_LIMITS[org?.plan || "FREE"];

  const agentCount = await db.agent.count({ where: { orgId, status: { not: "DECOMMISSIONED" } } });
  const projectCount = await db.project.count({ where: { orgId, status: "ACTIVE" } });

  return NextResponse.json({
    data: {
      plan: org?.plan,
      creditBalance: org?.creditBalance,
      limits,
      usage: { agents: agentCount, projects: projectCount },
      invoices,
      billingEmail: org?.billingEmail,
      autoTopUp: org?.autoTopUp,
      hasStripe: !!org?.stripeCustomerId,
    },
  });
}
