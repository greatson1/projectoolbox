/**
 * Stakeholder sentiment updater — refreshes Stakeholder.sentiment
 * based on that person's recent communications (last 30 days).
 *
 * Strategy: weighted average of sentiment scores from matched comms,
 * weighted by recency (recent matters more).
 */

import { db } from "@/lib/db";

interface SentimentEvent {
  score: number;
  ageDays: number;
}

function averageSentiment(events: SentimentEvent[]): { score: number; label: string } {
  if (events.length === 0) return { score: 0, label: "neutral" };

  // Exponential decay: recent activity matters more
  let weightedSum = 0;
  let weightTotal = 0;
  for (const e of events) {
    const weight = Math.exp(-e.ageDays / 30); // half-life ~20 days
    weightedSum += e.score * weight;
    weightTotal += weight;
  }
  const avg = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const label =
    avg >= 0.4 ? "positive" :
    avg >= -0.1 ? "neutral" :
    avg >= -0.5 ? "concerned" : "negative";
  return { score: avg, label };
}

/** Recompute a single stakeholder's sentiment from their recent activity. */
export async function refreshStakeholderSentiment(stakeholderId: string): Promise<void> {
  const stakeholder = await db.stakeholder.findUnique({
    where: { id: stakeholderId },
    select: { id: true, name: true, email: true, project: { select: { orgId: true } } },
  });
  if (!stakeholder) return;

  const orgId = stakeholder.project.orgId;
  const cutoff = new Date(Date.now() - 30 * 86400_000);

  // Pull all history for this stakeholder
  const history = await db.sentimentHistory.findMany({
    where: {
      orgId,
      subjectType: "stakeholder",
      subjectId: stakeholderId,
      createdAt: { gte: cutoff },
    },
    select: { score: true, createdAt: true },
    take: 50,
  });

  // Also pull inbound emails where the sender matches this stakeholder's email
  const inbound = stakeholder.email
    ? await db.agentInboxMessage.findMany({
        where: {
          orgId,
          from: { contains: stakeholder.email, mode: "insensitive" as any },
          sentimentScore: { not: null },
          receivedAt: { gte: cutoff },
        },
        select: { sentimentScore: true, receivedAt: true },
        take: 50,
      }).catch(() => [])
    : [];

  const events: SentimentEvent[] = [
    ...history.map((h) => ({
      score: h.score,
      ageDays: (Date.now() - h.createdAt.getTime()) / 86400_000,
    })),
    ...inbound.map((m) => ({
      score: m.sentimentScore!,
      ageDays: (Date.now() - m.receivedAt.getTime()) / 86400_000,
    })),
  ];

  if (events.length === 0) return;

  const { score, label } = averageSentiment(events);

  await db.stakeholder.update({
    where: { id: stakeholderId },
    data: {
      sentiment: label,
      sentimentScore: score,
      sentimentUpdatedAt: new Date(),
    },
  }).catch(() => {});

  // Sync to KB so the agent has explicit memory of this stakeholder's state
  try {
    const { syncStakeholderSentimentToKB } = await import("./kb-sync");
    await syncStakeholderSentimentToKB(stakeholderId);
  } catch { /* non-fatal */ }
}

/** Refresh sentiment for every stakeholder in an org (nightly batch). */
export async function refreshAllStakeholderSentiment(orgId: string): Promise<number> {
  const stakeholders = await db.stakeholder.findMany({
    where: { project: { orgId } },
    select: { id: true },
  });
  let refreshed = 0;
  for (const s of stakeholders) {
    try {
      await refreshStakeholderSentiment(s.id);
      refreshed++;
    } catch { /* non-fatal */ }
  }
  return refreshed;
}
