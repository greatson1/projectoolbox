import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const crs = await db.changeRequest.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ data: crs });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const body = await req.json();
  for (const k of ["id", "projectId", "createdAt", "updatedAt"]) delete body[k];
  if (typeof body.decisionDate === "string" && body.decisionDate) body.decisionDate = new Date(body.decisionDate);

  const cr = await db.changeRequest.create({ data: { ...body, projectId } });

  // Reverse sync: update Change Request Register artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncChangeRequestsToArtefact }) =>
    syncChangeRequestsToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  return NextResponse.json({ data: cr }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const body = await req.json();
  const { crId, ...data } = body;
  if (!crId) return NextResponse.json({ error: "crId required" }, { status: 400 });

  for (const k of ["id", "projectId", "createdAt", "updatedAt"]) delete data[k];
  if (typeof data.decisionDate === "string" && data.decisionDate) data.decisionDate = new Date(data.decisionDate);

  const existing = await db.changeRequest.findFirst({ where: { id: crId, projectId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cr = await db.changeRequest.update({ where: { id: crId }, data });

  // Reverse sync: update Change Request Register artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncChangeRequestsToArtefact }) =>
    syncChangeRequestsToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  return NextResponse.json({ data: cr });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const { searchParams } = new URL(req.url);
  let crId = searchParams.get("id");
  if (!crId) {
    const body = await req.json().catch(() => ({}));
    crId = body.crId;
  }
  if (!crId) return NextResponse.json({ error: "crId required" }, { status: 400 });

  const existing = await db.changeRequest.findFirst({ where: { id: crId, projectId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.changeRequest.delete({ where: { id: crId } });

  // Reverse sync: update Change Request Register artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncChangeRequestsToArtefact }) =>
    syncChangeRequestsToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
