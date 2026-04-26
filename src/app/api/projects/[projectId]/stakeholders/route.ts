import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const stakeholders = await db.stakeholder.findMany({ where: { projectId } });
  return NextResponse.json({ data: stakeholders });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const stakeholder = await db.stakeholder.create({ data: { ...body, projectId } });

  // Track new stakeholder in KB
  import("@/lib/agents/kb-event-tracker").then(({ trackStakeholderChange }) => {
    trackStakeholderChange(projectId, body.name || "Stakeholder", `added as ${body.role || "stakeholder"} with ${body.influence || "unknown"} influence`).catch(() => {});
  }).catch(() => {});

  // Reverse sync: update Stakeholder Register artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncStakeholdersToArtefact }) =>
    syncStakeholdersToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  // Mark the scaffolded "Stakeholder communication and updates" PM task as
  // completed for this phase — see task-scaffolding.UNIVERSAL_TASKS.
  try {
    const deployment = await db.agentDeployment.findFirst({
      where: { projectId, isActive: true },
      select: { agentId: true },
    });
    if (deployment?.agentId) {
      const { onAgentEvent } = await import("@/lib/agents/task-scaffolding");
      await onAgentEvent(deployment.agentId, projectId, "stakeholder_updated");
    }
  } catch (e) {
    console.error("[stakeholders POST] stakeholder_updated event hook failed:", e);
  }

  return NextResponse.json({ data: stakeholder }, { status: 201 });
}
