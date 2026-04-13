import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── GET — list all risks ────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const risks = await db.risk.findMany({
    where: { projectId },
    orderBy: { score: "desc" },
  });

  return NextResponse.json({ data: risks });
}

// ─── POST — create risk ──────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const risk = await db.risk.create({
    data: { ...body, score: (body.probability || 3) * (body.impact || 3), projectId },
  });

  return NextResponse.json({ data: risk }, { status: 201 });
}

// ─── PATCH — update risk / response actions / escalation ────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const body = await req.json();
  const { riskId, action, ...data } = body;
  if (!riskId) return NextResponse.json({ error: "riskId required" }, { status: 400 });

  // ── Add response action ────────────────────────────────────────────────────
  if (action === "add-response-action") {
    const existing = await db.risk.findUnique({ where: { id: riskId, projectId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const log = (existing.responseLog as any[] | null) ?? [];
    const newEntry = {
      id: crypto.randomUUID(),
      type: "ACTION",
      strategy: data.strategy || "REDUCE",
      action: data.actionText,
      owner: data.owner || null,
      ownerEmail: data.ownerEmail || null,
      dueDate: data.dueDate || null,
      status: "PLANNED",
      notes: data.notes || null,
      createdAt: new Date().toISOString(),
    };
    const updated = await db.risk.update({
      where: { id: riskId, projectId },
      data: { responseLog: [...log, newEntry] },
    });
    return NextResponse.json({ data: updated });
  }

  // ── Update response action ─────────────────────────────────────────────────
  if (action === "update-response-action") {
    const existing = await db.risk.findUnique({ where: { id: riskId, projectId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const log = ((existing.responseLog as any[]) ?? []).map((entry: any) =>
      entry.id === data.actionId
        ? { ...entry, ...data.patch, updatedAt: new Date().toISOString() }
        : entry
    );
    const updated = await db.risk.update({
      where: { id: riskId, projectId },
      data: { responseLog: log },
    });
    return NextResponse.json({ data: updated });
  }

  // ── Delete response action ─────────────────────────────────────────────────
  if (action === "delete-response-action") {
    const existing = await db.risk.findUnique({ where: { id: riskId, projectId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Escalation entries are permanent — cannot be deleted
    const log = ((existing.responseLog as any[]) ?? []).filter(
      (e: any) => e.id !== data.actionId || e.type === "ESCALATION"
    );
    const updated = await db.risk.update({
      where: { id: riskId, projectId },
      data: { responseLog: log },
    });
    return NextResponse.json({ data: updated });
  }

  // ── Escalate risk ──────────────────────────────────────────────────────────
  if (action === "escalate") {
    const { recipients, customMessage } = data; // recipients: string[] of emails

    const existing = await db.risk.findUnique({ where: { id: riskId, projectId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { name: true, orgId: true },
    });

    // Find the deployed agent for this project
    const deployment = await db.agentDeployment.findFirst({
      where: { projectId, isActive: true },
      include: { agent: { select: { name: true, codename: true } } },
    });
    const agentName = deployment?.agent?.name ?? "Project Agent";

    const responseLog = (existing.responseLog as any[]) ?? [];
    const actionEntries = responseLog.filter((e: any) => e.type !== "ESCALATION");

    // ── Generate email with Claude ────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    let emailSubject = `ESCALATION: ${existing.title} — ${project?.name ?? "Project"}`;
    let emailBody = customMessage || "";

    if (apiKey) {
      try {
        const prompt = `You are ${agentName}, an AI project manager for ${project?.name ?? "this project"}.

Write a professional risk escalation email. Be concise, factual, and action-oriented.

RISK DETAILS:
- Title: ${existing.title}
- Description: ${existing.description || "No description"}
- Probability: ${existing.probability}/5 | Impact: ${existing.impact}/5 | Score: ${existing.score ?? existing.probability * existing.impact}/25
- Category: ${existing.category || "Not categorised"}
- Current Status: ${existing.status}
- Risk Owner: ${existing.owner || "Unassigned"}
- Mitigation Summary: ${existing.mitigation || "None documented"}

RESPONSE ACTIONS IN PROGRESS (${actionEntries.length}):
${actionEntries.length > 0
  ? actionEntries.map((a: any) => `- [${a.status}] ${a.action}${a.owner ? ` (Owner: ${a.owner})` : ""}`).join("\n")
  : "No response actions recorded yet."}

${customMessage ? `ADDITIONAL CONTEXT FROM PROJECT MANAGER:\n${customMessage}` : ""}

Write:
1. A subject line (one sentence, starts with "ESCALATION:")
2. The email body (3-4 short paragraphs: situation summary, current response status, what decision/action is required, deadline if applicable)

Format your response as:
SUBJECT: [subject line here]
BODY:
[email body here]`;

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
            max_tokens: 600,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (res.ok) {
          const json = await res.json();
          const text = json.content?.[0]?.text ?? "";
          const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
          const bodyMatch = text.match(/BODY:\n([\s\S]+)/);
          if (subjectMatch) emailSubject = subjectMatch[1].trim();
          if (bodyMatch) emailBody = bodyMatch[1].trim();
        }
      } catch (e) {
        console.error("[risks/escalate] Claude generation failed:", e);
        // Fall back to template email
        emailBody = `Dear ${existing.owner || "Risk Owner"},

I am writing to formally escalate risk "${existing.title}" on project ${project?.name ?? ""}. With a current risk score of ${existing.score ?? existing.probability * existing.impact}/25 (Probability: ${existing.probability}/5, Impact: ${existing.impact}/5), this risk requires immediate attention and decision-making at a senior level.

${actionEntries.length > 0
  ? `The following response actions are currently in place:\n${actionEntries.map((a: any) => `• ${a.action} [${a.status}]`).join("\n")}`
  : "No response actions have been recorded against this risk."}

Please review the risk register and advise on the required course of action as soon as possible. A decision is needed to prevent further project impact.

This escalation has been logged in the project risk register.

${agentName}
${project?.name ?? "Project"} — AI Project Manager`;
      }
    }

    // ── Send emails via Resend ────────────────────────────────────────────
    const resendKey = process.env.RESEND_API_KEY || process.env.RESEND_API_KEY_PROJECTOOLBOX;
    const emailsSent: string[] = [];
    const emailsFailed: string[] = [];

    if (resendKey && recipients?.length > 0) {
      const html = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:620px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#7f1d1d,#991b1b);padding:20px 28px;border-radius:10px 10px 0 0;">
            <p style="color:rgba(255,255,255,0.7);font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Risk Escalation Notice</p>
            <h1 style="color:white;font-size:17px;margin:0;">${project?.name ?? "Project"}</h1>
          </div>
          <div style="background:#fef2f2;padding:16px 28px;border-left:4px solid #dc2626;border-right:1px solid #fecaca;border-bottom:1px solid #fecaca;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="background:#dc2626;color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:100px;text-transform:uppercase;">ESCALATED</span>
              <span style="font-size:13px;font-weight:600;color:#991b1b;">Score: ${existing.score ?? existing.probability * existing.impact}/25 — P${existing.probability} × I${existing.impact}</span>
            </div>
            <p style="font-size:15px;font-weight:700;color:#1a1a1a;margin:8px 0 0;">${existing.title}</p>
          </div>
          <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
            <div style="white-space:pre-line;font-size:14px;color:#374151;line-height:1.7;">${emailBody.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
            <div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
              <p style="font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7280;margin:0 0 8px;">Risk Details</p>
              <table style="width:100%;font-size:12px;color:#374151;border-collapse:collapse;">
                <tr><td style="padding:2px 0;color:#6b7280;width:40%;">Probability</td><td>${existing.probability}/5</td></tr>
                <tr><td style="padding:2px 0;color:#6b7280;">Impact</td><td>${existing.impact}/5</td></tr>
                <tr><td style="padding:2px 0;color:#6b7280;">Score</td><td><strong style="color:#dc2626;">${existing.score ?? existing.probability * existing.impact}/25</strong></td></tr>
                <tr><td style="padding:2px 0;color:#6b7280;">Category</td><td>${existing.category || "—"}</td></tr>
                <tr><td style="padding:2px 0;color:#6b7280;">Risk Owner</td><td>${existing.owner || "—"}</td></tr>
                ${actionEntries.length > 0 ? `<tr><td style="padding:2px 0;color:#6b7280;vertical-align:top;">Response Actions</td><td>${actionEntries.map((a: any) => `<span style="display:block;">${a.action} <span style="color:#6b7280;">[${a.status}]</span></span>`).join("")}</td></tr>` : ""}
              </table>
            </div>
            <a href="${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}/projects/${projectId}/risk"
              style="display:inline-block;margin-top:20px;background:#dc2626;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
              View Risk Register →
            </a>
            <p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:12px;">
              Sent by ${agentName} via Projectoolbox · <a href="${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}/projects/${projectId}/risk" style="color:#4f46e5;">View register</a>
            </p>
          </div>
        </div>`;

      for (const email of recipients) {
        try {
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Projectoolbox <notifications@projectoolbox.com>",
              to: [email],
              subject: emailSubject,
              html,
            }),
          });
          if (emailRes.ok) emailsSent.push(email);
          else emailsFailed.push(email);
        } catch {
          emailsFailed.push(email);
        }
      }
    }

    // ── Log escalation in responseLog ─────────────────────────────────────
    const escalationEntry = {
      id: crypto.randomUUID(),
      type: "ESCALATION",
      escalatedAt: new Date().toISOString(),
      escalatedBy: session.user.name || session.user.email || "User",
      recipients: emailsSent,
      failedRecipients: emailsFailed,
      subject: emailSubject,
      emailPreview: emailBody.slice(0, 300) + (emailBody.length > 300 ? "…" : ""),
    };

    const updatedRisk = await db.risk.update({
      where: { id: riskId, projectId },
      data: {
        status: "ESCALATED",
        responseLog: [...responseLog, escalationEntry],
      },
    });

    return NextResponse.json({
      data: updatedRisk,
      emailsSent,
      emailsFailed,
      subject: emailSubject,
    });
  }

  // ── Regular risk field update ────────────────────────────────────────────
  if (data.probability || data.impact) {
    const existing = await db.risk.findUnique({ where: { id: riskId } });
    if (existing) {
      data.score = (data.probability || existing.probability) * (data.impact || existing.impact);
    }
  }

  const risk = await db.risk.update({
    where: { id: riskId, projectId },
    data,
  });

  return NextResponse.json({ data: risk });
}
