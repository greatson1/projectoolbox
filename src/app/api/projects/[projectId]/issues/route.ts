import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const issues = await db.issue.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ data: issues });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const body = await req.json();
  if (typeof body.dueDate === "string" && body.dueDate) body.dueDate = new Date(body.dueDate);
  for (const k of ["id", "projectId", "createdAt", "updatedAt"]) delete body[k];

  const issue = await db.issue.create({ data: { ...body, projectId } });

  // Reverse sync: update Issue Log artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncIssuesToArtefact }) =>
    syncIssuesToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  return NextResponse.json({ data: issue }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const body = await req.json();
  const { issueId, ...data } = body;
  if (!issueId) return NextResponse.json({ error: "issueId required" }, { status: 400 });

  if (typeof data.dueDate === "string" && data.dueDate) data.dueDate = new Date(data.dueDate);
  for (const k of ["id", "projectId", "createdAt", "updatedAt"]) delete data[k];

  const existing = await db.issue.findFirst({ where: { id: issueId, projectId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const issue = await db.issue.update({ where: { id: issueId }, data });

  // Track resolution in KB
  if (data.status === "CLOSED" || data.status === "RESOLVED") {
    import("@/lib/agents/kb-event-tracker").then(({ trackIssueResolution }) => {
      trackIssueResolution(projectId, issue.title || "Issue", data.resolution || "Resolved", issue.priority || "MEDIUM").catch(() => {});
    }).catch(() => {});
  }

  // Reverse sync: update Issue Log artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncIssuesToArtefact }) =>
    syncIssuesToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  return NextResponse.json({ data: issue });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const { searchParams } = new URL(req.url);
  let issueId = searchParams.get("id");
  if (!issueId) {
    const body = await req.json().catch(() => ({}));
    issueId = body.issueId;
  }
  if (!issueId) return NextResponse.json({ error: "issueId required" }, { status: 400 });

  const existing = await db.issue.findFirst({ where: { id: issueId, projectId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.issue.delete({ where: { id: issueId } });

  // Reverse sync: update Issue Log artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncIssuesToArtefact }) =>
    syncIssuesToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
