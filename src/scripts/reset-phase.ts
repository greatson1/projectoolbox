import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const projectId = "cmnvf1895000004jp6d49dqeo";

const rawUrl = process.env.DATABASE_URL!;
const separator = rawUrl.includes("?") ? "&" : "?";
const connectionString = rawUrl.includes("pgbouncer") ? rawUrl : `${rawUrl}${separator}pgbouncer=true`;
const adapter = new PrismaPg({ connectionString });
const db = new PrismaClient({ adapter } as any);

async function main() {
  const phases = await db.phase.findMany({
    where: { projectId },
    select: { id: true, name: true, status: true },
    orderBy: { order: "asc" },
  });
  console.log("Current phases:", JSON.stringify(phases, null, 2));

  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    select: { id: true, currentPhase: true, phaseStatus: true },
  });
  console.log("Deployment:", JSON.stringify(deployment, null, 2));

  if (!deployment) { console.log("No active deployment found"); return; }

  const cdPhase = phases.find(p => p.name === "Continuous Delivery");
  const reviewPhase = phases.find(p => p.name === "Review");

  if (cdPhase) {
    await db.phase.update({ where: { id: cdPhase.id }, data: { status: "ACTIVE" } });
    console.log("✓ Continuous Delivery → ACTIVE");
  }
  if (reviewPhase) {
    await db.phase.update({ where: { id: reviewPhase.id }, data: { status: "PENDING" } });
    console.log("✓ Review → PENDING");
  }

  await db.agentDeployment.update({
    where: { id: deployment.id },
    data: { currentPhase: "Continuous Delivery", phaseStatus: "active" },
  });
  console.log("✓ Deployment currentPhase → Continuous Delivery");

  const after = await db.phase.findMany({
    where: { projectId },
    select: { name: true, status: true },
    orderBy: { order: "asc" },
  });
  console.log("After reset:", JSON.stringify(after, null, 2));
}

main().catch(console.error).finally(() => db.$disconnect());
