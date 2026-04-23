/**
 * Sprint cleanup:
 *  1. Delete the 3 remaining meta-instruction tasks
 *  2. Restore Sprint 1 to ACTIVE status (seeder reset it to PLANNING)
 *  3. Verify final state is clean
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });
import { db } from "../src/lib/db.js";

const PROJECT_ID = "cmo07iu0b000004ldq6430lo6";

async function main() {
  // ── 1. Delete meta-instruction tasks ────────────────────────────────────────
  const deleted = await db.task.deleteMany({
    where: {
      projectId: PROJECT_ID,
      OR: [
        { title: { contains: "Create WBS" } },
        { title: { contains: "Generate project charter" } },
        { title: { contains: "Run sprint cycles" } },
        { title: { contains: "sprint cycles within" } },
        // Also the "Hire Commercial Property Agent" — real task but no sprint/source tag, not from Backlog CSV
        { AND: [
          { title: "Hire Commercial Property Agent" },
          { description: null },
        ]},
      ],
    },
  });
  console.log(`✓ Deleted ${deleted.count} meta-instruction task(s)`);

  // ── 2. Set Sprint 1 → ACTIVE (seeder reset it to PLANNING) ─────────────────
  const sprint1 = await db.sprint.findFirst({
    where: { projectId: PROJECT_ID, name: "Sprint 1" },
  });
  if (sprint1) {
    await db.sprint.update({
      where: { id: sprint1.id },
      data: { status: "ACTIVE" },
    });
    console.log(`✓ Sprint 1 set to ACTIVE (was ${sprint1.status})`);
  } else {
    console.log("Sprint 1 not found!");
  }

  // ── 3. Verify: check tasks with no sprint for WBS-sourced ones ──────────────
  // WBS tasks don't need sprint links — they're for Gantt/Scope hierarchy view.
  // Sprint tasks (from Backlog) should all be sprint-linked. Let's verify.
  const allTasks = await db.task.findMany({
    where: { projectId: PROJECT_ID },
    select: { id: true, title: true, description: true, sprintId: true, storyPoints: true },
    orderBy: [{ sprintId: "asc" }, { createdAt: "asc" }],
  });

  const sprintTasks = allTasks.filter(t => t.sprintId);
  const backlogTasks = allTasks.filter(t => !t.sprintId);
  const wbsTasks = backlogTasks.filter(t => t.description?.includes("[source:wbs]"));
  const orphans = backlogTasks.filter(t => !t.description?.includes("[source:wbs]"));

  console.log(`\n=== FINAL TASK STATE ===`);
  console.log(`Total tasks:          ${allTasks.length}`);
  console.log(`Sprint-linked tasks:  ${sprintTasks.length}`);
  console.log(`WBS/Gantt tasks:      ${wbsTasks.length} (backlog, no sprint needed)`);
  console.log(`Orphan tasks:         ${orphans.length} (no source, no sprint)`);
  if (orphans.length > 0) {
    console.log("  Orphans:");
    orphans.forEach(t => console.log(`    "${t.title.slice(0, 60)}"`));
  }

  // ── 4. Sprint summary ────────────────────────────────────────────────────────
  const sprints = await db.sprint.findMany({
    where: { projectId: PROJECT_ID },
    include: { tasks: { select: { id: true, title: true, storyPoints: true } } },
    orderBy: { startDate: "asc" },
  });

  console.log(`\n=== SPRINTS (${sprints.length}) ===`);
  for (const s of sprints) {
    const totalPts = s.tasks.reduce((acc, t) => acc + (t.storyPoints || 0), 0);
    console.log(`  [${s.status}] "${s.name}" — ${s.tasks.length} tasks / ${totalPts} pts`);
    s.tasks.forEach(t => console.log(`    • ${t.title.slice(0, 55)} (${t.storyPoints ?? "—"} pts)`));
  }
}

main().catch(console.error).finally(() => db.$disconnect());
