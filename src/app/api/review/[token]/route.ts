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
  const { action, comment, riskId, strategy, escalateToEmail } = body;

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

  // ── Escalate Further: send new escalation email to the specified person ──
  if (action === "ESCALATE" && escalateToEmail && escalateToEmail.includes("@")) {
    try {
      const { randomBytes } = await import("crypto");
      const newToken = randomBytes(32).toString("hex");
      const baseUrl = process.env.NEXTAUTH_URL || "https://projectoolbox.com";

      // Create new ReviewLink for the escalation target
      await db.reviewLink.create({
        data: {
          token: newToken,
          approvalId: link.approvalId,
          email: escalateToEmail,
          name: escalateToEmail.split("@")[0],
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      // Send escalation email via Resend
      const resendKey = process.env.RESEND_API_KEY || process.env.RESEND_API_KEY_PROJECTOOLBOX;
      if (resendKey) {
        const project = await db.project.findUnique({ where: { id: link.approval.projectId }, select: { name: true } });
        const reviewUrl = `${baseUrl}/review/${newToken}`;
        const escalatorName = link.email || link.name || "A stakeholder";

        const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#7f1d1d,#991b1b);padding:20px 28px;border-radius:10px 10px 0 0;">
            <p style="color:rgba(255,255,255,0.7);font-size:11px;text-transform:uppercase;letter-spacing:1px;">Escalated Risk — Needs Your Attention</p>
            <h1 style="color:white;font-size:17px;margin:0;">${project?.name || "Project"}</h1>
          </div>
          <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
            <p style="font-size:14px;color:#374151;line-height:1.7;">
              <strong>${escalatorName}</strong> has escalated a risk to you for review because they were unable to resolve it at their level.
            </p>
            <p style="font-size:14px;color:#374151;line-height:1.7;">
              <strong>Original escalation:</strong> ${link.approval.title}
            </p>
            ${comment ? `<p style="font-size:14px;color:#374151;line-height:1.7;"><strong>Their comment:</strong> "${comment}"</p>` : ""}
            <p style="font-size:14px;color:#374151;line-height:1.7;">
              Please review the risk details and decide on the appropriate response strategy. No account needed — just click the button below.
            </p>
            <a href="${reviewUrl}" style="display:inline-block;margin-top:16px;background:#dc2626;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
              Review &amp; Respond
            </a>
            <p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:12px;">
              Escalation chain: Original → ${link.email || "stakeholder"} → you. No account required. Expires in 7 days.
            </p>
          </div>
        </div>`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `Projectoolbox <notifications@projectoolbox.com>`,
            to: [escalateToEmail],
            subject: `ESCALATED TO YOU: ${link.approval.title}`,
            html,
          }),
        }).catch(() => {});
      }

      // Log the chain escalation
      if (deployment?.agentId) {
        await db.agentActivity.create({
          data: {
            agentId: deployment.agentId, type: "approval",
            summary: `Risk further escalated: ${link.email || "stakeholder"} → ${escalateToEmail}. Reason: ${comment || "No comment"}`,
          },
        }).catch(() => {});
      }

      // Update risk responseLog with chain escalation
      if (riskId) {
        const risk = await db.risk.findUnique({ where: { id: riskId } });
        if (risk) {
          const log = ((risk as any).responseLog as any[]) || [];
          log.push({
            type: "CHAIN_ESCALATION",
            from: link.email || link.name || "stakeholder",
            to: escalateToEmail,
            comment: comment || "",
            escalatedAt: new Date().toISOString(),
          });
          await db.risk.update({ where: { id: riskId }, data: { responseLog: log } as any });
        }
      }
    } catch (e) {
      console.error("[review] Chain escalation failed:", e);
    }
  }

  return NextResponse.json({
    data: {
      success: true, action, status: newStatus,
      message: action === "ESCALATE" && escalateToEmail
        ? `Escalated to ${escalateToEmail}. They will receive a review link.`
        : "Your response has been recorded. The project team will be notified.",
    },
  });
}
