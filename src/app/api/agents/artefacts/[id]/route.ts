import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { after as waitUntil } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const artefact = await db.agentArtefact.findUnique({ where: { id } });
  if (!artefact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ data: artefact });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const { status, feedback, content } = body;

  // ── Human-only approval guard ────────────────────────────────────────────
  // Artefact approval is a governance action that MUST come from a verified
  // human user. Autonomous agents — regardless of their autonomy level — are
  // not permitted to approve artefacts they generated. This prevents the agent
  // from rubber-stamping its own work and bypassing the human review gate.
  if (status === "APPROVED") {
    const humanId = (session.user as any).id as string | undefined;
    if (!humanId) {
      return NextResponse.json(
        { error: "Artefact approval requires a verified human session. Automated agents cannot approve artefacts." },
        { status: 403 },
      );
    }
  }

  // Read the current artefact so we can merge metadata
  const existing = await db.agentArtefact.findUnique({ where: { id }, select: { metadata: true } });

  // Build metadata update — stamp approvedBy/approvedAt when approving
  let metadataUpdate: Record<string, unknown> | undefined;
  if (status === "APPROVED") {
    const currentMeta = (existing?.metadata as Record<string, unknown>) ?? {};
    metadataUpdate = {
      ...currentMeta,
      approvedBy: (session.user as any).id,
      approvedAt: new Date().toISOString(),
      approvedByName: session.user.name ?? session.user.email ?? "unknown",
    };
  }

  const artefact = await db.agentArtefact.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(feedback !== undefined && { feedback }),
      ...(content && { content, version: { increment: 1 } }),
      ...(metadataUpdate && { metadata: metadataUpdate }),
    },
  });

  // ── Approval audit log ──────────────────────────────────────────────────
  // Record who approved the artefact so there is a permanent, human-attributed
  // audit trail separate from the agent activity feed.
  if (status === "APPROVED") {
    try {
      const deployment = await db.agentDeployment.findFirst({
        where: { projectId: artefact.projectId, isActive: true },
        select: { agentId: true },
      });
      const auditAgentId = deployment?.agentId || artefact.agentId;
      const approverName = session.user.name ?? session.user.email ?? "Unknown user";
      await db.agentActivity.create({
        data: {
          agentId: auditAgentId,
          type: "approval",
          summary: `Artefact approved by ${approverName} (human): "${artefact.name}"`,
        },
      });
    } catch (e) {
      console.error("[artefact PATCH] approval audit log failed:", e);
    }
  }

  // ── Knowledge extraction ──────────────────────────────────────────────────
  // When an artefact is saved (content changed) or approved, extract facts
  // into the knowledge base so future generations use real names and decisions.
  const shouldLearn = (content && content.trim().length > 50) || status === "APPROVED";
  if (shouldLearn) {
    try {
      // Fetch agent/org context for the KB write
      const deployment = await db.agentDeployment.findFirst({
        where: { projectId: artefact.projectId, isActive: true },
        select: { agentId: true },
      });
      const agentId = deployment?.agentId || artefact.agentId;
      if (agentId && artefact.projectId) {
        const agent = await db.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
        if (agent) {
          // Fire-and-forget — don't await so approval is instant for the user
          const { extractAndStoreArtefactKnowledge } = await import("@/lib/agents/artefact-learning");
          extractAndStoreArtefactKnowledge(
            { id: artefact.id, name: artefact.name, format: artefact.format, content: content || artefact.content, status: status || artefact.status },
            agentId,
            artefact.projectId,
            agent.orgId,
          ).catch(e => console.error("[artefact PATCH] knowledge extraction failed:", e));
        }
      }
    } catch (e) {
      console.error("[artefact PATCH] knowledge extraction setup failed:", e);
    }
  }

  // ── Artefact → DB seeding ─────────────────────────────────────────────────
  // Seed the relevant DB tables when:
  //   1. An artefact is approved for the first time (status → APPROVED)
  //   2. An already-approved artefact's content is edited (re-seed with new data)
  // This ensures edits to approved documents propagate to Schedule, Risks, etc.
  const isNewApproval = status === "APPROVED";
  const isApprovedContentEdit = !status && content && artefact.status === "APPROVED";
  if (isNewApproval || isApprovedContentEdit) {
    try {
      const seedDeployment = await db.agentDeployment.findFirst({
        where: { projectId: artefact.projectId, isActive: true },
        select: { agentId: true },
      });
      const seedAgentId = seedDeployment?.agentId || artefact.agentId;
      const artefactForSeed = {
        id: artefact.id,
        name: artefact.name,
        format: artefact.format,
        content: content || artefact.content,
        projectId: artefact.projectId,
      };

      const lname = artefact.name.toLowerCase();

      // Schedule Baseline / WBS → Task records (Gantt, Agile Board, Scope, Sprint Tracker)
      if (lname.includes("schedule") || lname.includes("wbs") || lname.includes("work breakdown")) {
        const { parseScheduleArtefactIntoTasks } = await import("@/lib/agents/schedule-parser");
        waitUntil(
          parseScheduleArtefactIntoTasks(artefactForSeed, seedAgentId)
            .then(async () => {
              // After WBS tasks are seeded, auto-plan sprints
              try {
                const { planSprints } = await import("@/lib/agents/sprint-planner");
                const result = await planSprints(seedAgentId, artefact.projectId);
                if (result.sprints > 0) {
                  console.log(`[artefact PATCH] Auto-planned ${result.sprints} sprint(s), ${result.tasksAssigned} tasks, ${result.pointsPlanned} points`);
                }
              } catch (e) {
                console.error("[artefact PATCH] Sprint auto-planning failed:", e);
              }
            })
            .catch(e => console.error("[artefact PATCH] schedule seeding failed:", e))
        );
      }

      // Stakeholder Register / Risk Register / Budget / Sprint Plans → their own tables
      const { seedArtefactData } = await import("@/lib/agents/artefact-seeders");
      waitUntil(
        seedArtefactData(artefactForSeed, seedAgentId)
          .then(async () => {
            // After Sprint Plans are seeded, also auto-plan if tasks exist but no sprints
            if (lname.includes("sprint") || lname.includes("iteration") || lname.includes("backlog")) {
              try {
                const { planSprints } = await import("@/lib/agents/sprint-planner");
                await planSprints(seedAgentId, artefact.projectId);
              } catch {}
            }
          })
          .catch(e => console.error("[artefact PATCH] artefact seeding failed:", e))
      );

    } catch (e) {
      console.error("[artefact PATCH] seeding dispatch failed:", e);
    }

    // ── Phase gate check ────────────────────────────────────────────────────
    // When all artefacts in the current phase are approved, create a PHASE_GATE
    // approval. NEVER auto-advance — the user must explicitly approve the gate.
    if (artefact.phaseId) {
      try {
        const phaseArtefacts = await db.agentArtefact.findMany({
          where: { projectId: artefact.projectId, phaseId: artefact.phaseId },
          select: { id: true, status: true },
        });
        const allApproved = phaseArtefacts.length > 0 && phaseArtefacts.every(
          a => a.status === "APPROVED" || a.id === id,
        );

        if (allApproved) {
          const dep = await db.agentDeployment.findFirst({
            where: { projectId: artefact.projectId, isActive: true },
            select: { id: true, currentPhase: true, agentId: true },
          });

          if (dep && dep.currentPhase === artefact.phaseId) {
            // Check if a gate approval already exists for this phase
            const existingGate = await db.approval.findFirst({
              where: { projectId: artefact.projectId, type: "PHASE_GATE", status: "PENDING" },
            });

            if (!existingGate) {
              const project = await db.project.findUnique({ where: { id: artefact.projectId }, select: { methodology: true } });
              const { getMethodology } = await import("@/lib/methodology-definitions");
              const methodology = getMethodology((project?.methodology || "PRINCE2").toLowerCase().replace("agile_", ""));
              const phases = methodology.phases;
              const currentIdx = phases.findIndex(p => p.name === artefact.phaseId);
              const nextPhase = currentIdx >= 0 && currentIdx < phases.length - 1 ? phases[currentIdx + 1] : null;

              if (nextPhase) {
                await db.approval.create({
                  data: {
                    projectId: artefact.projectId,
                    requestedById: dep.agentId,
                    type: "PHASE_GATE",
                    title: `Phase Gate: ${artefact.phaseId} → ${nextPhase.name}`,
                    description: `All ${phaseArtefacts.length} artefact(s) in the ${artefact.phaseId} phase have been approved. Review and approve to advance to ${nextPhase.name}.`,
                    status: "PENDING",
                    urgency: "MEDIUM",
                    impactScores: { schedule: 2, cost: 1, scope: 1, stakeholder: 1 } as any,
                  },
                });
                await db.agentDeployment.update({
                  where: { id: dep.id },
                  data: { phaseStatus: "pending_approval" },
                });
                await db.agentActivity.create({
                  data: {
                    agentId: dep.agentId,
                    type: "gate_request",
                    summary: `All ${artefact.phaseId} artefacts approved. Phase gate created — awaiting your approval to advance to ${nextPhase.name}.`,
                  },
                });
              }
            }
          }
        }
      } catch (e) {
        console.error("[artefact PATCH] phase gate check failed:", e);
      }
    }
  }

  return NextResponse.json({ data: artefact });
}
