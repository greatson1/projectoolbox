import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getMethodology } from "@/lib/methodology-definitions";
import { getAllPhasesCompletion } from "@/lib/agents/phase-completion";
import {
  evaluatePrerequisites,
  summarisePrerequisites,
  manualKey,
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

  const methodologyId = (project.methodology || "traditional").toLowerCase().replace("agile_", "");
  const methodology = getMethodology(methodologyId);

  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    select: { id: true, agentId: true, currentPhase: true },
  });

  // ── Pull all the project state we need to evaluate prereqs ────────────
  const [phaseRows, allArtefacts, scaffoldedTasks, stakeholders, phaseGateApprovals, riskCount, completion, manualConfirmations, confirmedFacts] = await Promise.all([
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
          select: { id: true, title: true, status: true, progress: true, parentId: true, phaseId: true, description: true, updatedAt: true },
        })
      : Promise.resolve([]),
    db.stakeholder.findMany({ where: { projectId }, select: { role: true } }),
    db.approval.findMany({
      where: { projectId, type: "PHASE_GATE", status: "APPROVED" },
      select: { title: true },
    }),
    db.risk.count({ where: { projectId } }),
    deployment ? getAllPhasesCompletion(projectId, deployment.agentId).catch(() => []) : Promise.resolve([]),
    db.knowledgeBaseItem.findMany({
      where: { projectId, orgId, tags: { has: "prereq_confirmation" } },
      select: { metadata: true },
    }),
    // HIGH_TRUST KB items the chat agent stored as user-confirmed facts —
    // used as additional evidence for stakeholder-presence prereqs (e.g.
    // "Sponsor identified and confirmed" can be ticked by a "Project Sponsor"
    // KB fact, not just by a Stakeholder Register row).
    db.knowledgeBaseItem.findMany({
      where: { projectId, orgId, trustLevel: "HIGH_TRUST", tags: { has: "user_confirmed" } },
      select: { title: true },
    }),
  ]);
  const confirmedFactTitles = confirmedFacts.map(f => f.title.toLowerCase());

  const manuallyConfirmed = new Set<string>();
  for (const row of manualConfirmations) {
    const meta = (row.metadata as Record<string, unknown>) || {};
    if (typeof meta.phase === "string" && typeof meta.prereq === "string") {
      manuallyConfirmed.add(manualKey(meta.phase, meta.prereq));
    }
  }

  const completionByPhase = new Map(completion.map(c => [c.phaseName, c]));

  // ── Authoritative next-step verdict for the CURRENT phase ─────────────
  // The weighted `overall` % ignores gates (research approval, clarification,
  // phase gate), so it can read 100% while the phase still can't advance.
  // Resolve the true next step ONCE (only for the current phase) and use it
  // to cap the readiness % + surface a "Next:" action in the UI. Guarded so a
  // resolver failure can never break the tracker payload.
  let currentNextAction:
    | { step: string; bannerLabel: string; reason: string; ceiling: number }
    | null = null;
  if (deployment?.currentPhase && deployment?.agentId) {
    try {
      const { getNextRequiredStep, stepProgressCeiling } = await import("@/lib/agents/phase-next-action");
      const na = await getNextRequiredStep({
        agentId: deployment.agentId,
        projectId,
        phaseName: deployment.currentPhase,
      });
      currentNextAction = { step: na.step, bannerLabel: na.bannerLabel, reason: na.reason, ceiling: stepProgressCeiling(na.step) };
    } catch (e) {
      console.error("[phase-tracker] next-step resolver failed:", e);
    }
  }

  // ── Build per-phase payload ──────────────────────────────────────────
  const phases = methodology.phases.map((phaseDef, idx) => {
    const phaseRow = phaseRows.find(p => p.name === phaseDef.name);
    const rawStatus = phaseRow?.status || "PENDING";
    // Read-time reconciliation. The DB Phase.status column was written by
    // legacy fast-paths (e.g. artefacts/generate/route.ts:170) before
    // getPhaseCompletion gained its mandatory-prereq + research-audit
    // checks. Result: stale rows show status=COMPLETED → "Done" badge,
    // while the same phase's live blockers list still has 3 items. UI
    // renders both → user sees "Done" next to a BLOCKERS section in the
    // same card. We override to STALE here when the writers' historical
    // view of "done" no longer matches today's checker; the badge mapper
    // in PhasePlanTracker renders STALE as a distinct amber state with
    // copy explaining the phase needs the new prereqs cleared.
    const blockersForPhase = completionByPhase.get(phaseDef.name)?.blockers || [];
    const status = (rawStatus === "COMPLETED" && blockersForPhase.length > 0)
      ? "STALE"
      : rawStatus;

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
        children: kids.map(k => {
          const desc = k.description || "";
          const artMatch = desc.match(/\[artefact:([^\]]+)\]/);
          const evtMatch = desc.match(/\[event:([^\]]+)\]/);
          const isDone = k.status === "DONE" || (k.progress || 0) >= 100;
          return {
            id: k.id,
            title: k.title,
            status: k.status,
            progress: k.progress || 0,
            done: isDone,
            linkedArtefact: artMatch ? artMatch[1] : undefined,
            linkedEvent: evtMatch ? evtMatch[1] : undefined,
            // Surface to the UI so the row can render "Last completed: 28 Apr"
            // for recurring monitoring tasks. We only ship a value when the
            // task is actually done — otherwise updatedAt would point at the
            // last time progress was nudged, which isn't useful.
            completedAt: isDone ? k.updatedAt.toISOString() : null,
          };
        }),
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
      confirmedFactTitles,
      approvedPhaseGateNames: phaseGateApprovals.map(a => a.title || ""),
      hasRisks: riskCount > 0,
      manuallyConfirmed,
      phaseName: phaseDef.name,
    };
    const evaluatedPrereqs = evaluatePrerequisites(phaseDef.gate.preRequisites, prereqCtx);
    const prereqSummary = summarisePrerequisites(evaluatedPrereqs);

    const comp = completionByPhase.get(phaseDef.name);
    const isCurrent = deployment?.currentPhase === phaseDef.name;

    // Position-based readiness + next step. For the current phase, cap the
    // readiness to the pipeline step's ceiling so the headline % can never
    // claim more progress than the stepper position allows (e.g. it can't show
    // 100% while parked at "approve research"). Non-current phases just mirror
    // `overall` and carry no next step.
    let overallReadiness: number | null = comp ? comp.overall : null;
    let nextStep: string | null = null;
    let nextLabel: string | null = null;
    let nextReason: string | null = null;
    if (comp && isCurrent && currentNextAction) {
      overallReadiness = Math.min(comp.overall, currentNextAction.ceiling);
      nextStep = currentNextAction.step;
      nextLabel = currentNextAction.bannerLabel;
      nextReason = currentNextAction.reason;
    }

    return {
      order: idx,
      name: phaseDef.name,
      description: phaseDef.description,
      color: phaseDef.color,
      status,
      isCurrent,
      artefacts: phaseArtefacts,
      taskGroups: grouped,
      gate: {
        name: phaseDef.gate.name,
        criteria: phaseDef.gate.criteria,
        prerequisites: evaluatedPrereqs,
        summary: prereqSummary,
      },
      // Expose the raw done/total triples from getPhaseCompletion alongside
      // the percentages — the UI was previously recomputing "X of Y approved"
      // from the inline `phaseArtefacts` list (which is keyed by methodology
      // and silently drops over-delivered artefacts), so the tracker could
      // show a different "approved" count than the gate creator / metrics
      // endpoint. Same snapshot, same numbers everywhere now.
      completion: comp
        ? {
            artefactsPct: comp.artefacts.pct,
            artefactsDone: comp.artefacts.done,
            artefactsTotal: comp.artefacts.total,
            pmTasksPct: comp.pmTasks.pct,
            pmTasksDone: comp.pmTasks.done,
            pmTasksTotal: comp.pmTasks.total,
            deliveryPct: comp.deliveryTasks.pct,
            deliveryDone: comp.deliveryTasks.done,
            deliveryTotal: comp.deliveryTasks.total,
            overall: comp.overall,
            canAdvance: comp.canAdvance,
            blockers: comp.blockers,
            // Capped readiness + authoritative next step (current phase only).
            overallReadiness,
            nextStep,
            nextLabel,
            nextReason,
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
