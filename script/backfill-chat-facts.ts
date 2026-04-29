/**
 * One-shot: walk chat history for a project, find (agent ?question -> user reply)
 * pairs that never produced a HIGH_TRUST KB fact, and run extractAnswerFromReply
 * on each missed pair to backfill the KB.
 *
 * Why: the chat-stream backstop in /api/agents/[id]/chat/stream/route.ts only
 * fires for new replies going forward. Existing projects where the user already
 * answered a prose-question still have no KB record of those answers, so the
 * agent will re-ask once before the backstop kicks in. This heals that state.
 *
 * Usage:
 *   npx tsx script/backfill-chat-facts.ts                    # ALL active deployments
 *   npx tsx script/backfill-chat-facts.ts "Project Name"     # filter by project name (substring)
 *   npx tsx script/backfill-chat-facts.ts --dry              # dry run, no writes
 *
 * Cost: ~$0.0001 per qualifying turn (Haiku). Most projects have <50 turns.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";
// Load .env.local first (Next.js dev defaults), then .env (committed defaults)
loadEnv({ path: resolve(__dirname, "../.env.local") });
loadEnv({ path: resolve(__dirname, "../.env") });

import { db } from "../src/lib/db";
import {
  getQuestionToBackstop,
  replyLooksSubstantive,
  extractAnswerFromReply,
} from "../src/lib/agents/extract-answer-from-reply";
import { storeFactToKB } from "../src/lib/agents/clarification-session";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const projectFilter = args.filter((a) => !a.startsWith("--")).join(" ").trim() || null;

async function main() {
  const deployments = await db.agentDeployment.findMany({
    where: {
      isActive: true,
      ...(projectFilter ? { project: { name: { contains: projectFilter, mode: "insensitive" } } } : {}),
    },
    select: {
      id: true,
      agentId: true,
      projectId: true,
      project: { select: { id: true, name: true, orgId: true } },
    },
  });

  if (deployments.length === 0) {
    console.log(`No active deployments found${projectFilter ? ` matching "${projectFilter}"` : ""}.`);
    return;
  }

  console.log(`Found ${deployments.length} active deployment(s):`);
  for (const d of deployments) console.log(`  - ${d.project?.name} (agent ${d.agentId}, project ${d.projectId})`);
  console.log(`\nDry run: ${dryRun ? "YES (no writes)" : "no — will write to KB"}\n`);

  let totalPairs = 0;
  let totalSkippedShortReply = 0;
  let totalSkippedNoQuestion = 0;
  let totalAlreadyHaveFact = 0;
  let totalExtracted = 0;
  let totalNotAnswer = 0;
  let totalFailed = 0;

  for (const d of deployments) {
    if (!d.projectId || !d.project) continue;
    const projectName = d.project.name;
    const orgId = d.project.orgId;

    console.log(`\n=== ${projectName} ===`);
    const messages = await db.chatMessage.findMany({
      where: { agentId: d.agentId },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, metadata: true, createdAt: true },
    });
    console.log(`  ${messages.length} chat messages`);

    // Build (agent message, user reply) pairs.
    // The user reply is the FIRST user message after that agent message
    // and before the next agent message.
    const pairs: Array<{ agentContent: string; agentMetadata: unknown; userContent: string; agentAt: Date; userAt: Date }> = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const a = messages[i];
      if (a.role !== "agent") continue;
      // Find the next user message before another agent message
      let userIdx = -1;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === "user") { userIdx = j; break; }
        if (messages[j].role === "agent") break; // user never replied to this turn
      }
      if (userIdx === -1) continue;
      pairs.push({
        agentContent: a.content,
        agentMetadata: a.metadata,
        userContent: messages[userIdx].content,
        agentAt: a.createdAt,
        userAt: messages[userIdx].createdAt,
      });
    }
    console.log(`  ${pairs.length} (agent→user) pairs to consider`);

    // Pre-load all KB items for this project so we can dedupe by title
    const existingKB = await db.knowledgeBaseItem.findMany({
      where: { agentId: d.agentId, projectId: d.projectId },
      select: { title: true },
    });
    const existingTitles = new Set(existingKB.map((k) => k.title.toLowerCase()));

    for (const p of pairs) {
      totalPairs++;
      const questionText = getQuestionToBackstop(p.agentContent, p.agentMetadata);
      if (!questionText) {
        totalSkippedNoQuestion++;
        continue;
      }
      if (!replyLooksSubstantive(p.userContent)) {
        totalSkippedShortReply++;
        continue;
      }
      try {
        const fact = await extractAnswerFromReply(questionText, p.userContent);
        if (!fact) {
          totalNotAnswer++;
          continue;
        }
        if (existingTitles.has(fact.title.toLowerCase())) {
          totalAlreadyHaveFact++;
          console.log(`  [skip already-stored] ${fact.title} = ${fact.content.slice(0, 60)}`);
          continue;
        }
        if (dryRun) {
          console.log(`  [DRY] would store: ${fact.title} | ${fact.content}`);
          totalExtracted++;
          existingTitles.add(fact.title.toLowerCase());
          continue;
        }
        await storeFactToKB(
          d.agentId,
          d.projectId,
          orgId,
          fact.title,
          fact.content,
          ["chat_extracted_backstop", "user_answer", "backfill"],
        );
        existingTitles.add(fact.title.toLowerCase());
        totalExtracted++;
        console.log(`  [STORED] ${fact.title} | ${fact.content.slice(0, 80)}`);
      } catch (e) {
        totalFailed++;
        console.error(`  [error] ${(e as Error).message}`);
      }
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Total pairs walked:        ${totalPairs}`);
  console.log(`  Skipped (no question):     ${totalSkippedNoQuestion}`);
  console.log(`  Skipped (short reply):     ${totalSkippedShortReply}`);
  console.log(`  Skipped (already stored):  ${totalAlreadyHaveFact}`);
  console.log(`  Haiku said not-an-answer:  ${totalNotAnswer}`);
  console.log(`  Facts ${dryRun ? "would store" : "stored"}:           ${totalExtracted}`);
  console.log(`  Errors:                    ${totalFailed}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());