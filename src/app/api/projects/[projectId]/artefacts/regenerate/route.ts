import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { looksLikeFabricatedName } from "@/lib/agents/fabricated-names";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min for Claude regeneration

/**
 * POST /api/projects/[projectId]/artefacts/regenerate
 *
 * Deletes all DRAFT artefacts for the current phase and generates fresh
 * versions using the latest prompt rules. Approved artefacts are preserved.
 *
 * Body (optional): { phase?: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { projectId } = await params;

  // Verify project ownership
  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let requestedPhase: string | undefined;
  try {
    const body = await req.json();
    requestedPhase = body?.phase;
  } catch { /* no body */ }

  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    orderBy: { deployedAt: "desc" },
    select: { id: true, agentId: true, currentPhase: true },
  });
  if (!deployment) {
    return NextResponse.json({ error: "No active deployment" }, { status: 404 });
  }

  const targetPhase = requestedPhase || deployment.currentPhase;
  if (!targetPhase) {
    return NextResponse.json({ error: "No current phase — deployment may need initialisation" }, { status: 400 });
  }

  // Delete only DRAFT artefacts for this phase (preserve approved work)
  const deleted = await db.agentArtefact.deleteMany({
    where: {
      projectId,
      agentId: deployment.agentId,
      phaseId: targetPhase,
      status: "DRAFT",
    },
  });

  // Also clear associated KB items that were extracted from those drafts, so
  // the regeneration doesn't re-read stale fabricated facts.
  // (Keep user_confirmed and research KB items — delete only artefact-derived.)
  const kbDeleted = await db.knowledgeBaseItem.deleteMany({
    where: {
      agentId: deployment.agentId,
      projectId,
      tags: { hasSome: ["artefact_extracted"] },
      NOT: {
        OR: [
          { tags: { has: "user_confirmed" } },
          { tags: { has: "research" } },
        ],
      },
    },
  }).catch(() => ({ count: 0 }));

  // Purge fabricated legacy data: stakeholders with invented personal names and
  // any task.assigneeName values that look fabricated. This is a one-shot
  // cleanup for projects that were seeded before the fabricated-name filter.
  let stakeholdersCleaned = 0;
  let assigneesCleaned = 0;
  try {
    const existingStakeholders = await db.stakeholder.findMany({
      where: { projectId },
      select: { id: true, name: true },
    });
    const toDelete = existingStakeholders.filter(s => looksLikeFabricatedName(s.name));
    if (toDelete.length > 0) {
      const del = await db.stakeholder.deleteMany({
        where: { id: { in: toDelete.map(s => s.id) } },
      });
      stakeholdersCleaned = del.count;
    }

    const tasksWithAssignee = await db.task.findMany({
      where: { projectId, assigneeName: { not: null } },
      select: { id: true, assigneeName: true },
    });
    const taskIdsToClear = tasksWithAssignee
      .filter(t => looksLikeFabricatedName(t.assigneeName))
      .map(t => t.id);
    if (taskIdsToClear.length > 0) {
      const upd = await db.task.updateMany({
        where: { id: { in: taskIdsToClear } },
        data: { assigneeName: null, assigneeId: null },
      });
      assigneesCleaned = upd.count;
    }
  } catch (e) {
    console.warn("[artefacts/regenerate] Fabricated-name cleanup failed:", e);
  }

  // Trigger fresh generation with the updated prompt
  try {
    const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
    const result = await generatePhaseArtefacts(deployment.agentId, projectId, targetPhase);

    await db.agentActivity.create({
      data: {
        agentId: deployment.agentId,
        type: "document",
        summary: `Regenerated ${result.generated} artefact(s) for ${targetPhase} with updated prompt — ${deleted.count} old drafts replaced, ${kbDeleted.count} stale extracted facts cleared, ${stakeholdersCleaned} fabricated stakeholders removed, ${assigneesCleaned} fabricated task assignees cleared.`,
      },
    }).catch(() => {});

    return NextResponse.json({
      data: {
        ...result,
        draftsDeleted: deleted.count,
        extractedFactsCleared: kbDeleted.count,
        stakeholdersCleaned,
        assigneesCleaned,
      },
    });
  } catch (e: any) {
    console.error("[artefacts/regenerate] failed:", e);
    return NextResponse.json({ error: e.message || "Regeneration failed" }, { status: 500 });
  }
}
