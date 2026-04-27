/**
 * One-shot: archive a project's active agent + wipe its agent-scoped work
 * so a fresh agent can be deployed against the same project and exercise
 * the new research → approve → clarify → generate flow from a clean slate.
 *
 * Usage:
 *   DRY_RUN=1 npx tsx script/wipe-agent-for-fresh-deploy.ts "Training Course"
 *   npx tsx script/wipe-agent-for-fresh-deploy.ts "Training Course"
 *
 * The argument is a substring match on the project name (case-insensitive).
 *
 * What it does:
 *   1. Find the project + its active agent (errors out if 0 or >1 match)
 *   2. Print scope: agent name, deployment id, counts to delete
 *   3. If DRY_RUN — stop here. Otherwise:
 *   4. In one transaction:
 *      - Archive agent (status=ARCHIVED + cancel jobs + deactivate deployment)
 *      - Delete AgentArtefact rows for the project
 *      - Delete KnowledgeBaseItem rows for the agent (research, chat, fact)
 *      - Reject + delete pending Approval rows on the project
 *      - Reset Phase audit timestamps (research/clarification/gate)
 *      - Reset Phase status to PENDING (first phase becomes ACTIVE on new deploy)
 *   5. Print summary
 *
 * Preserved: Project row, Stakeholders, Risks, Tasks (scaffolded PM work),
 * Phase rows themselves, agent ChatMessage history, AuditLog entries.
 */

import { db } from "../src/lib/db";

