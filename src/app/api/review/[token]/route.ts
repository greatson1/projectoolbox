import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/review/:token — Guest review: fetch approval + risk data (no auth)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const link = await db.reviewLink.findUnique({
    where: { token },
    include: {
      approval: {
        include: {
          project: { select: { id: true, name: true, budget: true, methodology: true } },
          decision: { include: { agent: { select: { name: true, gradient: true } } } },
        },
      },
    },
  });

  if (!link) return NextResponse.json({ error: "Review link not found" }, { status: 404 });
  if (link.expiresAt < new Date()) return NextResponse.json({ error: "This review link has expired" }, { status: 410 });

  // Mark as viewed
  if (!link.viewedAt) {
    await db.reviewLink.update({ where: { token }, data: { viewedAt: new Date() } });
  }

  // Load risks for this project (sorted by severity)
  const risks = await db.risk.findMany({
    where: { projectId: link.approval.projectId },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
  });

  // Load agent context
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId: link.approval.projectId, isActive: true },
    include: { agent: { select: { name: true, gradient: true } } },
  });

  const a = link.approval;
  return NextResponse.json({
    data: {
      title: a.title,
      type: a.type,
      description: a.description,
      reasoning: a.reasoningChain,
      urgency: a.urgency,
      projectName: a.project.name,
      projectBudget: a.project.budget,
      agentName: a.decision?.agent?.name || deployment?.agent?.name || "Agent",
      agentGradient: a.decision?.agent?.gradient || deployment?.agent?.gradient,
      impactScores: a.impactScores,
      affectedItems: a.affectedItems,
      suggestedAlternatives: a.suggestedAlternatives,
      expiresAt: link.expiresAt,
      // Risk data for risk escalation reviews
      risks: risks.map(r => ({
        id: r.id, title: r.title, description: r.description,
        probability: r.probability, impact: r.impact, score: r.score,
        category: r.category, status: r.status, owner: r.owner,
        mitigation: r.mitigation, responseLog: r.responseLog,
      })),
      // Guest state
      alreadyActioned: !!link.actionedAt,
      previousAction: link.action,
      previousComment: link.comment,
    },
  });
}

// POST /api/review/:token — Guest response: approval OR risk action (no auth)
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json();
  const { action, comment, riskId, strategy } = body;

  const link = await db.reviewLink.findUnique({
    where: { token },
    include: { approval: { select: { id: true, projectId: true, title: true } } },
  });
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (link.expiresAt < new Date()) return NextResponse.json({ error: "Expired" }, { status: 410 });
  if (link.actionedAt) return NextResponse.json({ error: "Already responded" }, { status: 409 });

  // Validate action — supports both approval actions and risk response strategies
  const validActions = ["approve", "reject", "request_changes", "ACCEPT", "MITIGATE", "TRANSFER", "AVOID", "ESCALATE"];
  if (!action || !validActions.includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Record on ReviewLink
  await db.reviewLink.update({
    where: { token },
    data: { actionedAt: new Date(), action, comment: comment || null },
  });

  // ── Risk-specific response ──
  if (riskId) {
    const risk = await db.risk.findUnique({ where: { id: riskId } });
    if (risk) {
      const log = (risk.responseLog as any[]) || [];
      log.push({
        type: "STAKEHOLDER_RESPONSE", action, strategy: strategy || null,
        comment: comment || "",
        respondedBy: link.email || link.name || "External stakeholder",
        respondedAt: new Date().toISOString(),
        source: "magic_link",
      });
      const riskStatusMap: Record<string, string> = {
        ACCEPT: "ACCEPTED", MITIGATE: "MITIGATING", TRANSFER: "TRANSFERRED", AVOID: "CLOSED",
      };
      await db.risk.update({
        where: { id: riskId },
        data: {
          responseLog: log,
          ...(riskStatusMap[action] ? { status: riskStatusMap[action] } : {}),
        },
      });
    }
  }

  // ── Approval-level response ──
  const approvalStatusMap: Record<string, string> = {
    approve: "APPROVED", reject: "REJECTED", request_changes: "DEFERRED",
    ACCEPT: "APPROVED", MITIGATE: "APPROVED", TRANSFER: "APPROVED", AVOID: "APPROVED",
  };
  const newStatus = approvalStatusMap[action] || "DEFERRED";

  await db.approval.update({
    where: { id: link.approvalId },
    data: {
      status: newStatus as any,
      resolvedAt: new Date(),
      comment: comment || `${action}${strategy ? ` (${strategy})` : ""} via external review${link.name ? ` by ${link.name}` : ""}`,
    },
  });

  // Execute approved action if applicable
  if (["approve", "ACCEPT", "MITIGATE", "TRANSFER"].includes(action)) {
    try {
      const { executeApprovedAction } = await import("@/lib/agents/action-executor");
      await executeApprovedAction(link.approvalId);
    } catch {}
  }

  // Notify agent + post to chat
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId: link.approval.projectId, isActive: true },
    select: { agentId: true },
  });
  if (deployment?.agentId) {
    const who = link.email || link.name || "External stakeholder";
    await db.agentActivity.create({
      data: {
        agentId: deployment.agentId, type: "approval",
        summary: `${who} responded to "${link.approval.title}": ${action}${strategy ? ` — ${strategy}` : ""}${comment ? ` — "${comment}"` : ""}`,
      },
    }).catch(() => {});

    await db.chatMessage.create({
      data: {
        agentId: deployment.agentId, role: "agent",
        content: `External stakeholder **${who}** responded to the escalation:\n\n**Decision:** ${action}${strategy ? `\n**Strategy:** ${strategy}` : ""}${comment ? `\n**Comment:** ${comment}` : ""}\n\nThis has been logged in the risk register and the approval has been updated.`,
      },
    }).catch(() => {});
  }

  // Notify org admins
  try {
    const project = await db.project.findUnique({ where: { id: link.approval.projectId }, select: { orgId: true } });
    if (project?.orgId) {
      const admins = await db.user.findMany({ where: { orgId: project.orgId, role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } });
      for (const a of admins) {
        await db.notification.create({
          data: {
            userId: a.id, type: "AGENT_ALERT",
            title: `Stakeholder responded: ${action}`,
            body: `${link.email || "Guest"} on "${link.approval.title}"${comment ? `: ${comment}` : ""}`,
            actionUrl: `/projects/${link.approval.projectId}/risk`,
          },
        }).catch(() => {});
      }
    }
  } catch {}

  return NextResponse.json({
    data: { success: true, action, status: newStatus, message: "Your response has been recorded. The project team will be notified." },
  });
}
