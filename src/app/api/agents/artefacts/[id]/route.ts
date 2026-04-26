import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { after as waitUntil } from "next/server";
import { ensureProjectMutable } from "@/lib/archive-guard";

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

// DELETE /api/agents/artefacts/[id]
// Used by the per-artefact regenerate flow to remove a rejected/draft row
// before triggering phase regeneration. APPROVED artefacts cannot be deleted
// here — that requires explicit governance action elsewhere.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string | undefined;
  const { id } = await params;

  const artefact = await db.agentArtefact.findUnique({
    where: { id },
    select: { id: true, status: true, name: true, projectId: true },
  });
  if (!artefact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Verify the artefact belongs to a project in the caller's org
  if (orgId) {
    const proj = await db.project.findFirst({
      where: { id: artefact.projectId, orgId },
      select: { id: true },
    });
    if (!proj) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (artefact.status === "APPROVED") {
    return NextResponse.json(
      { error: "Cannot delete an APPROVED artefact via this endpoint" },
      { status: 409 },
    );
  }

  await db.agentArtefact.delete({ where: { id } });
  return NextResponse.json({ data: { id, name: artefact.name, deleted: true } });
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

  // Read the current artefact so we can merge metadata and detect
  // content-edits to previously-APPROVED work.
  const existing = await db.agentArtefact.findUnique({
    where: { id },
    select: { metadata: true, status: true, content: true, name: true, projectId: true },
  });

  // Block edits on artefacts that belong to an archived project — but allow
  // GET to keep them readable for audit. Approvals are blocked too, since the
  // governance trail freezes at archive time.
  if (existing?.projectId) {
    const blocked = await ensureProjectMutable(existing.projectId);
    if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });
  }

  // ── Edit-after-approval guard ────────────────────────────────────────────
  // If the caller is changing the content of an APPROVED artefact without
  // re-supplying status: "APPROVED", force the artefact back to DRAFT. The
  // prior approval stamped by a human applied to the OLD content — it does
  // not carry over to edits. This mirrors the chat-based edit path, which
  // has always forced DRAFT on edit. APPROVED → APPROVED is only allowed
  // when the request is the approval itself (status === "APPROVED").
  const isContentEdit = typeof content === "string" && content !== existing?.content;
  const wasApproved = existing?.status === "APPROVED";
  const forceDraftOnEdit = isContentEdit && wasApproved && status !== "APPROVED";
  const effectiveStatus = forceDraftOnEdit ? "DRAFT" : status;

  // Build metadata update — stamp approvedBy/approvedAt when approving, and
  // clear the stale approval stamps when an approved artefact is edited so
  // the audit trail never claims a human approved this new content.
  let metadataUpdate: Record<string, unknown> | undefined;
  if (effectiveStatus === "APPROVED") {
    const currentMeta = (existing?.metadata as Record<string, unknown>) ?? {};
    metadataUpdate = {
      ...currentMeta,
      approvedBy: (session.user as any).id,
      approvedAt: new Date().toISOString(),
      approvedByName: session.user.name ?? session.user.email ?? "unknown",
    };
  } else if (forceDraftOnEdit) {
    const currentMeta = (existing?.metadata as Record<string, unknown>) ?? {};
    metadataUpdate = {
      ...currentMeta,
      priorApprovedBy: currentMeta.approvedBy,
      priorApprovedByName: currentMeta.approvedByName,
      priorApprovedAt: currentMeta.approvedAt,
      approvedBy: null,
      approvedByName: null,
      approvedAt: null,
      revertedToDraftAt: new Date().toISOString(),
      revertedToDraftReason: "content_edited_after_approval",
    };
  }

  const artefact = await db.agentArtefact.update({
    where: { id },
    data: {
      ...(effectiveStatus && { status: effectiveStatus }),
      ...(feedback !== undefined && { feedback }),
      ...(content && { content, version: { increment: 1 } }),
      ...(metadataUpdate && { metadata: metadataUpdate }),
    },
  });

  // Audit log + user-facing activity when an approved artefact is reverted.
  if (forceDraftOnEdit) {
    try {
      const dep = await db.agentDeployment.findFirst({
        where: { projectId: artefact.projectId, isActive: true },
        select: { agentId: true },
      });
      const auditAgentId = dep?.agentId || artefact.agentId;
      const editorName = session.user.name ?? session.user.email ?? "Unknown user";
      await db.agentActivity.create({
        data: {
          agentId: auditAgentId,
          type: "document",
          summary: `"${artefact.name}" edited after approval by ${editorName} — reverted to DRAFT and must be re-approved.`,
        },
      });
    } catch (e) {
      console.error("[artefact PATCH] revert audit failed:", e);
    }
  }

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
              const methodology = getMethodology((project?.methodology || "traditional").toLowerCase().replace("agile_", ""));
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
                // Auto-complete any scaffolded "Submit Phase X gate approval" task
                try {
                  const { onAgentEvent } = await import("@/lib/agents/task-scaffolding");
                  await onAgentEvent(dep.agentId, artefact.projectId, "gate_request");
                } catch (e) {
                  console.error("[artefact PATCH] gate_request event hook failed:", e);
                }
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
