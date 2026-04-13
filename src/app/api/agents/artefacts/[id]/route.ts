import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

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

  const artefact = await db.agentArtefact.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(feedback !== undefined && { feedback }),
      ...(content && { content, version: { increment: 1 } }),
    },
  });

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
  // When any artefact is APPROVED, parse its CSV/content and seed the relevant
  // DB table so every project module (Schedule, Risks, Stakeholders, Cost…)
  // shows live data.
  if (status === "APPROVED") {
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
          .catch(e => console.error("[artefact PATCH] schedule seeding failed:", e));
      }

      // Stakeholder Register / Risk Register / Budget / Sprint Plans → their own tables
      const { seedArtefactData } = await import("@/lib/agents/artefact-seeders");
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
        .catch(e => console.error("[artefact PATCH] artefact seeding failed:", e));

    } catch (e) {
      console.error("[artefact PATCH] seeding dispatch failed:", e);
    }

    // ── Phase advancement ────────────────────────────────────────────────────
    // When the last artefact in the current phase is approved, advance the
    // deployment's currentPhase and Phase records so the generate route's
    // phase-mismatch guard passes for the next phase.
    if (artefact.phaseId) {
      try {
        // Re-fetch all artefacts for this phase (including the one we just approved)
        const phaseArtefacts = await db.agentArtefact.findMany({
          where: { projectId: artefact.projectId, phaseId: artefact.phaseId },
          select: { id: true, status: true },
        });
        // Treat the current artefact as APPROVED even if DB hasn't updated yet
        const allApproved = phaseArtefacts.length > 0 && phaseArtefacts.every(
          a => a.status === "APPROVED" || a.id === id,
        );

        if (allApproved) {
          const dep = await db.agentDeployment.findFirst({
            where: { projectId: artefact.projectId, isActive: true },
            select: { id: true, currentPhase: true },
          });

          // Only advance if the deployment is still on this phase
          if (dep && dep.currentPhase === artefact.phaseId) {
            const project = await db.project.findUnique({
              where: { id: artefact.projectId },
              select: { methodology: true },
            });
            const { getMethodology } = await import("@/lib/methodology-definitions");
            const methodologyId = (project?.methodology || "PRINCE2").toLowerCase().replace("agile_", "");
            const methodology = getMethodology(methodologyId);
            const phases = methodology.phases;
            const currentIdx = phases.findIndex(p => p.name === artefact.phaseId);

            if (currentIdx >= 0 && currentIdx < phases.length - 1) {
              const nextPhaseName = phases[currentIdx + 1].name;
              // Mark current phase COMPLETED, next ACTIVE, advance deployment
              await db.phase.updateMany({
                where: { projectId: artefact.projectId, name: artefact.phaseId },
                data: { status: "COMPLETED" },
              });
              await db.phase.updateMany({
                where: { projectId: artefact.projectId, name: nextPhaseName },
                data: { status: "ACTIVE" },
              });
              await db.agentDeployment.update({
                where: { id: dep.id },
                data: { currentPhase: nextPhaseName, phaseStatus: "active", lastCycleAt: new Date() },
              });
            }
          }
        }
      } catch (e) {
        console.error("[artefact PATCH] phase advancement failed:", e);
      }
    }
  }

  return NextResponse.json({ data: artefact });
}
