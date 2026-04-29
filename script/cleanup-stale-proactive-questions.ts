/**
 * One-shot: walk every project's proactive_question chat messages and mark
 * any that target a now-resolved gap as answered=true (so the UI clears).
 *
 * Reuses the same isGapResolved logic that askUser now consults before
 * posting, applied retroactively to clean up the existing pollution.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --env-file=.env script/cleanup-stale-proactive-questions.ts
 *   npx tsx --env-file=.env.local --env-file=.env script/cleanup-stale-proactive-questions.ts --dry
 */
import { db } from "../src/lib/db";

const dryRun = process.argv.includes("--dry");

async function isBudgetResolved(agentId: string, projectId: string): Promise<boolean> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { budget: true } });
  if (project && project.budget != null && project.budget > 0) return true;
  const fact = await db.knowledgeBaseItem.findFirst({
    where: {
      agentId, projectId, trustLevel: "HIGH_TRUST",
      OR: [
        { title: { contains: "budget", mode: "insensitive" } },
        { tags: { has: "budget_confirmed" } },
      ],
    },
    select: { id: true },
  });
  return !!fact;
}

async function isSponsorResolved(agentId: string, projectId: string): Promise<boolean> {
  const fact = await db.knowledgeBaseItem.findFirst({
    where: {
      agentId, projectId, trustLevel: "HIGH_TRUST",
      title: { contains: "sponsor", mode: "insensitive" },
    },
    select: { id: true },
  });
  return !!fact;
}

async function main() {
  const deployments = await db.agentDeployment.findMany({
    where: { isActive: true },
    select: { agentId: true, projectId: true, project: { select: { name: true } } },
  });

  let scannedProjects = 0;
  let scannedMessages = 0;
  let resolved = 0;
  let alreadyAnswered = 0;
  let notMatched = 0;

  for (const dep of deployments) {
    if (!dep.projectId) continue;
    scannedProjects++;
    const projectName = dep.project?.name ?? dep.projectId;

    const pending = await db.chatMessage.findMany({
      where: {
        agentId: dep.agentId,
        role: "agent",
        metadata: { path: ["type"], equals: "proactive_question" },
      },
      select: { id: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    let projectResolved = 0;
    for (const msg of pending) {
      scannedMessages++;
      const meta = (msg.metadata as any) || {};
      if (meta.answered === true) { alreadyAnswered++; continue; }
      const q = (typeof meta.question === "string" ? meta.question : "").toLowerCase();
      let gapGone = false;
      if (q.includes("budget")) gapGone = await isBudgetResolved(dep.agentId, dep.projectId);
      else if (q.includes("sponsor")) gapGone = await isSponsorResolved(dep.agentId, dep.projectId);
      else { notMatched++; continue; }

      if (!gapGone) continue;

      if (dryRun) {
        console.log(`  [DRY] ${projectName}: would mark ${msg.id} (${msg.createdAt.toISOString().slice(0,19)}) "${meta.question}" as resolved`);
      } else {
        await db.chatMessage.update({
          where: { id: msg.id },
          data: {
            metadata: { ...meta, answered: true, autoProceeded: true, resolvedReason: "gap_resolved_cleanup" } as any,
          },
        });
      }
      resolved++;
      projectResolved++;
    }

    if (projectResolved > 0) console.log(`  ${projectName}: ${projectResolved} stale question(s) ${dryRun ? "would be" : ""} marked resolved`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Projects scanned:           ${scannedProjects}`);
  console.log(`  Proactive_questions seen:   ${scannedMessages}`);
  console.log(`  Already answered (skipped): ${alreadyAnswered}`);
  console.log(`  Not matched (other topics): ${notMatched}`);
  console.log(`  ${dryRun ? "Would mark" : "Marked"} resolved:        ${resolved}`);
}

main().catch(console.error).finally(() => db.$disconnect());
