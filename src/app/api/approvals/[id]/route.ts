import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createJob } from "@/lib/agents/job-queue";
import { nudgeJobProcessor } from "@/lib/agents/agent-backend";

// POST /api/approvals/[id] — Approve, reject, or defer
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { action, comment } = body; // action: "approve" | "reject" | "defer" | "request_changes"

  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const statusMap: Record<string, string> = {
    approve: "APPROVED",
    reject: "REJECTED",
    defer: "DEFERRED",
    request_changes: "DEFERRED",
  };

  const newStatus = statusMap[action];
  if (!newStatus) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const updated = await db.approval.update({
    where: { id },
    data: {
      status: newStatus as any,
      comment,
      resolvedAt: action !== "defer" ? new Date() : undefined,
    },
  });

  // Update linked agent decision if exists
  if (approval.requestedById) {
    await db.agentDecision.updateMany({
      where: { approvalId: id },
      data: { status: newStatus as any },
    });
  }

  // Create audit log
  const orgId = (session.user as any).orgId;
  if (orgId) {
    await db.auditLog.create({
      data: {
        orgId,
        userId: session.user.id,
        action: `approval_${action}`,
        target: approval.title,
        details: { approvalId: id, comment },
      },
    });
  }

  // Execute the approved action or handle request_changes
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId: approval.projectId, isActive: true },
  });

  if (deployment) {
    if (action === "approve") {
      // Unblock the deployment phase
      await db.agentDeployment.update({
        where: { id: deployment.id },
        data: { phaseStatus: "active" },
      });

      // Execute the approved action (inline — don't rely only on VPS)
      try {
        const { executeApprovedAction } = await import("@/lib/agents/action-executor");
        await executeApprovedAction(id);
      } catch (e) {
        console.error("Inline execution after approval failed:", e);
      }
    }

    if (action === "request_changes" && comment) {
      // Check iteration limit (max 3)
      if ((approval.iteration || 1) >= 3) {
        await db.approval.update({ where: { id }, data: { status: "REJECTED" as any } });
      }
    }

    // Also create VPS job as backup
    await createJob({
      agentId: deployment.agentId,
      deploymentId: deployment.id,
      type: "approval_resume",
      priority: 2,
      payload: { approvalId: id, action, comment, approvalType: approval.type },
    });
    nudgeJobProcessor().catch(() => {});
  }

  return NextResponse.json({ data: updated });
}
