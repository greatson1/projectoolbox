import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PLAN_LIMITS } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET /api/agents — List org agents with activities and credit usage
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation — session may still be loading" }, { status: 403 });

  // Default: hide both decommissioned and archived from the fleet view.
  // Pass ?include=archived to also include archived agents (e.g. an
  // "Archived" tab on the agents page).
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("include") === "archived";
  const excludedStatuses = includeArchived
    ? (["DECOMMISSIONED"] as const)
    : (["DECOMMISSIONED", "ARCHIVED"] as const);

  const [agents, recentActivities, pendingApprovals] = await Promise.all([
    db.agent.findMany({
      where: { orgId, status: { notIn: [...excludedStatuses] } },
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

  // Archived agents are inert and do not consume the active-agent quota.
  const activeAgents = await db.agent.count({
    where: { orgId, status: { notIn: ["DECOMMISSIONED", "ARCHIVED"] } },
  });
  const limit = PLAN_LIMITS[org.plan]?.agents || 1;
  if (activeAgents >= limit) {
    return NextResponse.json({ error: `Agent limit reached (${limit} for ${org.plan} plan)` }, { status: 403 });
  }

  const body = await req.json();
  const { name, autonomyLevel, personality, gradient, title, avatarUrl, defaultGreeting, domainTags, monthlyBudget } = body;

  // ── Autonomy ceiling ────────────────────────────────────────────────────
  // FREE/STARTER can't deploy at L3 (autonomous cycle). Cap the requested
  // level at the plan's ceiling rather than 403'ing — a deploy wizard
  // doesn't need an error toast for picking the slider too high; just
  // clamp and respond with the actual level the agent was created at.
  // The autonomousCycle feature flag is independently enforced by the
  // cron tick — this just controls what's saved on the row.
  const requestedLevel = Number(autonomyLevel) || 2;
  const planMax = PLAN_LIMITS[org.plan]?.maxAutonomyLevel ?? 1;
  const cappedLevel = Math.min(Math.max(1, requestedLevel), planMax);

  // Idempotency: if an agent with this exact name was created in the same
  // org within the last 60s, return it instead of creating a duplicate.
  // Catches deploy-wizard double-fires before they cascade into duplicate
  // deployments downstream.
  const recentDuplicate = await db.agent.findFirst({
    where: {
      orgId,
      name: name || "Agent",
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recentDuplicate) {
    return NextResponse.json({ data: recentDuplicate, idempotent: true }, { status: 200 });
  }

  const agent = await db.agent.create({
    data: {
      name: name || "Agent",
      codename: `${(name || "AGENT").toUpperCase()}-${Math.floor(Math.random() * 100)}`,
      autonomyLevel: cappedLevel,
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
