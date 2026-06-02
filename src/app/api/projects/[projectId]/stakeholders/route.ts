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

  // Normalise + dedup on the create path. Without this, clicking "Add
  // stakeholder" and typing the same name twice produced two rows; same
  // for the People-page Add form being submitted with a trailing space.
  const { normaliseStakeholderName, stakeholderNameKey } = await import("@/lib/agents/stakeholder-name");
  const { looksLikePlaceholderName } = await import("@/lib/agents/fabricated-names-pure");
  const cleanName = normaliseStakeholderName(body?.name);
  if (cleanName && looksLikePlaceholderName(cleanName)) {
    return NextResponse.json(
      { error: `"${cleanName}" looks like a placeholder rather than a person's name. Use a real name or role title (e.g. "Project Sponsor") and update later.` },
      { status: 400 },
    );
  }
  if (cleanName) {
    const allExisting = await db.stakeholder.findMany({
      where: { projectId },
      select: { id: true, name: true, role: true, organisation: true, power: true, interest: true },
    });
    const dup = allExisting.find(s => stakeholderNameKey(s.name) === stakeholderNameKey(cleanName));
    if (dup) {
      // Merge the inbound payload into the existing row instead of creating
      // a second one. The user gets the row back; the UI's optimistic
      // update treats it as if it were freshly created. Only fill blank
      // fields — never overwrite values the user already set.
      const patch: Record<string, unknown> = {};
      const fields = ["role", "organisation", "email", "sentiment"] as const;
      for (const f of fields) {
        if (!((dup as Record<string, unknown>)[f]) && body[f]) patch[f] = body[f];
      }
      if (typeof body.power === "number" && dup.power === 50) patch.power = body.power;
      if (typeof body.interest === "number" && dup.interest === 50) patch.interest = body.interest;
      if (dup.name !== cleanName) patch.name = cleanName;
      const merged = Object.keys(patch).length > 0
        ? await db.stakeholder.update({ where: { id: dup.id }, data: patch })
        : dup;
      return NextResponse.json({ data: merged, deduped: true });
    }
  }

  const stakeholder = await db.stakeholder.create({
    data: { ...body, ...(cleanName ? { name: cleanName } : {}), projectId },
  });

  // Key-role propagation — if this new stakeholder is a Sponsor / PM /
  // Client, mirror it into the KB as a user_confirmed fact so the
  // phase-prereq evaluator sees it on the KB read-path too. Without
  // this, a sponsor added on the People page only ever lived in the
  // Stakeholder table — the prereq still ticked (because the evaluator
  // also reads Stakeholder.role) but a sponsor named later via chat
  // wouldn't show up here. recordKeyRole makes the two paths
  // symmetric. Idempotent: the helper itself dedups by name.
  try {
    const { classifyKeyRole, recordKeyRole } = await import("@/lib/agents/key-role-recorder");
    const canonical = classifyKeyRole(body.role);
    if (canonical && cleanName) {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { orgId: true },
      });
      if (project?.orgId) {
        await recordKeyRole({
          projectId,
          orgId: project.orgId,
          role: canonical,
          name: cleanName,
          source: "people-page",
        });
      }
    }
  } catch (e) {
    console.error("[stakeholders POST] key-role propagation failed:", e);
  }

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
