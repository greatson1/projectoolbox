/**
 * POST /api/agents/:id/rescaffold
 *
 * Re-runs task scaffolding for an existing agent deployment.
 * Useful for projects that were deployed before delivery task templates
 * were added — this backfills the missing tasks.
 *
 * Does NOT delete existing tasks — only adds missing ones.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureAgentMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;

  const agent = await db.agent.findFirst({
    where: { id: agentId, orgId },
    select: { id: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const blocked = await ensureAgentMutable(agentId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true, currentPhase: true },
  });
  if (!deployment?.projectId) {
    return NextResponse.json({ error: "No active deployment" }, { status: 404 });
  }

  const phases = await db.phase.findMany({
    where: { projectId: deployment.projectId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, order: true, status: true, artefacts: true },
  });

  if (phases.length === 0) {
    return NextResponse.json({ error: "No phases found for this project" }, { status: 404 });
  }

  const project = await db.project.findUnique({
    where: { id: deployment.projectId },
    select: { name: true, budget: true, startDate: true, endDate: true },
  });

  // Import scaffolding function
  const { scaffoldProjectTasks } = await import("@/lib/agents/task-scaffolding");

  // Check which phases already have scaffolded tasks
  const existingScaffolded = await db.task.findMany({
    where: {
      projectId: deployment.projectId,
      createdBy: `agent:${agentId}`,
      OR: [
        { description: { contains: "[scaffolded]" } },
        { description: { contains: "[scaffolded:delivery]" } },
      ],
    },
    select: { phaseId: true, title: true },
  });

  const existingByPhase = new Map<string, Set<string>>();
  for (const task of existingScaffolded) {
    const pid = task.phaseId || "__none";
    if (!existingByPhase.has(pid)) existingByPhase.set(pid, new Set());
    existingByPhase.get(pid)!.add(task.title);
  }

  let totalCreated = 0;

  // For each phase, scaffold if no tasks exist for it yet
  for (const phase of phases) {
    const existingTitles = existingByPhase.get(phase.name) || existingByPhase.get(phase.id) || new Set();

    // If this phase already has scaffolded tasks, skip it
    if (existingTitles.size > 0) continue;

    // Scaffold tasks for this phase
    try {
      const created = await scaffoldProjectTasks(
        agentId,
        deployment.projectId,
        [phase],
        project as any,
      );
      totalCreated += created;
    } catch (e) {
      console.error(`[rescaffold] Failed for phase ${phase.name}:`, e);
    }
  }

  await db.agentActivity.create({
    data: {
      agentId,
      type: "system",
      summary: `Re-scaffolded tasks: ${totalCreated} new tasks created across ${phases.length} phases`,
    },
  });

  return NextResponse.json({
    data: {
      created: totalCreated,
      phases: phases.map((p) => p.name),
      skipped: phases.filter((p) => (existingByPhase.get(p.name) || existingByPhase.get(p.id) || new Set()).size > 0).map((p) => p.name),
    },
  });
}
