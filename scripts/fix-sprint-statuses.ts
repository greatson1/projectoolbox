import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });
import { db } from "../src/lib/db.js";

const PROJECT_ID = "cmo07iu0b000004ldq6430lo6";

async function main() {
  // Only Sprint 1 should be ACTIVE
  const result = await db.sprint.updateMany({
    where: {
      projectId: PROJECT_ID,
      name: { not: "Sprint 1" },
      status: "ACTIVE",
    },
    data: { status: "PLANNING" },
  });
  console.log(`Updated ${result.count} sprint(s) to PLANNING`);

  const sprints = await db.sprint.findMany({
    where: { projectId: PROJECT_ID },
    include: { tasks: { select: { id: true, storyPoints: true } } },
    orderBy: { startDate: "asc" },
  });
  sprints.forEach(s => {
    const pts = s.tasks.reduce((a, t) => a + (t.storyPoints || 0), 0);
    console.log(`  [${s.status}] "${s.name}" — ${s.tasks.length} tasks / ${pts} pts`);
  });
}

main().catch(console.error).finally(() => db.$disconnect());
