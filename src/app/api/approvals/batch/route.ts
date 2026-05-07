import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/approvals/batch — Batch approve LOW-risk approvals
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const body = await req.json();
  const { ids } = body;

  if (!ids?.length) return NextResponse.json({ error: "No IDs provided" }, { status: 400 });

  // Verify all approvals are LOW risk and belong to this org's projects
  const approvals = await db.approval.findMany({
    where: {
      id: { in: ids },
      status: "PENDING",
      project: { orgId },
    },
    select: { id: true, impactScores: true },
  });

  // Filter to only LOW risk (score ≤ 8)
  const lowRiskIds = approvals.filter(a => {
    const scores = a.impactScores as any;
    if (!scores) return false;
    const total = (scores.schedule || 1) + (scores.cost || 1) + (scores.scope || 1) + (scores.stakeholder || 1);
    return total <= 8;
  }).map(a => a.id);

  if (lowRiskIds.length === 0) {
    return NextResponse.json({ error: "No LOW-risk approvals in selection" }, { status: 400 });
  }

  // Batch approve
  let approved = 0;
  const researchFindingIds: string[] = [];

  // Fetch full approval data so we can check subtypes
  const fullApprovals = await db.approval.findMany({
    where: { id: { in: lowRiskIds } },
    select: { id: true, type: true, impact: true, requestedById: true, projectId: true },
  });

  for (const approval of fullApprovals) {
    const id = approval.id;
    try {
      await db.approval.update({
        where: { id },
        data: { status: "APPROVED" as any, resolvedAt: new Date(), comment: "Batch approved (Low Risk)" },
      });

      // Update linked decision
      await db.agentDecision.updateMany({
        where: { approvalId: id },
        data: { status: "APPROVED" as any },
      });

      // Research-finding subtypes need their own handler (which also checks
      // if all findings are now approved and kicks off clarification/generation).
      const isResearch = approval.type === "CHANGE_REQUEST" && (approval.impact as any)?.subtype === "research_finding";
      if (isResearch) {
        researchFindingIds.push(id);
      } else {
        try {
          const { executeApprovedAction } = await import("@/lib/agents/action-executor");
          await executeApprovedAction(id);
        } catch {}
      }

      approved++;
    } catch {}
  }

  // Apply research-finding decisions after ALL are marked approved so the
  // "stillPending === 0" check in applyResearchApprovalDecision fires correctly
  // on the last one and triggers the clarification → generation sequence.
  if (researchFindingIds.length > 0) {
    const { applyResearchApprovalDecision } = await import("@/lib/agents/research-approval");
    for (const id of researchFindingIds) {
      try {
        const approval = fullApprovals.find(a => a.id === id);
        if (approval) {
          await applyResearchApprovalDecision({ id: approval.id, impact: approval.impact }, "APPROVED");
        }
      } catch (e) {
        console.error("[batch-approve] applyResearchApprovalDecision failed for", id, e);
      }
    }
  }

  // Audit log
  await db.auditLog.create({
    data: {
      orgId,
      userId: session.user.id,
      action: "batch_approve_low_risk",
      target: `${approved} approvals`,
      details: { ids: lowRiskIds },
    },
  });

  return NextResponse.json({ data: { approved, total: lowRiskIds.length } });
}
