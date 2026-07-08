import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // closure report is a full LLM generation

/**
 * POST /api/projects/:id/close — user-initiated project closure.
 *
 * The automatic closure pipeline only fires when the FINAL phase gate is
 * approved, which forces a project that finished in real life (or was
 * cancelled) to grind through every remaining phase before the platform
 * lets go of it — the "Family Trip to Lagos" problem: the trip happened
 * weeks ago, the project was still parked in Planning.
 *
 * Body:
 *   resolveOpenItems?: boolean — bulk-resolve everything still open so the
 *     closure gate passes: open tasks → CANCELLED, open risks → CLOSED,
 *     open issues → CLOSED, pending approvals → REJECTED, draft artefacts
 *     → REJECTED. Every bulk action is audit-logged. Default false: the
 *     closure gate reports blockers and nothing is touched.
 *   reason?: string — recorded as the archive reason
 *     (e.g. "Delivered early", "Cancelled — budget withdrawn").
 *
 * Flow: (optionally) resolve open items → run the standard closure pipeline
 * (closure report + audit consolidation + archive) → stamp COMPLETED status
 * and the user's reason. HITL by design: this endpoint is only reachable by
 * a signed-in human; agents cannot close projects.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id as string;
  const orgId = (session.user as any).orgId as string | undefined;
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, orgId: true, status: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (orgId && project.orgId !== orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (project.status === "ARCHIVED") {
    return NextResponse.json({ error: "Project is already archived" }, { status: 409 });
  }

  let resolveOpenItems = false;
  let reason: string | null = null;
  try {
    const body = await req.json();
    resolveOpenItems = body?.resolveOpenItems === true;
    if (typeof body?.reason === "string" && body.reason.trim()) reason = body.reason.trim().slice(0, 500);
  } catch { /* no body */ }

  // The closure report is written by the project's agent — most recent
  // deployment wins whether or not it's still active.
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId },
    orderBy: { deployedAt: "desc" },
    select: { agentId: true },
  });
  if (!deployment) {
    return NextResponse.json({ error: "No agent has ever been deployed to this project — archive it directly instead." }, { status: 400 });
  }

  const resolved = { tasks: 0, risks: 0, issues: 0, approvals: 0, artefacts: 0 };
  if (resolveOpenItems) {
    const note = `Bulk-resolved at project closure by user${reason ? ` — ${reason}` : ""}`;
    resolved.tasks = (await db.task.updateMany({
      where: { projectId, status: { notIn: ["DONE", "COMPLETED", "CANCELLED"] } },
      data: { status: "CANCELLED", lastEditedBy: userId },
    })).count;
    resolved.risks = (await db.risk.updateMany({
      where: { projectId, status: { notIn: ["CLOSED", "MITIGATED", "ACCEPTED", "TRANSFERRED"] } },
      data: { status: "CLOSED" },
    })).count;
    resolved.issues = (await db.issue.updateMany({
      where: { projectId, status: { notIn: ["CLOSED", "RESOLVED"] } },
      data: { status: "CLOSED" },
    })).count;
    resolved.approvals = (await db.approval.updateMany({
      where: { projectId, status: "PENDING" },
      data: { status: "REJECTED", comment: note, resolvedAt: new Date() },
    })).count;
    resolved.artefacts = (await db.agentArtefact.updateMany({
      where: { projectId, status: { in: ["DRAFT", "PENDING_REVIEW"] } },
      data: { status: "REJECTED", feedback: note },
    })).count;

    await db.auditLog.create({
      data: {
        orgId: project.orgId!,
        userId,
        action: "PROJECT_CLOSE_BULK_RESOLVE",
        target: project.name,
        entityType: "project",
        entityId: projectId,
        rationale: note,
        details: resolved as any,
      },
    }).catch(() => {});
  }

  const { runProjectClosure } = await import("@/lib/agents/project-closure");
  const result = await runProjectClosure(projectId, deployment.agentId, userId);

  // Stamp the user's reason + COMPLETED-then-archived semantics. The
  // pipeline archives with a generic "lifecycle complete" reason; a
  // user-initiated close should carry the user's own words.
  if (result.success) {
    await db.project.update({
      where: { id: projectId },
      data: { archiveReason: reason ?? "Closed by user — project complete" },
    }).catch(() => {});
  }

  return NextResponse.json({
    data: {
      success: result.success,
      blockers: result.blockers,
      closureReportId: result.closureReportId ?? null,
      resolved: resolveOpenItems ? resolved : null,
      archivedAt: result.archivedAt ?? null,
    },
  }, { status: result.success ? 200 : 409 });
}
