import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { db as prisma } from "../src/lib/db.js";

const PROJECT_ID = "cmo07iu0b000004ldq6430lo6"; // New Restaurant Setup

async function main() {
  // ── WBS artefact content ──────────────────────────────────────────────────
  console.log("\n=== WBS ARTEFACT (full content) ===");
  const wbs = await prisma.agentArtefact.findFirst({
    where: { projectId: PROJECT_ID, name: { contains: "WBS", mode: "insensitive" } },
    select: { id: true, name: true, status: true, content: true, metadata: true, createdAt: true },
  });
  if (wbs) {
    console.log(`[${wbs.status}] ${wbs.name} — created ${wbs.createdAt}`);
    console.log(wbs.content?.slice(0, 1500));
  } else {
    console.log("No WBS artefact found!");
  }

  // ── Backlog artefact content ──────────────────────────────────────────────
  console.log("\n=== BACKLOG ARTEFACT (first 1500 chars) ===");
  const backlog = await prisma.agentArtefact.findFirst({
    where: { projectId: PROJECT_ID, name: { contains: "Backlog", mode: "insensitive" } },
    select: { id: true, name: true, status: true, content: true, createdAt: true },
  });
  if (backlog) {
    console.log(`[${backlog.status}] ${backlog.name} — created ${backlog.createdAt}`);
    console.log(backlog.content?.slice(0, 1500));
  } else {
    console.log("No Backlog artefact found!");
  }

  // ── Sprint Plans artefact ─────────────────────────────────────────────────
  console.log("\n=== SPRINT PLANS ARTEFACT (first 1000 chars) ===");
  const sprintPlans = await prisma.agentArtefact.findFirst({
    where: { projectId: PROJECT_ID, name: { contains: "Sprint", mode: "insensitive" } },
    select: { id: true, name: true, status: true, content: true, createdAt: true },
  });
  if (sprintPlans) {
    console.log(`[${sprintPlans.status}] ${sprintPlans.name} — created ${sprintPlans.createdAt}`);
    console.log(sprintPlans.content?.slice(0, 1000));
  }

  // ── Schedule Baseline artefact ────────────────────────────────────────────
  console.log("\n=== SCHEDULE BASELINE (first 1000 chars) ===");
  const schedule = await prisma.agentArtefact.findFirst({
    where: { projectId: PROJECT_ID, name: { contains: "Schedule", mode: "insensitive" } },
    select: { id: true, name: true, status: true, content: true, createdAt: true },
  });
  if (schedule) {
    console.log(`[${schedule.status}] ${schedule.name} — created ${schedule.createdAt}`);
    console.log(schedule.content?.slice(0, 1000));
  }

  // ── Sprint details ────────────────────────────────────────────────────────
  console.log("\n=== SPRINT DETAILS ===");
  const sprints = await prisma.sprint.findMany({
    where: { projectId: PROJECT_ID },
    include: { tasks: { select: { id: true, title: true, status: true } } },
  });
  sprints.forEach(s => {
    console.log(`[${s.status}] "${s.name}" — ${s.tasks.length} tasks linked`);
    if (s.tasks.length > 0) s.tasks.slice(0, 5).forEach(t => console.log(`  - [${t.status}] ${t.title}`));
  });

  // ── All tasks with their links ────────────────────────────────────────────
  console.log("\n=== ALL TASKS (linkage) ===");
  const tasks = await prisma.task.findMany({
    where: { projectId: PROJECT_ID },
    select: {
      id: true, title: true, status: true, sprintId: true, phaseId: true,
      priority: true, storyPoints: true, startDate: true, endDate: true,
    },
    orderBy: { createdAt: "asc" },
  });
  tasks.forEach(t => {
    const sprint = t.sprintId ? `sprint:${t.sprintId.slice(-6)}` : "no-sprint";
    const phase  = t.phaseId  ? `phase:${t.phaseId.slice(-6)}`  : "no-phase";
    console.log(`  [${t.status}] "${t.title}" | ${sprint} | ${phase} | pts:${t.storyPoints ?? "—"}`);
  });

  // ── Agile board linkage check ─────────────────────────────────────────────
  console.log("\n=== AGILE BOARD LINKAGE SUMMARY ===");
  const activeSprint = sprints.find(s => s.status === "ACTIVE");
  if (activeSprint) {
    console.log(`Active sprint: "${activeSprint.name}" (${activeSprint.id})`);
    console.log(`Tasks in sprint: ${activeSprint.tasks.length}`);
    console.log(`Total tasks in project: ${tasks.length}`);
    console.log(`Tasks with NO sprint: ${tasks.filter(t => !t.sprintId).length}`);
    console.log(`Tasks with NO phase: ${tasks.filter(t => !t.phaseId).length}`);
  } else {
    console.log("No active sprint found");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
