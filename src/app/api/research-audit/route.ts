import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/research-audit — Research audit trail across all agents
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const agentFilter = searchParams.get("agent");
  const range = searchParams.get("range") || "30d";

  let since = new Date();
  if (range === "7d") since.setDate(since.getDate() - 7);
  else if (range === "30d") since.setDate(since.getDate() - 30);
  else if (range === "90d") since.setDate(since.getDate() - 90);
  else since.setDate(since.getDate() - 30);

  const agentWhere = agentFilter ? { agentId: agentFilter } : {};

  // 1. Research-tagged KB items (facts stored from Perplexity research)
  const kbItems = await db.knowledgeBaseItem.findMany({
    where: {
      orgId,
      tags: { hasSome: ["research", "feasibility", "perplexity"] },
      createdAt: { gte: since },
      ...agentWhere,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, title: true, content: true, type: true, layer: true,
      trustLevel: true, tags: true, createdAt: true, agentId: true,
      sourceUrl: true, metadata: true,
    },
  });

  // 2. Research-related activity log entries
  const activities = await db.agentActivity.findMany({
    where: {
      agent: { orgId },
      createdAt: { gte: since },
      OR: [
        { summary: { contains: "research", mode: "insensitive" } },
        { summary: { contains: "feasibility", mode: "insensitive" } },
        { summary: { contains: "Perplexity", mode: "insensitive" } },
        { summary: { contains: "PESTLE", mode: "insensitive" } },
        { type: "knowledge" },
      ],
      ...agentWhere,
    },
    include: { agent: { select: { id: true, name: true, gradient: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // 3. Chat messages with research_findings type
  const chatMessages = await db.chatMessage.findMany({
    where: {
      agent: { orgId },
      content: "__RESEARCH_FINDINGS__",
      createdAt: { gte: since },
      ...agentWhere,
    },
    include: { agent: { select: { id: true, name: true, gradient: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // 4. Agents list for filter dropdown
  const agents = await db.agent.findMany({
    where: { orgId, status: { not: "DECOMMISSIONED" } },
    select: { id: true, name: true, gradient: true },
  });

  // 5. Build research sessions by grouping chat messages (each represents one research run)
  const sessions = chatMessages.map((msg) => {
    const meta = msg.metadata as any;
    return {
      id: msg.id,
      agentId: msg.agentId,
      agentName: (msg.agent as any).name,
      agentGradient: (msg.agent as any).gradient,
      projectName: meta?.projectName || "Unknown",
      factsCount: meta?.factsCount || 0,
      sections: meta?.sections || [],
      facts: meta?.facts || [],
      createdAt: msg.createdAt,
    };
  });

  // 6. Stats
  const totalFacts = kbItems.length;
  const totalSessions = sessions.length;
  const totalActivities = activities.length;
  const highTrustFacts = kbItems.filter((k) => k.trustLevel === "HIGH_TRUST").length;
  const standardFacts = kbItems.filter((k) => k.trustLevel === "STANDARD").length;

  // Fact categories
  const categories: Record<string, number> = {};
  kbItems.forEach((k) => {
    (k.tags || []).forEach((t: string) => {
      if (!["research", "feasibility", "perplexity"].includes(t)) {
        categories[t] = (categories[t] || 0) + 1;
      }
    });
  });

  return NextResponse.json({
    data: {
      sessions,
      kbItems: kbItems.map((k) => ({
        ...k,
        metadata: undefined, // strip large metadata from response
      })),
      activities: activities.map((a) => ({
        id: a.id,
        agentId: a.agentId,
        agentName: (a.agent as any).name,
        agentGradient: (a.agent as any).gradient,
        type: a.type,
        summary: a.summary,
        metadata: a.metadata,
        createdAt: a.createdAt,
      })),
      agents,
      stats: {
        totalFacts,
        totalSessions,
        totalActivities,
        highTrustFacts,
        standardFacts,
        categories,
      },
    },
  });
}
