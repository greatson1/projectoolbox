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

// ─── PATCH — update a stakeholder ─────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const body = await req.json();
  const { stakeholderId, ...data } = body;
  if (!stakeholderId) return NextResponse.json({ error: "stakeholderId required" }, { status: 400 });

  // Strip server-managed fields a client must not set
  for (const k of ["id", "projectId", "sentimentScore", "sentimentUpdatedAt"]) delete data[k];

  // Ensure the stakeholder belongs to this project before updating
  const existing = await db.stakeholder.findFirst({ where: { id: stakeholderId, projectId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stakeholder = await db.stakeholder.update({ where: { id: stakeholderId }, data });

  // Track the change in KB
  import("@/lib/agents/kb-event-tracker").then(({ trackStakeholderChange }) => {
    trackStakeholderChange(projectId, stakeholder.name || "Stakeholder", "details updated").catch(() => {});
  }).catch(() => {});

  // Reverse sync: update Stakeholder Register artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncStakeholdersToArtefact }) =>
    syncStakeholdersToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  return NextResponse.json({ data: stakeholder });
}

// ─── DELETE — remove a stakeholder ────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  // stakeholderId may arrive via query string (?id=) or JSON body
  let stakeholderId = req.nextUrl.searchParams.get("id") ?? undefined;
  if (!stakeholderId) {
    const body = await req.json().catch(() => ({}));
    stakeholderId = body.stakeholderId;
  }
  if (!stakeholderId) return NextResponse.json({ error: "stakeholderId required" }, { status: 400 });

  // Ensure the stakeholder belongs to this project before deleting
  const existing = await db.stakeholder.findFirst({ where: { id: stakeholderId, projectId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.stakeholder.delete({ where: { id: stakeholderId } });

  // Track the removal in KB
  import("@/lib/agents/kb-event-tracker").then(({ trackStakeholderChange }) => {
    trackStakeholderChange(projectId, existing.name || "Stakeholder", "removed from register").catch(() => {});
  }).catch(() => {});

  // Reverse sync: update Stakeholder Register artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncStakeholdersToArtefact }) =>
    syncStakeholdersToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  return NextResponse.json({ data: { id: stakeholderId } });
}
