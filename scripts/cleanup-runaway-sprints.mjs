/**
 * One-off cleanup for the 2026-06-12 runaway-sprint incident
 * (see fix(sprint-planner) commit e0ba014 for the root cause).
 *
 * For the affected project this script:
 *   1. Deletes every "[auto-planned]" sprint that has 0 tasks
 *   2. Demotes all ACTIVE sprints except the earliest task-bearing one
 *   3. Deletes the orphaned sprint-ceremony calendar events that belonged
 *      to the deleted sprints
 *
 * Dry-run by default — pass --apply to write.
 *   node scripts/cleanup-runaway-sprints.mjs "Digital Transformation"
 *   node scripts/cleanup-runaway-sprints.mjs "Digital Transformation" --apply
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "fs";

const nameFilter = process.argv[2] || "Digital Transformation";
const APPLY = process.argv.includes("--apply");

const env = readFileSync(".env", "utf8");
const url = (env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m) || [])[1];
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const project = await db.project.findFirst({
  where: { name: { contains: nameFilter } },
  select: { id: true, name: true },
});
if (!project) { console.error(`No project matching "${nameFilter}"`); process.exit(1); }
console.log(`Project: ${project.name} (${project.id})  —  ${APPLY ? "APPLYING" : "DRY RUN"}`);

const sprints = await db.sprint.findMany({
  where: { projectId: project.id },
  orderBy: { startDate: "asc" },
  select: { id: true, name: true, status: true, goal: true, startDate: true, _count: { select: { tasks: true } } },
});

// 1. Empty auto-planned sprints → delete
const junk = sprints.filter(s => s._count.tasks === 0 && (s.goal || "").includes("[auto-planned]"));
console.log(`1. Empty [auto-planned] sprints to delete: ${junk.length}`);

// 2. ACTIVE dedupe → keep earliest task-bearing ACTIVE, demote the rest
const junkIds = new Set(junk.map(s => s.id));
const actives = sprints.filter(s => s.status === "ACTIVE" && !junkIds.has(s.id));
const keepActive = actives.find(s => s._count.tasks > 0) || actives[0];
const demote = actives.filter(s => s.id !== keepActive?.id);
console.log(`2. ACTIVE sprints: ${actives.length} — keeping "${keepActive?.name}" (${keepActive?._count.tasks} tasks), demoting ${demote.length} to PLANNING`);

// 3. Ceremony events of deleted sprints ("Sprint N: Sprint Planning" etc.)
const junkEventTitles = junk.flatMap(s => [
  `${s.name}: Sprint Planning`,
  `${s.name}: Sprint Review & Demo`,
  `${s.name}: Retrospective`,
]);
const orphanEvents = await db.calendarEvent.count({
  where: { projectId: project.id, title: { in: junkEventTitles } },
});
console.log(`3. Orphaned ceremony calendar events to delete: ${orphanEvents}`);

if (!APPLY) {
  console.log("\nDry run complete — re-run with --apply to execute.");
} else {
  const delEvents = await db.calendarEvent.deleteMany({
    where: { projectId: project.id, title: { in: junkEventTitles } },
  });
  const delSprints = await db.sprint.deleteMany({ where: { id: { in: [...junkIds] } } });
  let demoted = 0;
  if (demote.length > 0) {
    const r = await db.sprint.updateMany({
      where: { id: { in: demote.map(s => s.id) } },
      data: { status: "PLANNING" },
    });
    demoted = r.count;
  }
  console.log(`\nApplied: ${delSprints.count} sprints deleted, ${demoted} demoted, ${delEvents.count} events deleted.`);
  const remaining = await db.sprint.findMany({
    where: { projectId: project.id },
    orderBy: { startDate: "asc" },
    select: { name: true, status: true, _count: { select: { tasks: true } } },
  });
  console.log("Remaining sprints:", remaining.map(s => `${s.name}[${s.status}]:${s._count.tasks}`).join(", "));
}
await db.$disconnect();
