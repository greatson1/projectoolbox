/**
 * Restart the clarification session for the Trip to Dubai (ALPHA-11) agent.
 * This posts fresh interactive question cards to the chat.
 *
 * Run: npx tsx scripts/restart-clarification.ts
 */
import { config } from "dotenv";
// Strip surrounding quotes from values (some env files wrap values in quotes)
const env = config({ override: true });
if (env.parsed) {
  for (const [k, v] of Object.entries(env.parsed)) {
    process.env[k] = v.replace(/^["']|["']$/g, "");
  }
}
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter } as any);

async function main() {
  // Find the ALPHA-11 agent deployed to Trip to Dubai
  const agent = await db.agent.findFirst({
    where: { codename: "ALPHA-11" },
    select: { id: true, name: true, orgId: true },
  });
  if (!agent) { console.error("❌ Agent ALPHA-11 not found"); return; }

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId: agent.id, isActive: true },
    include: { project: { select: { id: true, name: true, methodology: true } } },
    orderBy: { deployedAt: "desc" },
  });
  if (!deployment?.project) { console.error("❌ No active deployment found"); return; }

  console.log(`Found: ${agent.name} → ${deployment.project.name}`);

  // 1. Clear any stale session KB item
  const cleared = await db.knowledgeBaseItem.deleteMany({
    where: {
      agentId: agent.id,
      projectId: deployment.project.id,
      title: "__clarification_session__",
    },
  });
  console.log(`  Cleared ${cleared.count} stale session item(s)`);

  // 2. Clear any old clarification chat messages so the chat is clean
  const clearedMsgs = await db.chatMessage.deleteMany({
    where: {
      agentId: agent.id,
      content: { in: ["__CLARIFICATION_SESSION__", "__CLARIFICATION_COMPLETE__"] },
    },
  });
  console.log(`  Cleared ${clearedMsgs.count} old sentinel message(s)`);

  // 3. Determine which artefacts to generate questions for (from Phase row)
  const phase = await db.phase.findFirst({
    where: { projectId: deployment.project.id, status: "ACTIVE" },
    select: { name: true, artefacts: true },
  });

  const artefactNames: string[] = phase?.artefacts
    ? (phase.artefacts as string[])
    : ["Requirements Specification", "Outline Business Case", "Project Brief", "Initial Risk Register"];

  console.log(`  Phase: ${phase?.name ?? "unknown"}  |  Artefacts: ${artefactNames.join(", ")}`);

  // 4. Start the clarification session
  const { startClarificationSession } = await import("../src/lib/agents/clarification-session");
  const started = await startClarificationSession(
    agent.id,
    deployment.project.id,
    agent.orgId,
    artefactNames,
  );

  if (started) {
    console.log(`\n✅ Clarification session started — open Chat with Agent Alpha to see the interactive question cards.`);
  } else {
    console.log(`\n⚠️  Session did not start — check that ANTHROPIC_API_KEY is set and the methodology definitions are loaded.`);
  }

  await db.$disconnect();
}

main().catch(console.error);
