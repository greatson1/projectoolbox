/**
 * Fix duplicate active deployments on the same agent→project.
 * Keeps only the MOST RECENT active deployment per agent+project pair,
 * deactivates all older duplicates.
 *
 * Run: npx tsx scripts/fix-duplicate-deployments.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter } as any);

async function main() {
  const allActive = await db.agentDeployment.findMany({
    where: { isActive: true },
    include: { agent: { select: { name: true } }, project: { select: { name: true } } },
    orderBy: { deployedAt: "desc" },
  });

  // Group by agentId+projectId
  const seen = new Map<string, string>(); // key → first (newest) id
  const toDeactivate: string[] = [];

  for (const d of allActive) {
    const key = `${d.agentId}:${d.projectId}`;
    if (seen.has(key)) {
      toDeactivate.push(d.id);
      console.log(`  Deactivating duplicate: ${d.agent?.name} → ${d.project?.name}  (deployed ${d.deployedAt.toISOString().slice(0, 10)})`);
    } else {
      seen.set(key, d.id);
      console.log(`  Keeping (newest): ${d.agent?.name} → ${d.project?.name}  (deployed ${d.deployedAt.toISOString().slice(0, 10)})`);
    }
  }

  if (toDeactivate.length === 0) {
    console.log("✅ No duplicate deployments found.");
  } else {
    await db.agentDeployment.updateMany({
      where: { id: { in: toDeactivate } },
      data: { isActive: false },
    });
    console.log(`\n✅ Deactivated ${toDeactivate.length} duplicate deployment(s).`);
  }

  await db.$disconnect();
}

main().catch(console.error);
