/**
 * Fix: Re-seed WBS tasks and wire sprint links for New Restaurant Setup
 *
 * What this does:
 *   1. Delete meta-instruction tasks (agent self-instructions, not real work)
 *   2. Delete all scaffolded placeholder tasks
 *   3. Re-run Backlog seeder → creates [source:sprint] tasks with sprint assignments
 *   4. Run sprint planner → assigns remaining unlinked tasks, fills gaps
 *   5. Report final state
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });
import { db } from "../src/lib/db.js";

const PROJECT_ID   = "cmo07iu0b000004ldq6430lo6";
const AGENT_ID     = "cmo07iv9b000104ldes";  // Bravo — from task createdBy fields
const BACKLOG_ID   = "cmo0hdid0000d04ie2ahvphu6";
const WBS_ID       = "cmo0hc7jk000904ievmo80alx";

// ── Phase lookup for mapping WBS deliverable groups → project phases ──────────
const WBS_TO_PHASE: Record<string, string> = {
  "project setup":    "Foundation",
  "requirements":     "Planning",
  "design":           "Iterative Delivery",
  "build":            "Iterative Delivery",
  "test":             "Iterative Delivery",
  "deploy":           "Iterative Delivery",
  "closure":          "Closure",
};

async function main() {
  // ── 0. Load project phases ───────────────────────────────────────────────────
  const phases = await db.phase.findMany({
    where: { projectId: PROJECT_ID },
    select: { id: true, name: true },
  });
  const phaseByName = Object.fromEntries(phases.map(p => [p.name.toLowerCase(), p.id]));
  console.log("Phases:", Object.keys(phaseByName).join(", "));

  // ── 1. Delete meta-instruction tasks (no source tag, agent-created junk) ─────
  const metaTitles = [
    "Create WBS for governance phases and product backlog",
    "Generate project charter with hybrid delivery approach",
    "Run sprint cycles within the delivery phase",
    "Hire Commercial Property Agent",
  ];
  const deletedMeta = await db.task.deleteMany({
    where: {
      projectId: PROJECT_ID,
      title: { in: metaTitles.map(t => t.slice(0, 50)) },
    },
  });
  // Widen — delete any task that looks like a meta-instruction
  const deletedMeta2 = await db.task.deleteMany({
    where: {
      projectId: PROJECT_ID,
      createdBy: `agent:${AGENT_ID}`,
      OR: [
        { title: { contains: "Create WBS" } },
        { title: { contains: "Generate project charter" } },
        { title: { contains: "Run sprint cycles" } },
        { title: { contains: "sprint cycles within" } },
      ],
    },
  });
  console.log(`\n✓ Deleted ${deletedMeta.count + deletedMeta2.count} meta-instruction task(s)`);

  // ── 2. Delete ALL agent-scaffolded tasks so we can re-seed cleanly ───────────
  const deletedScaffolded = await db.task.deleteMany({
    where: {
      projectId: PROJECT_ID,
      createdBy: `agent:${AGENT_ID}`,
      OR: [
        { description: { contains: "[scaffolded]" } },
        { description: { contains: "[source:wbs]" } },
        { description: { contains: "[source:sprint]" } },
        { description: null },  // tasks with no description (leftover meta)
      ],
    },
  });
  console.log(`✓ Deleted ${deletedScaffolded.count} scaffolded/stale task(s)`);

  // Delete the leftover "Hire Commercial Property Agent" task (has story points but no tag)
  const deletedHire = await db.task.deleteMany({
    where: { projectId: PROJECT_ID, title: "Hire Commercial Property Agent" },
  });
  if (deletedHire.count) console.log(`✓ Deleted ${deletedHire.count} extra untagged task(s)`);

  // ── 3. Re-seed from Backlog artefact ─────────────────────────────────────────
  const backlog = await db.agentArtefact.findUnique({
    where: { id: BACKLOG_ID },
    select: { id: true, name: true, status: true, content: true, format: true },
  });
  if (!backlog?.content) throw new Error("Backlog artefact not found or has no content");
  console.log(`\nSeeding from [${backlog.status}] ${backlog.name}...`);

  const { seedArtefactData } = await import("../src/lib/agents/artefact-seeders.js");
  await seedArtefactData(
    { id: backlog.id, name: backlog.name, format: backlog.format, content: backlog.content, projectId: PROJECT_ID },
    AGENT_ID,
  );

  // ── 4. Also re-seed WBS for hierarchy / Gantt view ───────────────────────────
  // WBS creates [source:wbs] tasks with parent→child hierarchy for the Scope/Gantt pages.
  // We run it AFTER the Backlog seeder so sprint-linked Backlog tasks take precedence
  // for the Agile board, while WBS tasks serve the Gantt.
  // Skip for now — Backlog is the source of truth for an Agile project.
  // Uncomment if you want Gantt tasks too:
  //
  // const wbs = await db.agentArtefact.findUnique({ where: { id: WBS_ID }, select: { id:true, name:true, format:true, content:true } });
  // if (wbs?.content) {
  //   const { parseScheduleArtefactIntoTasks } = await import("../src/lib/agents/schedule-parser.js");
  //   await parseScheduleArtefactIntoTasks({ ...wbs, projectId: PROJECT_ID }, AGENT_ID);
  // }

  // ── 5. Run sprint planner on any remaining unlinked tasks ────────────────────
  const unlinked = await db.task.count({ where: { projectId: PROJECT_ID, sprintId: null } });
  console.log(`\nTasks with no sprint after seeding: ${unlinked}`);
  if (unlinked > 0) {
    const { planSprints } = await import("../src/lib/agents/sprint-planner.js");
    const result = await planSprints(AGENT_ID, PROJECT_ID);
    console.log(`✓ Sprint planner: ${result.sprints} sprint(s) created, ${result.tasksAssigned} tasks assigned, ${result.pointsPlanned} pts`);
  }

  // ── 6. Final state report ────────────────────────────────────────────────────
  const finalTasks = await db.task.findMany({
    where: { projectId: PROJECT_ID },
    select: { id: true, title: true, sprintId: true, phaseId: true, storyPoints: true, description: true },
    orderBy: { createdAt: "asc" },
  });
  const finalSprints = await db.sprint.findMany({
    where: { projectId: PROJECT_ID },
    include: { tasks: { select: { id: true } } },
    orderBy: { startDate: "asc" },
  });

  console.log(`\n=== FINAL STATE ===`);
  console.log(`Total tasks: ${finalTasks.length}`);
  console.log(`  With sprintId:  ${finalTasks.filter(t => t.sprintId).length}`);
  console.log(`  With phaseId:   ${finalTasks.filter(t => t.phaseId).length}`);
  console.log(`  With storyPts:  ${finalTasks.filter(t => t.storyPoints).length}`);
  console.log(`\nSprints (${finalSprints.length}):`);
  finalSprints.forEach(s => console.log(`  [${s.status}] "${s.name}" — ${s.tasks.length} tasks`));
  console.log(`\nTasks by sprint:`);
  finalTasks.forEach(t => {
    const src = t.description?.match(/\[source:[^\]]+\]/)?.[0] || "no-tag";
    const sprint = t.sprintId ? finalSprints.find(s => s.id === t.sprintId)?.name || "?" : "BACKLOG";
    console.log(`  [${src}] "${t.title.slice(0, 50)}" → ${sprint} | pts:${t.storyPoints ?? "—"}`);
  });
}

main().catch(console.error).finally(() => db.$disconnect());
