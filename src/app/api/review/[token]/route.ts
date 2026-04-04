import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/review/:token — Get review link data (no auth required)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const link = await db.reviewLink.findUnique({
    where: { token },
    include: {
      approval: {
        include: {
          project: { select: { name: true } },
          decision: { include: { agent: { select: { name: true } } } },
        },
      },
    },
  });

  if (!link) return NextResponse.json({ error: "Review link not found" }, { status: 404 });
  if (link.expiresAt < new Date()) return NextResponse.json({ error: "This review link has expired" }, { status: 410 });
  if (link.actionedAt) return NextResponse.json({ error: "This review has already been completed" }, { status: 410 });

  // Mark as viewed
  if (!link.viewedAt) {
    await db.reviewLink.update({ where: { token }, data: { viewedAt: new Date() } });
  }

  const a = link.approval;
  return NextResponse.json({
    data: {
      title: a.title,
      type: a.type,
      description: a.description,
      reasoning: a.reasoningChain,
      urgency: a.urgency,
      projectName: a.project.name,
      agentName: a.decision?.agent?.name || "Agent",
      impactScores: a.impactScores,
      affectedItems: a.affectedItems,
      suggestedAlternatives: a.suggestedAlternatives,
      expiresAt: link.expiresAt,
    },
  });
}

// POST /api/review/:token — Submit review action (no auth required)
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { action, comment } = await req.json();

  const link = await db.reviewLink.findUnique({ where: { token } });
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (link.expiresAt < new Date()) return NextResponse.json({ error: "Expired" }, { status: 410 });
  if (link.actionedAt) return NextResponse.json({ error: "Already actioned" }, { status: 410 });

  // Update the review link
  await db.reviewLink.update({
    where: { token },
    data: { actionedAt: new Date(), action, comment },
  });

  // Update the approval
  const statusMap: Record<string, string> = {
    approve: "APPROVED",
    reject: "REJECTED",
    request_changes: "DEFERRED",
  };

  const newStatus = statusMap[action] || "DEFERRED";

  await db.approval.update({
    where: { id: link.approvalId },
    data: {
      status: newStatus as any,
      resolvedAt: action !== "request_changes" ? new Date() : undefined,
      comment: comment || `Reviewed via external link${link.name ? ` by ${link.name}` : ""}`,
    },
  });

  // If approved, trigger action execution
  if (action === "approve") {
    try {
      const { executeApprovedAction } = await import("@/lib/agents/action-executor");
      await executeApprovedAction(link.approvalId);
    } catch {}
  }

  return NextResponse.json({ data: { status: newStatus } });
}
