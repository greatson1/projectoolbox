import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/dashboard — Aggregated dashboard data
export async function GET() {
  try {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation — session may still be loading" }, { status: 403 });

  // Parallel queries
  const [org, projects, agents, pendingApprovals, unreadNotifs, recentActivities] = await Promise.all([
    db.organisation.findUnique({ where: { id: orgId }, select: { creditBalance: true, plan: true } }),
    db.project.findMany({
      where: { orgId, status: "ACTIVE" },
      include: {
        agents: { where: { isActive: true }, include: { agent: true } },
        _count: { select: { tasks: true, risks: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    db.agent.findMany({
      where: { orgId, status: { not: "DECOMMISSIONED" } },
      select: { id: true, name: true, status: true, gradient: true, autonomyLevel: true },
    }),
    db.approval.count({ where: { project: { orgId }, status: "PENDING" } }),
    db.notification.count({ where: { userId: session.user.id!, isRead: false } }),
    db.agentActivity.findMany({
      where: { agent: { orgId } },
      include: { agent: { select: { name: true, gradient: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  // Count tasks completed across all projects
  const completedTasks = await db.task.count({ where: { project: { orgId }, status: "DONE" } });
  const totalTasks = await db.task.count({ where: { project: { orgId } } });
  const openRisks = await db.risk.count({ where: { project: { orgId }, status: "OPEN" } });

  return NextResponse.json({
    data: {
      stats: {
        activeProjects: projects.length,
        completedTasks,
        totalTasks,
        pendingApprovals,
        openRisks,
        unreadNotifications: unreadNotifs,
        creditBalance: org?.creditBalance || 0,
        activeAgents: agents.filter(a => a.status === "ACTIVE").length,
      },
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        methodology: p.methodology,
        status: p.status,
        budget: p.budget,
        taskCount: p._count.tasks,
        riskCount: p._count.risks,
        agent: p.agents[0]?.agent ? { name: p.agents[0].agent.name, gradient: p.agents[0].agent.gradient, status: p.agents[0].agent.status } : null,
      })),
      agents,
      activities: recentActivities.map(a => ({
        id: a.id,
        type: a.type,
        summary: a.summary,
        agentName: a.agent.name,
        agentGradient: a.agent.gradient,
        createdAt: a.createdAt,
      })),
    },
  });
  } catch (err: any) {
    const msg: string = err?.message || "Internal server error";
    console.error("[dashboard] GET error:", msg);
    // Surface DB connectivity issues as a cleaner message rather than raw Prisma/pgbouncer text
    if (msg.includes("authentication") || msg.includes("Circuit breaker") || msg.includes("ECONNREFUSED") || msg.includes("P1001")) {
      return NextResponse.json({ error: "Database connection error — please try again in a moment" }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
