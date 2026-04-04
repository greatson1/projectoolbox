import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

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
  for (const id of lowRiskIds) {
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

      // Execute the approved action
      try {
        const { executeApprovedAction } = await import("@/lib/agents/action-executor");
        await executeApprovedAction(id);
      } catch {}

      approved++;
    } catch {}
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
