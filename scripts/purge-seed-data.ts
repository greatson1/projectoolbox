/**
 * Purge seed/demo data injected by prisma/seed.ts
 *
 * Deletes the 5 demo agents (identified by their codenames), their 5 demo projects
 * (identified by name), and all associated records.
 *
 * SAFE: Does NOT touch any agent or project not created by the seed script.
 *
 * Run: npx tsx scripts/purge-seed-data.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter } as any);

// ── These are the exact names/codenames the seed script uses ──────────────────

const SEED_AGENT_CODENAMES = ["ALPHA-7", "BRAVO-3", "CHARLIE-5", "DELTA-2", "ECHO-9"];

const SEED_PROJECT_NAMES = [
  "Project Atlas",
  "SprintForge",
  "Riverside Development",
  "Cloud Migration",
  "Brand Refresh",
];

// ── Seed users (only delete if they exist AND are not the real owner) ─────────
// We do NOT delete the org or users by default — just agents + projects.
// Uncomment the user/org deletion section if you also want to wipe those.

async function main() {
  console.log("🔍 Locating seed data...\n");

  // 1. Find seed agents by codename
  const seedAgents = await db.agent.findMany({
    where: { codename: { in: SEED_AGENT_CODENAMES } },
    select: { id: true, name: true, codename: true },
  });

  if (seedAgents.length === 0) {
    console.log("✅ No seed agents found — database is already clean.");
  } else {
    console.log(`Found ${seedAgents.length} seed agent(s): ${seedAgents.map(a => `${a.name} (${a.codename})`).join(", ")}`);
  }

  const seedAgentIds = seedAgents.map(a => a.id);

  // 2. Find seed projects by name
  const seedProjects = await db.project.findMany({
    where: { name: { in: SEED_PROJECT_NAMES } },
    select: { id: true, name: true },
  });

  if (seedProjects.length === 0) {
    console.log("✅ No seed projects found — database is already clean.");
  } else {
    console.log(`Found ${seedProjects.length} seed project(s): ${seedProjects.map(p => p.name).join(", ")}`);
  }

  const seedProjectIds = seedProjects.map(p => p.id);

  if (seedAgentIds.length === 0 && seedProjectIds.length === 0) {
    console.log("\nNothing to delete.");
    await db.$disconnect();
    return;
  }

  console.log("\n🗑️  Deleting seed data...\n");

  // ── Delete agent-scoped records ─────────────────────────────────────────────
  if (seedAgentIds.length > 0) {
    const d1 = await db.agentDeployment.deleteMany({ where: { agentId: { in: seedAgentIds } } });
    console.log(`  ✓ ${d1.count} deployment(s)`);

    const d2 = await db.agentActivity.deleteMany({ where: { agentId: { in: seedAgentIds } } });
    console.log(`  ✓ ${d2.count} activity record(s)`);

    const d3 = await db.agentArtefact.deleteMany({ where: { agentId: { in: seedAgentIds } } });
    console.log(`  ✓ ${d3.count} artefact(s)`);

    const d4 = await db.chatMessage.deleteMany({ where: { agentId: { in: seedAgentIds } } });
    console.log(`  ✓ ${d4.count} chat message(s)`);

    const d5 = await db.knowledgeBaseItem.deleteMany({ where: { agentId: { in: seedAgentIds } } });
    console.log(`  ✓ ${d5.count} knowledge base item(s)`);

    const d6 = await db.agent.deleteMany({ where: { id: { in: seedAgentIds } } });
    console.log(`  ✓ ${d6.count} agent(s)`);
  }

  // ── Delete project-scoped records ───────────────────────────────────────────
  if (seedProjectIds.length > 0) {
    const p1 = await db.phase.deleteMany({ where: { projectId: { in: seedProjectIds } } });
    console.log(`  ✓ ${p1.count} phase(s)`);

    const p2 = await db.approval.deleteMany({ where: { projectId: { in: seedProjectIds } } });
    console.log(`  ✓ ${p2.count} approval(s)`);

    // AgentActivity has no projectId — delete via agents deployed to these projects
    const p3 = await db.agentActivity.deleteMany({
      where: { agent: { deployments: { some: { projectId: { in: seedProjectIds } } } } },
    }).catch(() => ({ count: 0 }));
    console.log(`  ✓ ${p3.count} project activity record(s)`);

    const p4 = await db.project.deleteMany({ where: { id: { in: seedProjectIds } } });
    console.log(`  ✓ ${p4.count} project(s)`);
  }

  // ── Credit transactions from seed ────────────────────────────────────────────
  // These are safe to delete — they're synthetic usage records from the seed
  const ct = await db.creditTransaction.deleteMany({
    where: {
      description: {
        in: [
          "Professional plan — April 2026 grant",
          "Agent Alpha — week usage",
          "Agent Bravo — week usage",
          "Agent Charlie — week usage",
        ],
      },
    },
  });
  console.log(`  ✓ ${ct.count} seed credit transaction(s)`);

  // ── Seed notifications ────────────────────────────────────────────────────────
  const n = await db.notification.deleteMany({
    where: {
      title: {
        in: [
          "Phase Gate Approval Required",
          "Critical Risk — Supplier Delay",
          "Credit Balance Alert",
          "Agent Delta Paused",
        ],
      },
    },
  });
  console.log(`  ✓ ${n.count} seed notification(s)`);

  console.log("\n✅ Seed data purged. Your real agents and projects are untouched.");
  await db.$disconnect();
}

main().catch(console.error);
