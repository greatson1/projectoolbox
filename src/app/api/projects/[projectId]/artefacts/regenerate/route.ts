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
  let inlinePriorFeedback: Record<string, string> | undefined;
  try {
    const body = await req.json();
    requestedPhase = body?.phase;
    // Optional caller-provided feedback map — used by the per-artefact
    // "Regenerate" button which deletes the row before this endpoint runs,
    // so the feedback would otherwise be unrecoverable. Phase-level
    // regeneration relies on the DB read below and doesn't need this.
    if (body?.priorFeedback && typeof body.priorFeedback === "object" && !Array.isArray(body.priorFeedback)) {
      inlinePriorFeedback = body.priorFeedback as Record<string, string>;
    }
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

  // Resolve the Phase row — targetPhase is the phase NAME, not its id.
  const phaseRow = await db.phase.findFirst({
    where: { projectId, name: targetPhase },
    select: { id: true },
  });

  // ── Capture rejection feedback BEFORE deletion ──────────────────────────
  // REJECTED artefacts carry explicit reviewer feedback. We harvest the
  // feedback and the artefact name into a map keyed by name (case-
  // insensitive) so generatePhaseArtefacts can inject "the previous version
  // was rejected with this feedback: …" into the Sonnet prompt — the next
  // version then directly addresses what was wrong instead of silently
  // regenerating the same content.
  const rejectedWhere: any = {
    projectId,
    agentId: deployment.agentId,
    status: "REJECTED",
  };
  if (phaseRow?.id) rejectedWhere.phaseId = phaseRow.id;
  const rejectedRows = await db.agentArtefact.findMany({
    where: rejectedWhere,
    select: { name: true, feedback: true, version: true },
  });
  const priorFeedback: Record<string, string> = {};
  for (const r of rejectedRows) {
    if (r.feedback && r.feedback.trim().length > 0) {
      priorFeedback[r.name] = r.feedback;
    }
  }
  // Merge caller-provided inline feedback (used when the per-artefact
  // Regenerate button deletes the row before this endpoint runs). Inline
  // entries win over DB-read entries — the caller had the row in hand and
  // is the more authoritative source.
  if (inlinePriorFeedback) {
    for (const [name, fb] of Object.entries(inlinePriorFeedback)) {
      if (typeof fb === "string" && fb.trim().length > 0) {
        priorFeedback[name] = fb;
      }
    }
  }
  // Audit trail: keep a permanent record of every rejection feedback we are
  // about to retire so the "what was wrong" history survives the row delete.
  if (rejectedRows.length > 0) {
    await db.agentActivity.create({
      data: {
        agentId: deployment.agentId,
        type: "document",
        summary: `Regenerating ${rejectedRows.length} rejected artefact(s) with prior feedback — ${rejectedRows.map(r => `"${r.name}" (v${r.version}): ${(r.feedback || "no feedback").slice(0, 200)}`).join(" | ")}`,
      },
    }).catch(() => {});
  }

  // Delete DRAFT and REJECTED artefacts for this phase (preserve approved work).
  // REJECTED artefacts have explicit user feedback that they need to be replaced —
  // leaving them in place would cause the dedup check in generatePhaseArtefacts to
  // skip generating their replacements.
  // If a phase row exists, scope strictly by phaseId; otherwise fall back to
  // every DRAFT/REJECTED for the agent (safer than silently matching nothing).
  const deleteWhere: any = {
    projectId,
    agentId: deployment.agentId,
    status: { in: ["DRAFT", "REJECTED"] },
  };
  if (phaseRow?.id) deleteWhere.phaseId = phaseRow.id;
  const deleted = await db.agentArtefact.deleteMany({ where: deleteWhere });

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
    const result = await generatePhaseArtefacts(
      deployment.agentId,
      projectId,
      targetPhase,
      Object.keys(priorFeedback).length > 0 ? priorFeedback : undefined,
      true, // force — user explicitly clicked regenerate, bypass clarification gate
    );

    await db.agentActivity.create({
      data: {
        agentId: deployment.agentId,
        type: "document",
        summary: `Regenerated ${result.generated} artefact(s) for ${targetPhase} with updated prompt — ${deleted.count} old draft/rejected replaced, ${kbDeleted.count} stale extracted facts cleared, ${stakeholdersCleaned} fabricated stakeholders removed, ${assigneesCleaned} fabricated task assignees cleared.`,
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
