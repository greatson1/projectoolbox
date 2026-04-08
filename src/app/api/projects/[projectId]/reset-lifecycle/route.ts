import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/projects/[projectId]/reset-lifecycle
 * Resets the project lifecycle: clears artefacts, phases, and approvals,
 * optionally updates the methodology, then re-runs lifecycle init.
 *
 * Use this to:
 *   - Fix a project that was initialised with the wrong methodology
 *   - Re-generate all artefacts from scratch with improved prompts
 *
 * Body: { methodology?: string }  e.g. { "methodology": "prince2" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));
  // Normalise methodology to Prisma enum format (e.g. "prince2" → "PRINCE2", "waterfall" → "WATERFALL")
  const rawMethodology = (body as any).methodology as string | undefined;
  const methodology = rawMethodology ? rawMethodology.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/^AGILE$/, "AGILE_SCRUM") as any : undefined;

  // Verify project exists
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Find active deployment
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    orderBy: { deployedAt: "desc" },
  });
  if (!deployment) {
    return NextResponse.json({ error: "No active deployment found" }, { status: 404 });
  }

  const previousMethodology = project.methodology;

  try {
    // ── Step 1: Clear existing lifecycle data ──
    const [deletedArtefacts, deletedPhases, deletedApprovals] = await Promise.all([
      db.agentArtefact.deleteMany({ where: { projectId } }),
      db.phase.deleteMany({ where: { projectId } }),
      db.approval.deleteMany({ where: { projectId } }),
    ]);

    // ── Step 2: Update methodology if provided ──
    if (methodology) {
      await db.project.update({
        where: { id: projectId },
        data: { methodology },
      });
    }

    // ── Step 3: Log the reset ──
    await db.agentActivity.create({
      data: {
        agentId: deployment.agentId,
        type: "deployment",
        summary: `Lifecycle reset — methodology changed from ${previousMethodology} to ${methodology || previousMethodology}. ${deletedArtefacts.count} artefacts, ${deletedPhases.count} phases, ${deletedApprovals.count} approvals cleared.`,
      },
    });

    // ── Step 4: Re-create phases and set deployment state ──
    const { getMethodology } = await import("@/lib/methodology-definitions");
    const effectiveMethodology = methodology || project.methodology || "PRINCE2";
    const methodologyId = effectiveMethodology.toLowerCase().replace("agile_", "");
    const methodologyDef = getMethodology(methodologyId);
    const firstPhase = methodologyDef.phases[0];

    for (let i = 0; i < methodologyDef.phases.length; i++) {
      const phase = methodologyDef.phases[i];
      await db.phase.create({
        data: {
          projectId,
          name: phase.name,
          order: i,
          status: i === 0 ? "ACTIVE" : "PENDING",
          criteria: phase.gate.criteria,
          artefacts: phase.artefacts.map((a: any) => a.name),
          approvalReq: phase.gate.preRequisites.some((p: any) => p.requiresHumanApproval),
        },
      });
    }

    await db.agentDeployment.update({
      where: { id: deployment.id },
      data: {
        currentPhase: firstPhase.name,
        phaseStatus: "active",
        lastCycleAt: new Date(),
        nextCycleAt: new Date(Date.now() + 10 * 60_000),
      },
    });

    // ── Step 5: Generate artefacts (idempotent — skips any already created) ──
    const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
    const result = await generatePhaseArtefacts(deployment.agentId, projectId, firstPhase.name);

    return NextResponse.json({
      data: {
        cleared: {
          artefacts: deletedArtefacts.count,
          phases: deletedPhases.count,
          approvals: deletedApprovals.count,
        },
        methodology: {
          before: previousMethodology,
          after: methodology || previousMethodology,
        },
        artefacts: {
          generated: result.generated,
          skipped: result.skipped,
          phase: result.phase,
        },
      },
    });
  } catch (e: any) {
    console.error("[reset-lifecycle] Failed:", e);
    return NextResponse.json({ error: e.message || "Reset failed" }, { status: 500 });
  }
}
