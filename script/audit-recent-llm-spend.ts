/**
 * Audit recent activity that likely consumed Claude credits.
 *
 * Counts the most-suspect events in the last 60 minutes so we can see
 * what's actually hammering Anthropic vs hypothetical.
 */

import { db } from "../src/lib/db";

async function main() {
  const minutes = parseInt(process.env.WINDOW_MINS || "60", 10);
  const since = new Date(Date.now() - minutes * 60_000);
  console.log(`\nAudit of activity since ${since.toISOString()} (last ${minutes} min)\n${"━".repeat(64)}\n`);

  const [
    chatMessages,
    artefactsCreated,
    artefactsUpdated,
    kbItemsCreated,
    agentActivities,
    inboxMessages,
    agentJobs,
    sentimentHistory,
    auditLogs,
  ] = await Promise.all([
    db.chatMessage.count({ where: { createdAt: { gte: since } } }),
    db.agentArtefact.count({ where: { createdAt: { gte: since } } }),
    db.agentArtefact.count({ where: { updatedAt: { gte: since }, createdAt: { lt: since } } }),
    db.knowledgeBaseItem.count({ where: { createdAt: { gte: since } } }),
    db.agentActivity.count({ where: { createdAt: { gte: since } } }),
    db.agentInboxMessage.count({ where: { receivedAt: { gte: since } } }),
    db.agentJob.count({ where: { createdAt: { gte: since } } }),
    db.sentimentHistory.count({ where: { createdAt: { gte: since } } }),
    db.auditLog.count({ where: { createdAt: { gte: since } } }),
  ]);

  console.log(`📊 Volumes (last 60 min):`);
  console.log(`   • ChatMessage created:                 ${chatMessages}`);
  console.log(`   • AgentArtefact created:               ${artefactsCreated}     (each → 1 Sonnet + ~1 Haiku contradiction)`);
  console.log(`   • AgentArtefact updated (existing):    ${artefactsUpdated}`);
  console.log(`   • KnowledgeBaseItem created:           ${kbItemsCreated}`);
  console.log(`   • AgentActivity rows:                  ${agentActivities}`);
  console.log(`   • AgentInboxMessage created:           ${inboxMessages}     (each → ~2 Haiku for fact extract + sentiment)`);
  console.log(`   • AgentJob created:                    ${agentJobs}`);
  console.log(`   • SentimentHistory rows:               ${sentimentHistory}     (each = 1 Haiku call)`);
  console.log(`   • AuditLog rows:                       ${auditLogs}`);

  // KB items by tag — see what's being created in volume
  console.log(`\n📚 KB items by primary tag (last 60 min):`);
  const kbItems = await db.knowledgeBaseItem.findMany({
    where: { createdAt: { gte: since } },
    select: { tags: true },
  });
  const tagCounts = new Map<string, number>();
  for (const it of kbItems) {
    for (const t of it.tags || []) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }
  const topTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [tag, n] of topTags) {
    console.log(`   • ${tag.padEnd(30)} ${n}`);
  }

  // AgentActivity by type — most active operations
  console.log(`\n🤖 AgentActivity by type (last 60 min):`);
  const activities = await db.agentActivity.findMany({
    where: { createdAt: { gte: since } },
    select: { type: true, summary: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const typeCounts = new Map<string, number>();
  for (const a of activities) {
    typeCounts.set(a.type, (typeCounts.get(a.type) || 0) + 1);
  }
  for (const [type, n] of Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`   • ${type.padEnd(30)} ${n}`);
  }

  // AgentJob breakdown — what's the cron doing
  console.log(`\n⚙️  AgentJob by type/status (last 60 min):`);
  const jobs = await db.agentJob.findMany({
    where: { createdAt: { gte: since } },
    select: { type: true, status: true },
  });
  const jobCounts = new Map<string, number>();
  for (const j of jobs) {
    const k = `${j.type}/${j.status}`;
    jobCounts.set(k, (jobCounts.get(k) || 0) + 1);
  }
  for (const [k, n] of Array.from(jobCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`   • ${k.padEnd(40)} ${n}`);
  }

  // Top recent activities — give the operator a sense of what's happened
  console.log(`\n📝 Most recent 15 agent activities:`);
  for (const a of activities.slice(0, 15)) {
    console.log(`   [${a.type}] ${a.summary.slice(0, 90)}`);
  }

  // Estimated Haiku/Sonnet call counts based on heuristics
  const estimatedSentimentCalls = sentimentHistory;
  const estimatedContradictionCalls = artefactsCreated;
  const estimatedFactExtractCalls = inboxMessages * 2; // extract + sentiment per inbound email
  const estimatedGenerationCalls = artefactsCreated; // 1 Sonnet per artefact
  const estimatedKbPropagateCalls = (artefactsUpdated + kbItemsCreated) * 2; // very rough — Haiku per draft per fact

  console.log(`\n💰 Rough Anthropic call estimate (last 60 min):`);
  console.log(`   • Haiku (sentiment):                   ~${estimatedSentimentCalls}`);
  console.log(`   • Haiku (contradiction detector):      ~${estimatedContradictionCalls}`);
  console.log(`   • Haiku (email fact + sentiment):      ~${estimatedFactExtractCalls}`);
  console.log(`   • Haiku (KB→artefact propagation):     ~${estimatedKbPropagateCalls}  (rough)`);
  console.log(`   • Sonnet (artefact generation):        ~${estimatedGenerationCalls}`);
  const haikuTotal = estimatedSentimentCalls + estimatedContradictionCalls + estimatedFactExtractCalls + estimatedKbPropagateCalls;
  console.log(`   • TOTAL Haiku-ish:                     ~${haikuTotal}`);
  console.log(`   • TOTAL Sonnet-ish:                    ~${estimatedGenerationCalls}`);
  console.log(`\n   Cost guesstimate: ~$${(haikuTotal * 0.001 + estimatedGenerationCalls * 0.02).toFixed(2)} (Haiku $0.001/call, Sonnet $0.02/call)\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
