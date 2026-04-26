import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Manual prerequisite confirmations are persisted as KnowledgeBaseItem rows
 * tagged "prereq_confirmation" so the existing KB plumbing handles them
 * (no schema change, easy to revoke). Each row pins one (phase, prereq)
 * pair to one user with a timestamp.
 *
 *   POST   { phase, prereq }   — confirm
 *   DELETE { phase, prereq }   — un-confirm
 *   GET                          — list confirmations for the project
 */

const TAG = "prereq_confirmation";

function buildTitle(phase: string, prereq: string): string {
  return `Prereq confirmed: ${phase} — ${prereq}`;
}

async function getOrgIdAndDeployment(projectId: string, orgId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });
  if (!project) return null;
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    select: { agentId: true },
  });
  return { agentId: deployment?.agentId ?? null };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { projectId } = await params;
  const ctx = await getOrgIdAndDeployment(projectId, orgId);
  if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const rows = await db.knowledgeBaseItem.findMany({
    where: { projectId, orgId, tags: { has: TAG } },
    select: { id: true, title: true, content: true, metadata: true, createdAt: true },
  });

  const confirmations = rows.map(r => {
    const meta = (r.metadata as Record<string, unknown>) || {};
    return {
      id: r.id,
      phase: typeof meta.phase === "string" ? meta.phase : null,
      prereq: typeof meta.prereq === "string" ? meta.prereq : null,
      confirmedBy: typeof meta.confirmedBy === "string" ? meta.confirmedBy : null,
      confirmedAt: r.createdAt.toISOString(),
    };
  }).filter(c => c.phase && c.prereq);

  return NextResponse.json({ data: confirmations });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { projectId } = await params;
  const ctx = await getOrgIdAndDeployment(projectId, orgId);
  if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await req.json();
  const { phase, prereq } = body;
  if (typeof phase !== "string" || typeof prereq !== "string" || !phase.trim() || !prereq.trim()) {
    return NextResponse.json({ error: "phase and prereq required" }, { status: 400 });
  }

  // Idempotent: dedupe on (phase, prereq)
  const existing = await db.knowledgeBaseItem.findFirst({
    where: { projectId, orgId, tags: { has: TAG }, title: buildTitle(phase, prereq) },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ data: { id: existing.id, alreadyConfirmed: true } });
  }

  const confirmedBy = session.user.name ?? session.user.email ?? "unknown user";
  const created = await db.knowledgeBaseItem.create({
    data: {
      orgId,
      agentId: ctx.agentId,
      projectId,
      layer: "PROJECT",
      type: "TEXT",
      title: buildTitle(phase, prereq),
      content: `${confirmedBy} manually confirmed prerequisite "${prereq}" for the ${phase} phase gate.`,
      tags: [TAG, phase.toLowerCase().replace(/\s+/g, "-")],
      trustLevel: "HIGH",
      metadata: { phase, prereq, confirmedBy } as any,
    },
  });

  // Audit trail in agent activity feed
  if (ctx.agentId) {
    await db.agentActivity.create({
      data: {
        agentId: ctx.agentId,
        type: "approval",
        summary: `${confirmedBy} confirmed prereq for ${phase}: "${prereq.slice(0, 120)}"`,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ data: { id: created.id } });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { projectId } = await params;
  const ctx = await getOrgIdAndDeployment(projectId, orgId);
  if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await req.json();
  const { phase, prereq } = body;
  if (typeof phase !== "string" || typeof prereq !== "string") {
    return NextResponse.json({ error: "phase and prereq required" }, { status: 400 });
  }

  const result = await db.knowledgeBaseItem.deleteMany({
    where: { projectId, orgId, tags: { has: TAG }, title: buildTitle(phase, prereq) },
  });

  if (ctx.agentId && result.count > 0) {
    const undidBy = session.user.name ?? session.user.email ?? "unknown user";
    await db.agentActivity.create({
      data: {
        agentId: ctx.agentId,
        type: "approval",
        summary: `${undidBy} un-confirmed prereq for ${phase}: "${prereq.slice(0, 120)}"`,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ data: { removed: result.count } });
}
