import { db } from "../src/lib/db";

async function main() {
  const agent = await db.agent.findFirst({
    where: { name: { contains: "Halo" } },
    include: {
      deployments: { where: { isActive: true }, take: 1 },
    },
  });

  if (!agent) { console.log("No Halo agent found"); await db.$disconnect(); return; }

  const dep = agent.deployments[0];
  console.log("\n=== AGENT ===");
  console.log(`Name: ${agent.name} | Autonomy: L${agent.autonomyLevel} | Status: ${agent.status}`);
  console.log(`Deployment: ${dep?.id} | Phase: ${dep?.currentPhase} | Phase status: ${dep?.phaseStatus}`);
  console.log(`Last cycle: ${dep?.lastCycleAt} | Next cycle: ${dep?.nextCycleAt}`);

  const projectId = dep?.projectId;
  if (!projectId) { console.log("No active project"); await db.$disconnect(); return; }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true, budget: true, createdAt: true },
  });
  console.log("\n=== PROJECT ===");
  console.log(`Name: ${project?.name} | Status: ${project?.status} | Budget: £${project?.budget?.toLocaleString()}`);
  console.log(`Created: ${project?.createdAt}`);

  const [artefacts, risks, tasks, approvals, jobs, activities] = await Promise.all([
    db.agentArtefact.findMany({ where: { agentId: agent.id }, select: { id: true, name: true, status: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.risk.findMany({ where: { projectId }, select: { id: true, title: true, status: true, score: true }, orderBy: { score: "desc" } }),
    db.task.findMany({ where: { projectId }, select: { id: true, title: true, status: true } }),
    db.approval.findMany({ where: { projectId, status: "PENDING" }, select: { id: true, title: true, type: true, createdAt: true } }),
    db.agentJob.findMany({ where: { agentId: agent.id }, select: { id: true, type: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.agentActivity.findMany({ where: { agentId: agent.id }, select: { id: true, type: true, summary: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  console.log(`\n=== ARTEFACTS (${artefacts.length}) ===`);
  artefacts.forEach(a => console.log(`  [${a.status}] ${a.name}`));

  console.log(`\n=== RISKS (${risks.length}) ===`);
  risks.forEach(r => console.log(`  [${r.status}] ${(r.title||"").slice(0,80)} (score: ${r.score})`));

  console.log(`\n=== TASKS (${tasks.length}) ===`);
  tasks.forEach(t => console.log(`  [${t.status}] ${t.title?.slice(0,70)}`));

  console.log(`\n=== PENDING APPROVALS (${approvals.length}) ===`);
  approvals.forEach(a => console.log(`  [${a.type}] ${a.title?.slice(0,80)}`));

  console.log(`\n=== RECENT JOBS (last 5) ===`);
  jobs.forEach(j => console.log(`  [${j.status}] ${j.type} — ${j.createdAt}`));

  console.log(`\n=== RECENT ACTIVITY (last 10) ===`);
  activities.forEach(a => console.log(`  [${a.type}] ${a.summary?.slice(0,100)} — ${a.createdAt}`));

  const org = await db.organisation.findFirst({ select: { creditBalance: true, plan: true } });
  console.log(`\n=== ORG ===`);
  console.log(`Plan: ${org?.plan} | Credits: ${org?.creditBalance?.toLocaleString()}`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
