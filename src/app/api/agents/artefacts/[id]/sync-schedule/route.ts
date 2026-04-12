import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/artefacts/:id/sync-schedule
 *
 * Manually re-seeds the DB from an approved artefact. Works for:
 *   - Schedule Baseline / WBS → Task table (Gantt, Agile Board, Scope)
 *   - Stakeholder Register → Stakeholder table
 *   - Risk Register → Risk table
 *   - Budget Breakdown / Cost Management Plan → CostEntry table
 *   - Sprint Plans → Task table (with sprint metadata)
 *
 * Useful for artefacts approved before automatic seeding was added,
 * or after manually editing spreadsheet content.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const artefact = await db.agentArtefact.findUnique({ where: { id } });
  if (!artefact) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!artefact.content) return NextResponse.json({ error: "Artefact has no content" }, { status: 400 });

  const deployment = await db.agentDeployment.findFirst({
    where: { projectId: artefact.projectId, isActive: true },
    select: { agentId: true },
  });
  const agentId = deployment?.agentId || artefact.agentId;

  const artefactForSeed = {
    id: artefact.id,
    name: artefact.name,
    format: artefact.format,
    content: artefact.content,
    projectId: artefact.projectId,
  };

  const lname = artefact.name.toLowerCase();
  let message = "";

  if (lname.includes("schedule") || lname.includes("wbs") || lname.includes("work breakdown")) {
    const { parseScheduleArtefactIntoTasks } = await import("@/lib/agents/schedule-parser");
    const result = await parseScheduleArtefactIntoTasks(artefactForSeed, agentId);
    message = `${result.created} tasks synced to Schedule / Gantt`;
  } else {
    const { seedArtefactData } = await import("@/lib/agents/artefact-seeders");
    await seedArtefactData(artefactForSeed, agentId);

    if (lname.includes("stakeholder")) message = "Stakeholders synced to Stakeholder Register";
    else if (lname.includes("risk")) message = "Risks synced to Risk Register";
    else if (lname.includes("budget") || lname.includes("cost")) message = "Cost entries synced to Cost module";
    else if (lname.includes("sprint") || lname.includes("iteration")) message = "Sprint tasks synced to Agile Board";
    else message = `Artefact "${artefact.name}" synced`;
  }

  return NextResponse.json({ data: { message } });
}
