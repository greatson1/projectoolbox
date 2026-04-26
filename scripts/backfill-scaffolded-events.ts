/**
 * One-shot backfill: stamp linkedEvent markers onto scaffolded tasks that
 * predate the universal-task wiring. Idempotent and safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-scaffolded-events.ts                # dry-run
 *   npx tsx scripts/backfill-scaffolded-events.ts --apply        # write
 *   npx tsx scripts/backfill-scaffolded-events.ts --project=ID   # one project
 */

import { db } from "../src/lib/db";
import { backfillDescription } from "../src/lib/agents/scaffolded-task-backfill";

async function main() {
  const apply = process.argv.includes("--apply");
  const projectArg = process.argv.find(a => a.startsWith("--project="));
  const projectId = projectArg ? projectArg.split("=")[1] : null;

  console.log(apply ? "🔧 APPLY mode — will write changes" : "👀 DRY RUN — no changes will be written");
  if (projectId) console.log(`   scoped to project ${projectId}`);

  const tasks = await db.task.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      description: { contains: "[scaffolded]" },
      status: { not: "DONE" },
    },
    select: { id: true, projectId: true, title: true, description: true },
  });

  console.log(`Scanning ${tasks.length} candidate task${tasks.length === 1 ? "" : "s"}…\n`);

  const updates: Array<{ id: string; title: string; before: string; after: string }> = [];
  for (const t of tasks) {
    const next = backfillDescription(t.title, t.description);
    if (next) {
      updates.push({ id: t.id, title: t.title, before: t.description || "", after: next });
    }
  }

  if (updates.length === 0) {
    console.log("✅ Nothing to backfill — every scaffolded task already has its event marker.");
    return;
  }

  console.log(`Will patch ${updates.length} task${updates.length === 1 ? "" : "s"}:\n`);
  for (const u of updates) {
    console.log(`  • [${u.id.slice(-6)}] "${u.title}"`);
    console.log(`      ${u.before || "(empty)"}`);
    console.log(`    → ${u.after}\n`);
  }

  if (!apply) {
    console.log("Run again with --apply to commit these changes.");
    return;
  }

  let written = 0;
  for (const u of updates) {
    await db.task.update({ where: { id: u.id }, data: { description: u.after } });
    written += 1;
  }
  console.log(`\n✅ Wrote ${written} task description${written === 1 ? "" : "s"}.`);
}

main()
  .catch(e => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());