import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/activity — Org-wide activity feed
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: { activities: [], stats: {} } });

  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") || "7d";
  const agentId = searchParams.get("agent");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");

  // Calculate date filter
  let since = new Date();
  if (range === "today") since.setHours(0, 0, 0, 0);
  else if (range === "week") { since.setDate(since.getDate() - since.getDay()); since.setHours(0, 0, 0, 0); }
  else if (range === "7d") since.setDate(since.getDate() - 7);
  else if (range === "30d") since.setDate(since.getDate() - 30);

  const where: any = {
    agent: { orgId },
    createdAt: { gte: since },
    ...(agentId && { agentId }),
  };

  const [activities, total, agents] = await Promise.all([
    db.agentActivity.findMany({
      where,
      include: { agent: { select: { id: true, name: true, gradient: true, status: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.agentActivity.count({ where }),
    db.agent.findMany({
      where: { orgId, status: { not: "DECOMMISSIONED" } },
      select: { id: true, name: true, gradient: true },
    }),
  ]);

  // Stats — must match resolveFilterGroup() in the activity page
  const stats = {
    totalActions: total,
    documents: await db.agentActivity.count({ where: { ...where, type: { in: ["document", "artefact_generated", "artefact", "ingest", "knowledge"] } } }),
    decisions: await db.agentActivity.count({ where: { ...where, type: { in: ["approval", "decision"] } } }),
    risks: await db.agentActivity.count({ where: { ...where, type: { in: ["risk", "proactive_alert", "risk_flag"] } } }),
    meetings: await db.agentActivity.count({ where: { ...where, type: { in: ["meeting", "transcript"] } } }),
  };

  // Daily digest
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const digest = await db.dailyDigest.findFirst({
    where: { orgId, date: today },
  });

  return NextResponse.json({
    data: {
      activities: activities.map(a => ({
        ...a,
        agentName: a.agent.name,
        agentGradient: a.agent.gradient,
      })),
      total,
      page,
      stats,
      agents,
      digest,
    },
  });
}
