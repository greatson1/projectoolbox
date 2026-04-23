/**
 * Sentiment trend queries — time-series aggregation over SentimentHistory.
 */

import { db } from "@/lib/db";

export interface SentimentPulse {
  total: number;
  positive: number;
  neutral: number;
  concerned: number;
  negative: number;
  averageScore: number;      // -1..1
  trend: "improving" | "stable" | "declining";
  weeklyChange: number;      // delta in avg score (this week vs last week)
}

/** Current org-wide sentiment pulse (past 7 days) with weekly trend. */
export async function getOrgSentimentPulse(orgId: string, windowDays = 7): Promise<SentimentPulse> {
  const now = Date.now();
  const cutoffCurrent = new Date(now - windowDays * 86400_000);
  const cutoffPrior = new Date(now - windowDays * 2 * 86400_000);

  const [current, prior] = await Promise.all([
    db.sentimentHistory.findMany({
      where: { orgId, createdAt: { gte: cutoffCurrent } },
      select: { sentiment: true, score: true },
    }),
    db.sentimentHistory.findMany({
      where: { orgId, createdAt: { gte: cutoffPrior, lt: cutoffCurrent } },
      select: { score: true },
    }),
  ]);

  const total = current.length;
  const avg = total > 0 ? current.reduce((s, h) => s + h.score, 0) / total : 0;
  const avgPrior = prior.length > 0 ? prior.reduce((s, h) => s + h.score, 0) / prior.length : avg;
  const change = avg - avgPrior;

  return {
    total,
    positive: current.filter((h) => h.sentiment === "positive").length,
    neutral: current.filter((h) => h.sentiment === "neutral").length,
    concerned: current.filter((h) => h.sentiment === "concerned").length,
    negative: current.filter((h) => h.sentiment === "negative").length,
    averageScore: Math.round(avg * 100) / 100,
    trend: change > 0.1 ? "improving" : change < -0.1 ? "declining" : "stable",
    weeklyChange: Math.round(change * 100) / 100,
  };
}

export interface TrendPoint {
  date: string;      // YYYY-MM-DD
  score: number;     // average sentiment score that day
  count: number;     // number of signals
}

/** Daily sentiment trend for a subject (stakeholder / project / org) over N days. */
export async function getSentimentTrend(
  orgId: string,
  subjectType: string,
  subjectId: string,
  days = 30,
): Promise<TrendPoint[]> {
  const cutoff = new Date(Date.now() - days * 86400_000);
  const history = await db.sentimentHistory.findMany({
    where: { orgId, subjectType, subjectId, createdAt: { gte: cutoff } },
    select: { score: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const byDate: Record<string, { sum: number; count: number }> = {};
  for (const h of history) {
    const date = h.createdAt.toISOString().slice(0, 10);
    if (!byDate[date]) byDate[date] = { sum: 0, count: 0 };
    byDate[date].sum += h.score;
    byDate[date].count++;
  }

  return Object.entries(byDate).map(([date, { sum, count }]) => ({
    date,
    score: Math.round((sum / count) * 100) / 100,
    count,
  }));
}

export interface StakeholderSentimentSummary {
  stakeholderId: string;
  name: string;
  role?: string | null;
  organisation?: string | null;
  power: number;
  interest: number;
  sentiment: string | null;
  sentimentScore: number | null;
  sentimentUpdatedAt: Date | null;
  recentSignals: number;
  projectId: string;
  projectName: string;
}

/** Heatmap data — every stakeholder in the org with current sentiment. */
export async function getStakeholderHeatmap(orgId: string): Promise<StakeholderSentimentSummary[]> {
  const stakeholders = await db.stakeholder.findMany({
    where: { project: { orgId } },
    select: {
      id: true, name: true, role: true, organisation: true,
      power: true, interest: true,
      sentiment: true, sentimentScore: true, sentimentUpdatedAt: true,
      projectId: true, project: { select: { name: true } },
    },
  });

  const ids = stakeholders.map((s) => s.id);
  const cutoff = new Date(Date.now() - 30 * 86400_000);
  const signalCounts = await db.sentimentHistory.groupBy({
    by: ["subjectId"],
    where: { orgId, subjectType: "stakeholder", subjectId: { in: ids }, createdAt: { gte: cutoff } },
    _count: true,
  }).catch(() => []);
  const signalMap = Object.fromEntries(signalCounts.map((s: any) => [s.subjectId, s._count]));

  return stakeholders.map((s) => ({
    stakeholderId: s.id,
    name: s.name,
    role: s.role,
    organisation: s.organisation,
    power: s.power,
    interest: s.interest,
    sentiment: s.sentiment,
    sentimentScore: s.sentimentScore,
    sentimentUpdatedAt: s.sentimentUpdatedAt,
    recentSignals: signalMap[s.id] || 0,
    projectId: s.projectId,
    projectName: s.project.name,
  }));
}
