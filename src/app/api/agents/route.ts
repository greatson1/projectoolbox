import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PLAN_LIMITS } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET /api/agents — List org agents with activities and credit usage
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: { agents: [], activities: [], alerts: [] } });

  const [agents, recentActivities, pendingApprovals] = await Promise.all([
    db.agent.findMany({
      where: { orgId, status: { not: "DECOMMISSIONED" } },
      include: {
        deployments: { where: { isActive: true }, include: { project: { select: { id: true, name: true, methodology: true } } } },
        agentEmail: { select: { address: true, isActive: true } },
        _count: { select: { activities: true, decisions: true, chatMessages: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.agentActivity.findMany({
      where: { agent: { orgId } },
      include: { agent: { select: { name: true, gradient: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.approval.findMany({
      where: { project: { orgId }, status: "PENDING" },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  // Credit usage per agent
  const creditUsage = await db.creditTransaction.groupBy({
    by: ["agentId"],
    where: { orgId, type: "USAGE", agentId: { not: null } },
    _sum: { amount: true },
  });

  const creditMap: Record<string, number> = {};
  creditUsage.forEach(c => { if (c.agentId) creditMap[c.agentId] = Math.abs(c._sum.amount || 0); });

  return NextResponse.json({
    data: {
      agents: agents.map(a => ({
        ...a,
        project: a.deployments[0]?.project || null,
        creditsUsed: creditMap[a.id] || 0,
        email: a.agentEmail?.isActive ? a.agentEmail.address : null,
      })),
      activities: recentActivities.map(a => ({
        id: a.id,
        type: a.type,
        summary: a.summary,
        agentName: a.agent.name,
        agentGradient: a.agent.gradient,
        createdAt: a.createdAt,
      })),
      alerts: pendingApprovals.map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        type: a.type,
        project: a.project.name,
        createdAt: a.createdAt,
      })),
    },
  });
}

// POST /api/agents — Create agent
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const org = await db.organisation.findUnique({ where: { id: orgId } });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  const activeAgents = await db.agent.count({ where: { orgId, status: { not: "DECOMMISSIONED" } } });
  const limit = PLAN_LIMITS[org.plan]?.agents || 1;
  if (activeAgents >= limit) {
    return NextResponse.json({ error: `Agent limit reached (${limit} for ${org.plan} plan)` }, { status: 403 });
  }

  const body = await req.json();
  const { name, autonomyLevel, personality, gradient, title, avatarUrl, defaultGreeting, domainTags, monthlyBudget } = body;

  const agent = await db.agent.create({
    data: {
      name: name || "Agent",
      codename: `${(name || "AGENT").toUpperCase()}-${Math.floor(Math.random() * 100)}`,
      autonomyLevel: autonomyLevel || 2,
      personality,
      gradient,
      orgId,
      ...(title && { title }),
      ...(avatarUrl && { avatarUrl }),
      ...(defaultGreeting && { defaultGreeting }),
      ...(domainTags?.length && { domainTags }),
      ...(monthlyBudget && { monthlyBudget }),
    },
  });

  return NextResponse.json({ data: agent }, { status: 201 });
}