async function main() {
  const projectQuery = process.argv[2];
  if (!projectQuery) {
    console.error("Usage: npx tsx script/wipe-agent-for-fresh-deploy.ts \"<project name substring>\"");
    process.exit(1);
  }
  const dryRun = process.env.DRY_RUN === "1";

  console.log(`\n${dryRun ? "🔍 DRY RUN" : "⚠️  EXECUTING WIPE"} — project query: "${projectQuery}"\n`);

  // 1. Find project
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
    projects.forEach((p) => console.error(`   - ${p.name} (${p.id})`));
    process.exit(1);
  }
  const project = projects[0];
  console.log(`📁 Project: ${project.name} (${project.id})`);

  // 2. Find ACTIVE agent on this project
  const deployments = await db.agentDeployment.findMany({
    where: { projectId: project.id, isActive: true },
    include: { agent: { select: { id: true, name: true, status: true } } },
  });
  if (deployments.length === 0) {
    console.error(`❌ No active agent on this project — nothing to archive.`);
    process.exit(1);
  }
  const deployment = deployments[0];
  console.log(`🤖 Agent: ${deployment.agent.name} (${deployment.agent.id}), deployment ${deployment.id}`);

  // 3. Count what will be deleted
  const [artefactCount, kbCount, pendingApprovalCount, allApprovalCount, phaseCount] = await Promise.all([
    db.agentArtefact.count({ where: { projectId: project.id } }),
    db.knowledgeBaseItem.count({ where: { agentId: deployment.agent.id, projectId: project.id } }),
    db.approval.count({ where: { projectId: project.id, status: "PENDING" } }),
    db.approval.count({ where: { projectId: project.id } }),
    db.phase.count({ where: { projectId: project.id } }),
  ]);

  console.log(`\n📊 Scope:`);
  console.log(`   • AgentArtefact rows to delete:        ${artefactCount}`);
  console.log(`   • KnowledgeBaseItem rows to delete:    ${kbCount}`);
  console.log(`   • Pending Approval rows to reject:     ${pendingApprovalCount}  (of ${allApprovalCount} total — non-pending preserved)`);
  console.log(`   • Phase rows to reset:                 ${phaseCount}  (timestamps cleared, status reset)`);
  console.log(`   • Agent to archive:                    ${deployment.agent.name}`);

  console.log(`\n📦 Preserved:`);
  console.log(`   • Project row + name/budget/dates`);
  console.log(`   • Stakeholders (seeded by methodology template)`);
  console.log(`   • Risks (seeded)`);
  console.log(`   • Tasks (scaffolded PM tasks)`);
  console.log(`   • Phase rows themselves`);
  console.log(`   • Agent ChatMessage history (audit trail)`);
  console.log(`   • Resolved (APPROVED/REJECTED) Approval rows (audit trail)`);
  console.log(`   • AuditLog entries`);

  if (dryRun) {
    console.log(`\n✅ DRY RUN complete — re-run without DRY_RUN=1 to execute.\n`);
    return;
  }

  console.log(`\n⏳ Executing wipe...\n`);

  // 4. Execute in a transaction
  const result = await db.$transaction(async (tx) => {
    // 4a. Archive agent
    await tx.agent.update({
      where: { id: deployment.agent.id },
      data: {
        status: "ARCHIVED",
        archivedAt: new Date(),
        archivedBy: "wipe-script",
        archiveReason: "Manual wipe to redeploy fresh agent for new flow demonstration",
      },
    });

    // 4b. Cancel pending agent jobs
    const cancelled = await tx.agentJob.updateMany({
      where: { agentId: deployment.agent.id, status: { in: ["PENDING", "CLAIMED"] } },
      data: { status: "FAILED", error: "Cancelled: agent archived via wipe script" },
    });

    // 4c. Deactivate deployment
    await tx.agentDeployment.update({
      where: { id: deployment.id },
      data: { isActive: false },
    });

    // 4d. Delete artefacts
    const artefactsDeleted = await tx.agentArtefact.deleteMany({
      where: { projectId: project.id },
    });

    // 4e. Delete KB items scoped to this agent — preserves any user-added
    //     KB items not tied to the agent
    const kbDeleted = await tx.knowledgeBaseItem.deleteMany({
      where: { agentId: deployment.agent.id, projectId: project.id },
    });

    // 4f. Reject pending approvals (preserves the row so audit trail shows
    //     they were superseded, but they no longer block anything)
    const approvalsRejected = await tx.approval.updateMany({
      where: { projectId: project.id, status: "PENDING" },
      data: {
        status: "REJECTED",
        comment: "Superseded — agent was archived and project reset for fresh deployment.",
        resolvedAt: new Date(),
      },
    });

    // 4g. Reset Phase audit timestamps + status
    const phasesReset = await tx.phase.updateMany({
      where: { projectId: project.id },
      data: {
        status: "PENDING",
        researchCompletedAt: null,
        clarificationCompletedAt: null,
        clarificationSkippedReason: null,
        gateApprovedAt: null,
      },
    });

    // 4h. Audit log
    await tx.auditLog.create({
      data: {
        orgId: project.orgId,
        action: "AGENT_WIPED_FOR_REDEPLOY",
        target: deployment.agent.name,
        entityType: "agent",
        entityId: deployment.agent.id,
        rationale: `Archived agent and wiped agent-scoped work on project "${project.name}" so a fresh agent can be deployed and exercise the new research→approve→clarify→generate flow.`,
        details: {
          agentId: deployment.agent.id,
          projectId: project.id,
          artefactsDeleted: artefactsDeleted.count,
          kbDeleted: kbDeleted.count,
          approvalsRejected: approvalsRejected.count,
          phasesReset: phasesReset.count,
          jobsCancelled: cancelled.count,
        } as any,
      },
    });

    return {
      artefactsDeleted: artefactsDeleted.count,
      kbDeleted: kbDeleted.count,
      approvalsRejected: approvalsRejected.count,
      phasesReset: phasesReset.count,
      jobsCancelled: cancelled.count,
    };
  });

  console.log(`✅ Wipe complete:`);
  console.log(`   • Agent archived`);
  console.log(`   • Deployment deactivated`);
  console.log(`   • ${result.jobsCancelled} agent jobs cancelled`);
  console.log(`   • ${result.artefactsDeleted} artefacts deleted`);
  console.log(`   • ${result.kbDeleted} KB items deleted`);
  console.log(`   • ${result.approvalsRejected} pending approvals rejected`);
  console.log(`   • ${result.phasesReset} phases reset to PENDING`);
  console.log(`\n🚀 Project "${project.name}" is ready for a fresh agent deployment.`);
  console.log(`   Visit /agents/deploy and choose this project.\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Wipe failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
