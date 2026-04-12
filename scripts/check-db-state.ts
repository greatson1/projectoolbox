/**
 * Quick diagnostic: show all agents, projects, and deployments in the DB.
 * Run: npx tsx scripts/check-db-state.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter } as any);

async function main() {
  const orgs = await db.organisation.findMany({ select: { id: true, name: true, slug: true } });
  console.log("\n── Organisations ──────────────────────────────");
  orgs.forEach(o => console.log(`  ${o.name}  (${o.slug})  id: ${o.id}`));

  const projects = await db.project.findMany({
    select: { id: true, name: true, methodology: true, status: true, orgId: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`\n── Projects (${projects.length}) ─────────────────────────────`);
  projects.forEach(p => console.log(`  [${p.status}] ${p.name}  (${p.methodology})  orgId: ${p.orgId}`));

  const agents = await db.agent.findMany({
    select: { id: true, name: true, codename: true, status: true, orgId: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`\n── Agents (${agents.length}) ───────────────────────────────`);
  agents.forEach(a => console.log(`  [${a.status}] ${a.name}  (${a.codename || "no codename"})  orgId: ${a.orgId}`));

  const deps = await db.agentDeployment.findMany({
    include: {
      agent: { select: { name: true } },
      project: { select: { name: true, orgId: true } },
    },
    orderBy: { deployedAt: "desc" },
  });
  console.log(`\n── Deployments (${deps.length}) ─────────────────────────────`);
  deps.forEach(d => console.log(`  [${d.isActive ? "active" : "inactive"}] ${d.agent?.name} → ${d.project?.name}  (project orgId: ${d.project?.orgId})`));

  const users = await db.user.findMany({ select: { email: true, orgId: true, role: true } });
  console.log(`\n── Users (${users.length}) ──────────────────────────────────`);
  users.forEach(u => console.log(`  ${u.email}  role: ${u.role}  orgId: ${u.orgId}`));

  await db.$disconnect();
}

main().catch(console.error);
