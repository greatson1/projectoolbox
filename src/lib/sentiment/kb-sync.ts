/**
 * Sentiment → Knowledge Base sync.
 *
 * When a stakeholder's sentiment changes meaningfully, we upsert a KB item
 * so the agent has explicit memory of it. This way queries like "what does
 * Jane think?" or "who's at risk with this project?" can be answered from
 * the KB directly, alongside all other project knowledge.
 *
 * Policy:
 *   - Significant change = shift of ≥ 0.3 on the -1..1 scale, OR label change
 *     crossing positive/neutral ↔ concerned/negative boundary
 *   - KB item is upserted (one per stakeholder), tagged with 'sentiment', 'stakeholder'
 *   - TrustLevel = STANDARD (not HIGH — this is algorithmic, not user-verified)
 */

import { db } from "@/lib/db";

const SIG_SCORE_DELTA = 0.3;

function crossesThreshold(prev: string | null | undefined, curr: string): boolean {
  const negative = new Set(["negative", "concerned"]);
  const positive = new Set(["positive", "neutral"]);
  if (!prev) return curr === "negative" || curr === "concerned";
  return (negative.has(prev) && positive.has(curr)) || (positive.has(prev) && negative.has(curr));
}

/** Ensure the KB has an up-to-date sentiment memory item for a stakeholder. */
export async function syncStakeholderSentimentToKB(stakeholderId: string): Promise<{ created: boolean; updated: boolean } | null> {
  const stakeholder = await db.stakeholder.findUnique({
    where: { id: stakeholderId },
    select: {
      id: true, name: true, role: true, organisation: true,
      sentiment: true, sentimentScore: true, sentimentUpdatedAt: true,
      projectId: true, project: { select: { orgId: true, name: true } },
    },
  });
  if (!stakeholder || !stakeholder.sentiment) return null;

  const orgId = stakeholder.project.orgId;

  // Look for existing KB item for this stakeholder's sentiment
  const existingKey = `sentiment:stakeholder:${stakeholderId}`;
  const existing = await db.knowledgeBaseItem.findFirst({
    where: {
      orgId,
      projectId: stakeholder.projectId,
      tags: { has: existingKey },
    },
    select: { id: true, content: true, updatedAt: true, metadata: true },
  });

  // Pull recent signals for context
  const recent = await db.sentimentHistory.findMany({
    where: {
      orgId,
      subjectType: "stakeholder",
      subjectId: stakeholderId,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { sentiment: true, score: true, source: true, createdAt: true },
  });

  // Generate a concise narrative
  const avgRecent = recent.length > 0 ? recent.reduce((s, r) => s + r.score, 0) / recent.length : (stakeholder.sentimentScore ?? 0);
  const trendDirection = recent.length >= 3
    ? (recent.slice(0, 3).reduce((s, r) => s + r.score, 0) / 3) - (recent.slice(-3).reduce((s, r) => s + r.score, 0) / 3)
    : 0;
  const trendLabel = trendDirection > 0.15 ? "improving" : trendDirection < -0.15 ? "declining" : "stable";

  const title = `Stakeholder sentiment: ${stakeholder.name}`;
  const content = [
    `**Current sentiment:** ${stakeholder.sentiment} (score ${stakeholder.sentimentScore?.toFixed(2) ?? "—"})`,
    `**Role:** ${stakeholder.role || "Unknown"}${stakeholder.organisation ? ` at ${stakeholder.organisation}` : ""}`,
    `**Trend:** ${trendLabel} over the last ${recent.length} signals`,
    `**Average score (recent):** ${avgRecent.toFixed(2)}`,
    `**Last updated:** ${stakeholder.sentimentUpdatedAt?.toISOString().slice(0, 10) || "—"}`,
    ``,
    `Recent signals:`,
    ...recent.slice(0, 5).map((r) => `- ${r.createdAt.toISOString().slice(0, 10)}: ${r.sentiment} (${r.score.toFixed(2)}) via ${r.source}`),
  ].join("\n");

  // Determine if this is a significant change worth writing
  const prevMeta = (existing?.metadata as any) || {};
  const prevLabel = prevMeta.sentiment;
  const prevScore = prevMeta.score;
  const scoreDelta = prevScore != null ? Math.abs((stakeholder.sentimentScore ?? 0) - prevScore) : Infinity;
  const labelChanged = prevLabel !== stakeholder.sentiment;
  const isSignificant = !existing || scoreDelta >= SIG_SCORE_DELTA || crossesThreshold(prevLabel, stakeholder.sentiment);

  if (!isSignificant && !labelChanged) {
    return null;
  }

  if (existing) {
    await db.knowledgeBaseItem.update({
      where: { id: existing.id },
      data: {
        title,
        content,
        metadata: {
          sentiment: stakeholder.sentiment,
          score: stakeholder.sentimentScore,
          trend: trendLabel,
          recentSignalCount: recent.length,
          stakeholderId,
        } as any,
        updatedAt: new Date(),
      },
    }).catch(() => {});
    return { created: false, updated: true };
  }

  await db.knowledgeBaseItem.create({
    data: {
      orgId,
      projectId: stakeholder.projectId,
      layer: "PROJECT",
      type: "DECISION", // treat as inferred fact about a stakeholder
      title,
      content,
      tags: ["sentiment", "stakeholder", existingKey, stakeholder.sentiment],
      trustLevel: "STANDARD",
      confidential: false,
      metadata: {
        sentiment: stakeholder.sentiment,
        score: stakeholder.sentimentScore,
        trend: trendLabel,
        recentSignalCount: recent.length,
        stakeholderId,
      } as any,
    },
  }).catch(() => {});

  return { created: true, updated: false };
}

/** Bulk sync — typically called nightly for the whole org. */
export async function syncAllStakeholderSentimentToKB(orgId: string): Promise<number> {
  const stakeholders = await db.stakeholder.findMany({
    where: { project: { orgId }, sentiment: { not: null } },
    select: { id: true },
  });
  let synced = 0;
  for (const s of stakeholders) {
    try {
      const r = await syncStakeholderSentimentToKB(s.id);
      if (r) synced++;
    } catch { /* non-fatal */ }
  }
  return synced;
}
