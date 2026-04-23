/**
 * Cleanup: Remove stale WBS tasks and meta-instruction tasks.
 * Does NOT rely on createdBy so agent ID truncation is not an issue.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });
import { db } from "../src/lib/db.js";

const PROJECT_ID = "cmo07iu0b000004ldq6430lo6";

async function main() {
  // 1. Delete [source:wbs] tasks — these are superseded by [source:sprint] tasks from Backlog
  const wbs = await db.task.deleteMany({
    where: { projectId: PROJECT_ID, description: { contains: "[source:wbs]" } },
  });
  console.log(`✓ Deleted ${wbs.count} [source:wbs] tasks`);

  // 2. Delete meta-instruction tasks (agent self-instructions that pollute the board)
  const meta = await db.task.deleteMany({
    where: {
      projectId: PROJECT_ID,
      description: { not: { contains: "[source:sprint]" } },
      OR: [
        { title: { contains: "Create WBS" } },
        { title: { contains: "Generate project charter" } },
        { title: { contains: "sprint cycles" } },
        { title: { contains: "Hire Commercial Property Agent" } },
      ],
    },
  });
  console.log(`✓ Deleted ${meta.count} meta-instruction task(s)`);

  // 3. Final state
  const tasks = await db.task.findMany({
    where: { projectId: PROJECT_ID },
    select: { id: true, title: true, sprintId: true, storyPoints: true, description: true },
    orderBy: { createdAt: "asc" },
  });
  const sprints = await db.sprint.findMany({
    where: { projectId: PROJECT_ID },
    include: { tasks: { select: { id: true } } },
    orderBy: { startDate: "asc" },
  });

  console.log(`\n=== FINAL STATE ===`);
  console.log(`Tasks: ${tasks.length} | With sprint: ${tasks.filter(t => t.sprintId).length} | With pts: ${tasks.filter(t => t.storyPoints).length}`);
  console.log(`\nSprints (${sprints.length}):`);
  sprints.forEach(s => console.log(`  "${s.name}" — ${s.tasks.length} tasks`));
  console.log(`\nTask list:`);
  tasks.forEach(t => {
    const sprintName = t.sprintId ? sprints.find(s => s.id === t.sprintId)?.name || "?" : "BACKLOG";
    console.log(`  "${t.title.slice(0, 55)}" → ${sprintName} | pts:${t.storyPoints ?? "—"}`);
  });
}

main().catch(console.error).finally(() => db.$disconnect());
