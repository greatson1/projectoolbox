/**
 * One-shot: hard-delete a project + every dependent row.
 *
 * The wipe-agent-for-fresh-deploy script archives an agent and clears
 * its work but PRESERVES the Project row. Use THIS script when you
 * want the entire project gone — typically to clean up a duplicate or
 * abandoned project.
 *
 * Order of deletion respects FK dependencies. Wraps in a transaction so
 * either everything goes or nothing does.
 *
 * Usage:
 *   DRY_RUN=1 npx tsx -r dotenv/config script/delete-project.ts "<name substring>"
 *   npx tsx -r dotenv/config script/delete-project.ts "<name substring>"
 */

import { db } from "../src/lib/db";

async function main() {
  const projectQuery = process.argv[2];
  if (!projectQuery) {
    console.error('Usage: npx tsx script/delete-project.ts "<project name substring>"');
    process.exit(1);
  }
  const dryRun = process.env.DRY_RUN === "1";

  console.log(`\n${dryRun ? "🔍 DRY RUN" : "⚠️  HARD-DELETING"} project "${projectQuery}"\n`);

  // 1. Resolve project (must be exactly one)
  const projects = await db.project.findMany({
    where: { name: { contains: projectQuery, mode: "insensitive" } },
    select: { id: true, name: true, orgId: true },
  });
  if (projects.length === 0) {
    console.error(`❌ No projects matching "${projectQuery}"`);
    process.exit(1);
  }
  if (projects.length > 1) {
    console.error(`❌ ${projects.length} projects match "${projectQuery}" — be more specific:`);
    projects.forEach(p => console.error(`   - ${p.name} (${p.id})`));
    process.exit(1);
  }
  const project = projects[0];
  console.log(`📁 Project: ${project.name} (${project.id})`);

  // 2. Count what we're about to drop
  const [
    artefacts,
    kbItems,
    approvals,
    activities,
    chatMessages,
    deployments,
    phases,
    tasks,
    risks,
    stakeholders,
    issues,
    costEntries,
    sprints,
    calendarEvents,
    meetings,
  ] = await Promise.all([
    db.agentArtefact.count({ where: { projectId: project.id } }),
    db.knowledgeBaseItem.count({ where: { projectId: project.id } }),
    db.approval.count({ where: { projectId: project.id } }),
    db.agentActivity.count({ where: { agent: { deployments: { some: { projectId: project.id } } } } }),
    db.chatMessage.count({ where: { agent: { deployments: { some: { projectId: project.id } } } } }),
    db.agentDeployment.count({ where: { projectId: project.id } }),
    db.phase.count({ where: { projectId: project.id } }),
    db.task.count({ where: { projectId: project.id } }),
    db.risk.count({ where: { projectId: project.id } }),
    db.stakeholder.count({ where: { projectId: project.id } }),
    db.issue.count({ where: { projectId: project.id } }),
    db.costEntry.count({ where: { projectId: project.id } }),
    db.sprint.count({ where: { projectId: project.id } }),
    db.calendarEvent.count({ where: { projectId: project.id } }),
    db.meeting.count({ where: { projectId: project.id } }),
  ]);

  console.log(`\n📊 Dependent rows that will be deleted:`);
  console.log(`   • AgentArtefact:                       ${artefacts}`);
  console.log(`   • KnowledgeBaseItem:                   ${kbItems}`);
  console.log(`   • Approval:                            ${approvals}`);
  console.log(`   • AgentDeployment:                     ${deployments}`);
  console.log(`   • Phase:                               ${phases}`);
  console.log(`   • Task:                                ${tasks}`);
  console.log(`   • Risk:                                ${risks}`);
  console.log(`   • Stakeholder:                         ${stakeholders}`);
  console.log(`   • Issue:                               ${issues}`);
  console.log(`   • CostEntry:                           ${costEntries}`);
  console.log(`   • Sprint:                              ${sprints}`);
  console.log(`   • CalendarEvent:                       ${calendarEvents}`);
  console.log(`   • Meeting:                             ${meetings}`);
  console.log(`   • (chat + activity rows on project's agents stay; ${chatMessages} chats / ${activities} activities)`);

  if (dryRun) {
    console.log(`\n✅ DRY RUN complete — re-run without DRY_RUN=1 to actually delete.\n`);
    return;
  }

  console.log(`\n⏳ Executing delete...\n`);

  await db.$transaction(async (tx) => {
    // Delete in FK order — children before parents.
    // Cost entries first (Task/Sprint may reference indirectly)
    await tx.costEntry.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.meetingActionItem.deleteMany({
      where: { meeting: { projectId: project.id } },
    }).catch(() => {});
    await tx.meeting.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.calendarEvent.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.task.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.sprint.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.issue.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.risk.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.stakeholder.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.agentArtefact.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.knowledgeBaseItem.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.approval.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.phase.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.projectEmbedding.deleteMany({ where: { projectId: project.id } }).catch(() => {});
    await tx.agentDeployment.deleteMany({ where: { projectId: project.id } }).catch(() => {});

    // Project row last
    await tx.project.delete({ where: { id: project.id } });

    // Audit
    await tx.auditLog.create({
      data: {
        orgId: project.orgId,
        action: "PROJECT_HARD_DELETED",
        target: project.name,
        entityType: "project",
        entityId: project.id,
        rationale: `Project + all dependent rows deleted via script (counts above).`,
        details: { artefacts, kbItems, approvals, phases, tasks, risks, stakeholders } as any,
      },
    }).catch(() => {});
  });

  console.log(`✅ Project "${project.name}" deleted.\n`);
}

main()
  .catch(e => { console.error("\n❌ Delete failed:", e); process.exit(1); })
  .finally(() => db.$disconnect());
