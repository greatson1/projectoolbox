import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/activity — Org-wide activity feed
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation — session may still be loading" }, { status: 403 });

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

  // Types that are noisy or redundant — hide from the Activity feed by default.
  // Activity entries are now only shown for actual ACTIONS (approvals, artefact edits,
  // research runs, task changes, risks, meetings).
  const HIDDEN_TYPES = ["comms_reminder", "monitoring", "chat", "autonomous_cycle", "system"];
  const filterWhere = { ...where, type: { notIn: HIDDEN_TYPES } };

  const [rawActivities, total, agents] = await Promise.all([
    db.agentActivity.findMany({
      where: filterWhere,
      include: { agent: { select: { id: true, name: true, gradient: true, status: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit * 2, // over-fetch so dedup doesn't leave us short
    }),
    db.agentActivity.count({ where: filterWhere }),
    db.agent.findMany({
      where: { orgId, status: { not: "DECOMMISSIONED" } },
      select: { id: true, name: true, gradient: true },
    }),
  ]);

  // Dedupe: collapse identical (agent + type + summary) entries created within
  // a 1-hour window. Keeps the most recent, drops repeats.
  const seen = new Map<string, number>();
  const deduped: typeof rawActivities = [];
  for (const a of rawActivities) {
    const key = `${a.agentId}:${a.type}:${(a.summary || "").trim()}`;
    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      const existing = deduped[existingIdx];
      const hourAgo = Date.now() - 60 * 60 * 1000;
      if (existing.createdAt.getTime() > hourAgo && a.createdAt.getTime() > hourAgo) {
        continue;
      }
    }
    seen.set(key, deduped.length);
    deduped.push(a);
  }
  const activities = deduped.slice(0, limit);

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
