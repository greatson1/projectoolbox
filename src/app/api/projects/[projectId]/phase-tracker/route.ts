import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getMethodology } from "@/lib/methodology-definitions";
import { getAllPhasesCompletion } from "@/lib/agents/phase-completion";
import {
  evaluatePrerequisites,
  summarisePrerequisites,
  type PrerequisiteEvalContext,
} from "@/lib/agents/phase-prerequisites";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:projectId/phase-tracker
 *
 * Returns rich per-phase data for the PM Tracker page:
 *   - methodology phase definition (name, description, artefacts list)
 *   - actual phase row status (PENDING / ACTIVE / COMPLETED)
 *   - per-artefact status (MISSING / DRAFT / PENDING_REVIEW / APPROVED / REJECTED)
 *   - scaffolded PM tasks grouped under the phase
 *   - gate criteria + per-prereq evaluation (met / unmet / draft / rejected / manual)
 *   - canAdvance + blocker list
 *
 * Replaces the slim /tasks?include=all view used by the legacy tracker —
 * everything the per-phase UI needs in one round-trip.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { projectId } = await params;

  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, methodology: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const methodologyId = (project.methodology || "PRINCE2").toLowerCase().replace("agile_", "");
  const methodology = getMethodology(methodologyId);

  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    select: { id: true, agentId: true, currentPhase: true },
  });

  // ── Pull all the project state we need to evaluate prereqs ────────────
  const [phaseRows, allArtefacts, scaffoldedTasks, stakeholders, phaseGateApprovals, riskCount, completion] = await Promise.all([
    db.phase.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
    db.agentArtefact.findMany({
      where: { projectId },
      select: { id: true, name: true, status: true, phaseId: true, updatedAt: true },
    }),
    deployment
      ? db.task.findMany({
          where: {
            projectId,
            createdBy: `agent:${deployment.agentId}`,
            description: { contains: "[scaffolded]" },
          },
          select: { id: true, title: true, status: true, progress: true, parentId: true, phaseId: true, description: true },
        })
      : Promise.resolve([]),
    db.stakeholder.findMany({ where: { projectId }, select: { role: true } }),
    db.approval.findMany({
      where: { projectId, type: "PHASE_GATE", status: "APPROVED" },
      select: { title: true },
    }),
    db.risk.count({ where: { projectId } }),
    deployment ? getAllPhasesCompletion(projectId, deployment.agentId).catch(() => []) : Promise.resolve([]),
  ]);

  const completionByPhase = new Map(completion.map(c => [c.phaseName, c]));

  // ── Build per-phase payload ──────────────────────────────────────────
  const phases = methodology.phases.map((phaseDef, idx) => {
    const phaseRow = phaseRows.find(p => p.name === phaseDef.name);
    const status = phaseRow?.status || "PENDING";

    // Artefact status for THIS phase only — match by phaseId or by phaseName
    // (legacy rows store phaseName in phaseId).
    const phaseArtefacts = phaseDef.artefacts.map(art => {
      const match = allArtefacts.find(a => {
        const sameName = a.name.toLowerCase() === art.name.toLowerCase()
          || a.name.toLowerCase().includes(art.name.toLowerCase());
        if (!sameName) return false;
        if (!phaseRow) return true;
        return a.phaseId === phaseRow.id || a.phaseId === phaseDef.name;
      });
      return {
        name: art.name,
        required: art.required,
        aiGeneratable: art.aiGeneratable,
        artefactId: match?.id ?? null,
        status: match?.status ?? "MISSING",
      };
    });

    // PM scaffolded tasks for this phase, grouped by parent
    const phaseTasks = scaffoldedTasks.filter(t =>
      t.phaseId === phaseDef.name || t.phaseId === phaseRow?.id
    );
    const parents = phaseTasks.filter(t => !t.parentId && t.description?.includes("[scaffolded] Parent"));
    const grouped = parents.map(parent => {
      const kids = phaseTasks.filter(t => t.parentId === parent.id);
      const done = kids.filter(k => k.status === "DONE" || (k.progress || 0) >= 100).length;
      return {
        category: parent.title.replace(/^[^:]+:\s*/, ""),
        total: kids.length,
        done,
        children: kids.map(k => ({
          id: k.id,
          title: k.title,
          status: k.status,
          progress: k.progress || 0,
          done: k.status === "DONE" || (k.progress || 0) >= 100,
        })),
      };
    });

    // Build prereq evaluation context from project state, scoped per-phase
    // for the artefact lists (only count artefacts up to and including this phase).
    const prereqCtx: PrerequisiteEvalContext = {
      approvedArtefactNames: allArtefacts.filter(a => a.status === "APPROVED").map(a => a.name),
      rejectedArtefactNames: allArtefacts.filter(a => a.status === "REJECTED").map(a => a.name),
      draftArtefactNames: allArtefacts
        .filter(a => a.status === "DRAFT" || a.status === "PENDING_REVIEW")
        .map(a => a.name),
      stakeholderRoles: stakeholders.map(s => s.role || "").filter(Boolean),
      approvedPhaseGateNames: phaseGateApprovals.map(a => a.title || ""),
      hasRisks: riskCount > 0,
    };
    const evaluatedPrereqs = evaluatePrerequisites(phaseDef.gate.preRequisites, prereqCtx);
    const prereqSummary = summarisePrerequisites(evaluatedPrereqs);

    const comp = completionByPhase.get(phaseDef.name);

    return {
      order: idx,
      name: phaseDef.name,
      description: phaseDef.description,
      color: phaseDef.color,
      status,
      isCurrent: deployment?.currentPhase === phaseDef.name,
      artefacts: phaseArtefacts,
      taskGroups: grouped,
      gate: {
        name: phaseDef.gate.name,
        criteria: phaseDef.gate.criteria,
        prerequisites: evaluatedPrereqs,
        summary: prereqSummary,
      },
      completion: comp
        ? {
            artefactsPct: comp.artefacts.pct,
            pmTasksPct: comp.pmTasks.pct,
            deliveryPct: comp.deliveryTasks.pct,
            overall: comp.overall,
            canAdvance: comp.canAdvance,
            blockers: comp.blockers,
          }
        : null,
    };
  });

  return NextResponse.json({
    data: {
      methodology: { id: methodology.id, name: methodology.name, framework: methodology.framework },
      currentPhase: deployment?.currentPhase ?? null,
      phases,
    },
  });
}
