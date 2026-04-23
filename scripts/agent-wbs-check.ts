import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { db as prisma } from "../src/lib/db.js";

async function main() {
  // ── 1. All agents ─────────────────────────────────────────────────────────
  const agents = await prisma.agent.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, codename: true, status: true, autonomyLevel: true,
      createdAt: true, decommissionedAt: true,
    },
  });
  console.log(`\n=== AGENTS (${agents.length}) ===`);
  agents.forEach(a => {
    const status = a.decommissionedAt ? "DECOMMISSIONED" : a.status;
    console.log(`  [${status}] ${a.name} (${a.codename}) L${a.autonomyLevel} — ${a.id}`);
  });

  // ── 2. Active deployments + project/phase status ──────────────────────────
  const deployments = await prisma.agentDeployment.findMany({
    where: { isActive: true },
    include: {
      agent: { select: { name: true, status: true } },
      project: { select: { name: true, methodology: true, status: true } },
    },
    orderBy: { deployedAt: "asc" },
  });
  console.log(`\n=== ACTIVE DEPLOYMENTS (${deployments.length}) ===`);
  for (const d of deployments) {
    console.log(`\n  ${d.agent.name} → "${d.project?.name ?? "no project"}" (${d.project?.methodology})`);
    console.log(`    Phase: ${d.currentPhase ?? "—"}  Status: ${d.phaseStatus ?? "—"}  Health: ${d.healthStatus}`);
    console.log(`    Last cycle: ${d.lastCycleAt ?? "never"}  Next: ${d.nextCycleAt ?? "—"}`);
    console.log(`    Deployment ID: ${d.id}  Project ID: ${d.projectId}`);
  }

  // ── 3. Per-project: tasks, sprints, phases, artefacts ─────────────────────
  const projectIds = [...new Set(deployments.map(d => d.projectId).filter(Boolean))] as string[];

  for (const projectId of projectIds) {
    const dep = deployments.find(d => d.projectId === projectId)!;
    const proj = dep.project;
    console.log(`\n━━━ PROJECT: "${proj?.name}" (${projectId}) ━━━`);

    // Phases
    const phases = await prisma.phase.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
      select: { id: true, name: true, status: true, order: true, artefacts: true },
    });
    console.log(`\n  Phases (${phases.length}):`);
    phases.forEach(p => console.log(`    [${p.status}] ${p.order}. ${p.name}  artefact selections: ${JSON.stringify(p.artefacts)?.slice(0, 60)}`));

    // Tasks
    const tasks = await prisma.task.findMany({ where: { projectId } });
    const byStatus = tasks.reduce((acc: Record<string,number>, t) => { acc[t.status] = (acc[t.status]||0)+1; return acc; }, {});
    console.log(`\n  Tasks (${tasks.length}): ${JSON.stringify(byStatus)}`);

    // Sprints
    const sprints = await prisma.sprint.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
    console.log(`\n  Sprints (${sprints.length}):`);
    sprints.forEach(s => console.log(`    [${s.status}] "${s.name}" goal: ${s.goal?.slice(0,60) ?? "—"}`));

    // Agent artefacts
    const artefacts = await prisma.agentArtefact.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: { name: true, status: true, phaseId: true, createdAt: true },
    });
    console.log(`\n  Artefacts (${artefacts.length}):`);
    artefacts.forEach(a => console.log(`    [${a.status}] ${a.name}`));

    // Agile check: tasks linked to sprints
    const tasksWithSprint = tasks.filter(t => t.sprintId);
    const tasksWithPhase  = tasks.filter(t => t.phaseId);
    const tasksWithWbs    = tasks.filter(t => (t as any).wbsCode || (t as any).wbsId);
    console.log(`\n  Linkage:`);
    console.log(`    tasks with sprintId: ${tasksWithSprint.length}/${tasks.length}`);
    console.log(`    tasks with phaseId:  ${tasksWithPhase.length}/${tasks.length}`);
    console.log(`    tasks with WBS ref:  ${tasksWithWbs.length}/${tasks.length}`);
  }

  // ── 4. WBS check: look for any WBS artefacts and see if tasks link back ───
  console.log(`\n=== WBS ARTEFACT CHECK ===`);
  const wbsArtefacts = await prisma.agentArtefact.findMany({
    where: { name: { contains: "WBS", mode: "insensitive" } },
    select: { id: true, name: true, status: true, projectId: true, content: true, createdAt: true },
  });
  console.log(`WBS artefacts in DB: ${wbsArtefacts.length}`);
  wbsArtefacts.forEach(a => {
    console.log(`  [${a.status}] "${a.name}" (project ${a.projectId})`);
    const preview = (a.content || "").slice(0, 200);
    console.log(`    Content preview: ${preview}`);
  });

  // ── 5. Report artefacts (check schedule/gantt type) ───────────────────────
  const reports = await prisma.report.findMany({
    where: { type: { in: ["STATUS", "EVM", "SPRINT"] } },
    select: { id: true, type: true, title: true, projectId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(`\n=== RECENT REPORTS (${reports.length}) ===`);
  reports.forEach(r => console.log(`  [${r.type}] "${r.title}" — project ${r.projectId}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
