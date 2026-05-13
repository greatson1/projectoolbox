/**
 * One-shot cleanup: strip historical [I asked the user]: / <prior_*>
 * context-marker leaks from every persisted agent ChatMessage.
 *
 * Background: the chat-stream sanitiser was added later in the project's
 * life, so messages persisted before it landed still carry leaked
 * prompt-context fragments like:
 *
 *   [I asked the user]: "What is the team's velocity?" (options: …)
 *   <prior_clarification>previous question text</prior_clarification>
 *
 * The chat GET route now strips these at read time as defence-in-depth,
 * but the underlying DB rows are still polluted — visible to any direct
 * query / export. This script rewrites them in place so the source of
 * truth matches what the UI displays.
 *
 * Safe:
 *   - Idempotent. Running twice does nothing on the second pass.
 *   - Only touches role="agent" messages whose content is non-sentinel
 *     (skip "__CLARIFICATION_SESSION__" etc — those are card-driven).
 *   - DRY_RUN=1 reports what would change without writing.
 *
 * Usage:
 *   DRY_RUN=1 npx tsx -r dotenv/config script/cleanup-chat-leaks.ts
 *   npx tsx -r dotenv/config script/cleanup-chat-leaks.ts
 *   # scope to a single agent:
 *   AGENT_ID=cmxxx npx tsx -r dotenv/config script/cleanup-chat-leaks.ts
 */

import { db } from "../src/lib/db";
import { stripContextMarkerLeaks } from "../src/lib/agents/sanitise-chat-response";

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const agentId = process.env.AGENT_ID || undefined;

  console.log(
    `\n${dryRun ? "🔍 DRY RUN" : "🧹 CLEANING"} historical chat-message leaks` +
    (agentId ? ` for agent ${agentId}` : " across ALL agents") +
    `\n`,
  );

  // Pull all agent-role messages with non-sentinel content. We page
  // through in chunks to avoid blowing memory on big DBs.
  const PAGE = 1000;
  let cursor: string | undefined;
  let total = 0;
  let changed = 0;
  const samples: Array<{ id: string; before: string; after: string }> = [];

  for (;;) {
    const batch: { id: string; content: string | null; agentId: string | null }[] = await db.chatMessage.findMany({
      where: {
        role: "agent",
        ...(agentId ? { agentId } : {}),
      },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, content: true, agentId: true },
    });
    if (batch.length === 0) break;

    for (const m of batch) {
      total++;
      if (!m.content || m.content.startsWith("__")) continue;
      const cleaned = stripContextMarkerLeaks(m.content);
      if (cleaned === m.content) continue;
      changed++;
      if (samples.length < 5) {
        samples.push({
          id: m.id,
          before: m.content.slice(0, 160),
          after: cleaned.slice(0, 160),
        });
      }
      if (!dryRun) {
        await db.chatMessage.update({
          where: { id: m.id },
          data: { content: cleaned },
        });
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < PAGE) break;
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Messages scanned:   ${total}`);
  console.log(`   ${dryRun ? "Would clean" : "Cleaned"}:        ${changed}`);
  if (samples.length > 0) {
    console.log(`\nSample diffs:`);
    for (const s of samples) {
      console.log(`   ${s.id}`);
      console.log(`     − ${s.before.replace(/\n/g, " ")}`);
      console.log(`     + ${s.after.replace(/\n/g, " ")}`);
    }
  }
  console.log();
}

main()
  .catch(e => { console.error("\n❌ Failed:", e); process.exit(1); })
  .finally(() => db.$disconnect());
