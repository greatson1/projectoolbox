/**
 * One-shot script: clean up duplicate artefacts for the Lagos Nigeria project,
 * then regenerate the full Pre-Project set.
 *
 * Run: npx tsx --env-file=.env scripts/fix-lagos-artefacts.ts
 */

import { db } from "../src/lib/db";
import { generatePhaseArtefacts } from "../src/lib/agents/lifecycle-init";
import { getMethodology } from "../src/lib/methodology-definitions";

const PROJECT_ID = "cmnlcjhz30000v8j0jhqwqvaa";

async function main() {
  // ── 1. Find the active deployment ──
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId: PROJECT_ID, isActive: true },
    orderBy: { deployedAt: "desc" },
  });
  if (!deployment) throw new Error("No active deployment for this project");
  console.log(`Deployment: ${deployment.id} | Agent: ${deployment.agentId}`);

  // ── 2. Show current artefacts ──
  const before = await db.agentArtefact.findMany({
    where: { projectId: PROJECT_ID },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true, content: true },
  });
  console.log(`\nCurrent artefacts (${before.length}):`);
  for (const a of before) {
    const words = a.content.split(/\s+/).length;
    console.log(`  [${a.createdAt.toISOString().slice(0, 19)}] ${words}w | ${a.name} | ${a.id}`);
  }

  // ── 3. Delete ALL artefacts + phases for a clean slate ──
  const [da, dp] = await Promise.all([
    db.agentArtefact.deleteMany({ where: { projectId: PROJECT_ID } }),
    db.phase.deleteMany({ where: { projectId: PROJECT_ID } }),
  ]);
  console.log(`\nDeleted ${da.count} artefacts, ${dp.count} phases`);

  // ── 4. Ensure project is set to PRINCE2 ──
  const project = await db.project.findUnique({ where: { id: PROJECT_ID } });
  console.log(`Project methodology: ${project?.methodology}`);
  if (project?.methodology !== "PRINCE2") {
    await db.project.update({ where: { id: PROJECT_ID }, data: { methodology: "PRINCE2" as any } });
    console.log("Updated methodology → PRINCE2");
  }

  // ── 5. Re-create phases ──
  const methodologyDef = getMethodology("prince2");
  const firstPhase = methodologyDef.phases[0];

  for (let i = 0; i < methodologyDef.phases.length; i++) {
    const phase = methodologyDef.phases[i];
    await db.phase.create({
      data: {
        projectId: PROJECT_ID,
        name: phase.name,
        order: i,
        status: i === 0 ? "ACTIVE" : "PENDING",
        criteria: phase.gate.criteria,
        artefacts: phase.artefacts.map((a: any) => a.name),
        approvalReq: phase.gate.preRequisites.some((p: any) => p.requiresHumanApproval),
      },
    });
  }
  console.log(`Re-created ${methodologyDef.phases.length} phases`);

  // ── 6. Update deployment state ──
  await db.agentDeployment.update({
    where: { id: deployment.id },
    data: {
      currentPhase: firstPhase.name,
      phaseStatus: "active",
      lastCycleAt: new Date(),
      nextCycleAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  console.log(`Deployment set to phase: ${firstPhase.name}`);

  // ── 7. Log ──
  await db.agentActivity.create({
    data: {
      agentId: deployment.agentId,
      type: "deployment",
      summary: `Manual lifecycle reset via fix script — ${da.count} duplicate artefacts cleared, phases rebuilt for PRINCE2 Lagos Nigeria trip`,
    },
  });

  // ── 8. Generate artefacts (idempotent) ──
  console.log(`\nGenerating artefacts for "${firstPhase.name}"...`);
  const result = await generatePhaseArtefacts(deployment.agentId, PROJECT_ID, firstPhase.name);
  console.log(`\n✓ Generated: ${result.generated} | Skipped: ${result.skipped} | Phase: ${result.phase}`);

  // ── 9. Show final artefacts ──
  const after = await db.agentArtefact.findMany({
    where: { projectId: PROJECT_ID },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true, content: true },
  });
  console.log(`\nFinal artefacts (${after.length}):`);
  for (const a of after) {
    const words = a.content.split(/\s+/).length;
    console.log(`  ${words}w | ${a.name}`);
  }
}

main().catch(console.error).finally(() => process.exit(0));
