import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getMethodology } from "@/lib/methodology-definitions";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Claude API calls take 30-90s per batch

/**
 * POST /api/projects/[projectId]/artefacts/generate
 *
 * Generates artefacts for a specific phase or the current phase.
 * NEVER auto-advances phases — phase advancement is a separate explicit action.
 *
 * Body (optional): { phase?: string }
 * - If `phase` is provided, generate artefacts for that specific phase
 * - Otherwise generate for the deployment's currentPhase
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  // Optional explicit phase from body
  let requestedPhase: string | undefined;
  try {
    const body = await req.json();
    requestedPhase = body?.phase;
  } catch { /* no body — fine */ }

  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    orderBy: { deployedAt: "desc" },
    select: { id: true, agentId: true, currentPhase: true },
  });

  if (!deployment) {
    return NextResponse.json({ error: "No active deployment found for this project" }, { status: 404 });
  }

  try {
    // If currentPhase is null → run full lifecycle init first
    if (!deployment.currentPhase && !requestedPhase) {
      const { runLifecycleInit } = await import("@/lib/agents/lifecycle-init");
      await runLifecycleInit(deployment.agentId, deployment.id);
      const updated = await db.agentDeployment.findUnique({
        where: { id: deployment.id },
        select: { currentPhase: true },
      });
      const arts = await db.agentArtefact.findMany({
        where: { projectId, agentId: deployment.agentId },
        select: { name: true },
      });
      return NextResponse.json({ data: { generated: arts.length, skipped: 0, phase: updated?.currentPhase ?? "Pre-Project" } });
    }

    // Determine target phase. If the caller explicitly requests a different phase
    // than the deployment is currently on (e.g. "Generate Design Phase" button
    // clicked from the artefacts page when all Requirements artefacts are
    // approved), auto-advance the deployment IF the current phase actually
    // satisfies completion criteria. Otherwise reject with 409 so the user sees
    // the real blocker (incomplete artefacts / pending approvals / open tasks).
    let targetPhase = deployment.currentPhase;
    let phaseAdvanced: { from: string; to: string } | null = null;

    if (requestedPhase && requestedPhase !== deployment.currentPhase) {
      const project = await db.project.findUnique({ where: { id: projectId } });
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      const { getPhaseCompletion } = await import("@/lib/agents/phase-completion");
      const { getNextPhase } = await import("@/lib/agents/methodology-playbooks");
      const methodologyId = (project.methodology || "PRINCE2").toLowerCase().replace("agile_", "");
      const playbookNext = deployment.currentPhase ? getNextPhase(methodologyId, deployment.currentPhase) : null;

      // The methodology playbook can return null when the project's stored
      // phase names don't match the playbook (e.g. project is set up with a
      // Waterfall layout but project.methodology is "PRINCE2"). The project's
      // Phase table is the real source of truth for THIS project's flow —
      // fall back to it so the user isn't blocked by an unrelated mismatch.
      let phaseTableNext: string | null = null;
      if (deployment.currentPhase) {
        const phaseRows = await db.phase.findMany({
          where: { projectId },
          select: { name: true, order: true },
          orderBy: { order: "asc" },
        });
        const currentRow = phaseRows.find(p => p.name === deployment.currentPhase);
        if (currentRow) {
          const nextRow = phaseRows.find(p => p.order === currentRow.order + 1);
          phaseTableNext = nextRow?.name ?? null;
        }
      }

      // Either source confirming the requested phase is the immediate next one is enough.
      const expectedNext = playbookNext === requestedPhase
        ? playbookNext
        : phaseTableNext === requestedPhase
          ? phaseTableNext
          : (playbookNext || phaseTableNext);

      // Only honour requests for the IMMEDIATE next phase. Skipping further
      // ahead is still a 409 — surface the real workflow.
      if (expectedNext && requestedPhase === expectedNext && deployment.currentPhase) {
        const completion = await getPhaseCompletion(projectId, deployment.currentPhase, deployment.agentId);
        if (!completion.canAdvance) {
          return NextResponse.json({
            error: `Cannot advance to "${requestedPhase}" yet: ${completion.blockers.join("; ")}`,
            completion,
          }, { status: 409 });
        }

        // All checks pass — advance the deployment to the next phase before generating.
        await db.agentDeployment.update({
          where: { id: deployment.id },
          data: {
            currentPhase: requestedPhase,
            phaseStatus: "active",
            lastCycleAt: new Date(),
            nextCycleAt: new Date(Date.now() + 2 * 60_000),
          },
        });
        await db.phase.updateMany({
          where: { projectId, name: deployment.currentPhase },
          data: { status: "COMPLETED" },
        });
        await db.phase.updateMany({
          where: { projectId, name: requestedPhase },
          data: { status: "ACTIVE" },
        });
        await db.agentActivity.create({
          data: {
            agentId: deployment.agentId,
            type: "approval",
            summary: `Phase advanced: "${deployment.currentPhase}" → "${requestedPhase}" (all artefacts approved). Generating next-phase artefacts...`,
          },
        }).catch(() => {});
        phaseAdvanced = { from: deployment.currentPhase, to: requestedPhase };
        targetPhase = requestedPhase;
      } else {
        const nextDescription = playbookNext && playbookNext !== phaseTableNext
          ? `Methodology playbook says next is "${playbookNext}"; project Phase table says next is "${phaseTableNext ?? "(none)"}".`
          : `Next phase: "${expectedNext ?? "(none)"}".`;
        return NextResponse.json({
          error: `Phase mismatch: deployment is at "${deployment.currentPhase}" but "${requestedPhase}" was requested. ${nextDescription} Approve all current-phase artefacts then click Generate again.`,
        }, { status: 409 });
      }
    }

    const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
    const result = await generatePhaseArtefacts(deployment.agentId, projectId, targetPhase ?? undefined);
    return NextResponse.json({ data: { ...result, phaseAdvanced } });
  } catch (e: any) {
    console.error("[artefacts/generate] Failed:", e?.message, e?.stack?.slice(0, 500));
    return NextResponse.json({ error: e.message || "Generation failed" }, { status: 500 });
  }
}
