import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { EXCLUDE_PM_OVERHEAD } from "@/lib/agents/task-filters";

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
        _count: { select: { tasks: { where: EXCLUDE_PM_OVERHEAD }, risks: true } },
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

  // Count tasks completed across all projects (excluding PM-overhead pseudo-tasks)
  const completedTasks = await db.task.count({ where: { project: { orgId }, status: "DONE", ...EXCLUDE_PM_OVERHEAD } });
  const totalTasks = await db.task.count({ where: { project: { orgId }, ...EXCLUDE_PM_OVERHEAD } });
  const openRisks = await db.risk.count({ where: { project: { orgId }, status: "OPEN" } });

  // ── Stuck conversations ────────────────────────────────────────────────────
  // Find agent_question / clarification_question chat messages older than 4
  // hours that the user has not answered yet. We treat "answered" as: a user
  // chat message exists for the same agent with createdAt > question.createdAt.
  // Surfaces in the dashboard nudge so questions don't quietly age out of
  // sight when the user closes the chat tab.
  const FOUR_HOURS_AGO = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const orgAgentIds = agents.map(a => a.id);
  const oldQuestionMsgs = orgAgentIds.length === 0 ? [] : await db.chatMessage.findMany({
    where: {
      agentId: { in: orgAgentIds },
      role: "agent",
      content: { in: ["__AGENT_QUESTION__", "__CLARIFICATION_SESSION__"] },
      createdAt: { lt: FOUR_HOURS_AGO },
    },
    select: { id: true, agentId: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "desc" },
  });
  // Group questions by agent and find the latest user reply per agent.
  const lastUserReplyByAgent = new Map<string, Date>();
  if (orgAgentIds.length > 0 && oldQuestionMsgs.length > 0) {
    const replies = await db.chatMessage.findMany({
      where: {
        agentId: { in: Array.from(new Set(oldQuestionMsgs.map(q => q.agentId).filter((x): x is string => !!x))) },
        role: "user",
      },
      select: { agentId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    for (const r of replies) {
      if (r.agentId && !lastUserReplyByAgent.has(r.agentId)) {
        lastUserReplyByAgent.set(r.agentId, r.createdAt);
      }
    }
  }
  // For each agent, count unanswered old questions (oldest one wins for the
  // surfaced excerpt). This collapses the noise so we show one nudge per agent.
  const stuckConversationsByAgent = new Map<string, { agentId: string; oldestAt: Date; count: number; sampleText: string }>();
  for (const q of oldQuestionMsgs) {
    if (!q.agentId) continue;
    const lastReply = lastUserReplyByAgent.get(q.agentId);
    if (lastReply && lastReply > q.createdAt) continue; // user has replied since this question
    const meta = q.metadata as any;
    const sampleText = meta?.question?.question || meta?.question?.text || "(question text missing)";
    const existing = stuckConversationsByAgent.get(q.agentId);
    if (!existing || q.createdAt < existing.oldestAt) {
      stuckConversationsByAgent.set(q.agentId, {
        agentId: q.agentId,
        oldestAt: q.createdAt,
        count: (existing?.count || 0) + 1,
        sampleText,
      });
    } else {
      existing.count += 1;
    }
  }
  const stuckConversations = Array.from(stuckConversationsByAgent.values()).map(s => {
    const ag = agents.find(a => a.id === s.agentId);
    return {
      agentId: s.agentId,
      agentName: ag?.name || "Agent",
      agentGradient: ag?.gradient || null,
      oldestAt: s.oldestAt,
      count: s.count,
      sampleText: s.sampleText.slice(0, 160),
    };
  });

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
        agent: p.agents[0]?.agent ? { id: p.agents[0].agent.id, name: p.agents[0].agent.name, gradient: p.agents[0].agent.gradient, status: p.agents[0].agent.status } : null,
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
      stuckConversations,
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
