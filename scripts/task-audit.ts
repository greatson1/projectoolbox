import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });
import { db as prisma } from "../src/lib/db.js";

const PROJECT_ID = "cmo07iu0b000004ldq6430lo6";

async function main() {
  // Tasks with source tags
  const tasks = await prisma.task.findMany({
    where: { projectId: PROJECT_ID },
    select: { id: true, title: true, description: true, sprintId: true, phaseId: true, createdBy: true, storyPoints: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n=== ALL TASKS (${tasks.length}) ===`);
  tasks.forEach(t => {
    const src = t.description?.match(/\[source:[^\]]+\]/)?.[0] || t.description?.includes("[scaffolded]") ? "[scaffolded]" : "no-tag";
    const sprint = t.sprintId ? `sprint:${t.sprintId.slice(-6)}` : "no-sprint";
    const phase = t.phaseId ? `phase:${t.phaseId.slice(-6)}` : "no-phase";
    console.log(`  [${src}] "${t.title.slice(0, 50)}" | ${sprint} | ${phase} | pts:${t.storyPoints ?? "—"} | by:${t.createdBy?.slice(0, 25)}`);
  });

  // Sprints
  const sprints = await prisma.sprint.findMany({
    where: { projectId: PROJECT_ID },
    include: { tasks: { select: { id: true, title: true } } },
  });
  console.log(`\n=== SPRINTS (${sprints.length}) ===`);
  sprints.forEach(s => {
    console.log(`  [${s.status}] "${s.name}" | tasks:${s.tasks.length} | goal: ${s.goal?.slice(0, 70)}`);
  });

  // Phases
  const phases = await prisma.phase.findMany({
    where: { projectId: PROJECT_ID },
    select: { id: true, name: true, status: true, order: true },
    orderBy: { order: "asc" },
  });
  console.log(`\n=== PHASES (${phases.length}) ===`);
  phases.forEach(p => console.log(`  [${p.status}] ${p.order}. "${p.name}" — ${p.id}`));

  // Backlog artefact content
  const backlog = await prisma.agentArtefact.findFirst({
    where: { projectId: PROJECT_ID, name: "Backlog" },
    select: { id: true, name: true, status: true, content: true },
  });
  console.log(`\n=== BACKLOG CONTENT (first 1500 chars) ===`);
  if (backlog) {
    console.log(`[${backlog.status}] ${backlog.name}`);
    console.log(backlog.content?.slice(0, 1500));
  } else {
    console.log("NOT FOUND");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
