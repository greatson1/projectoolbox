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

  // Reverse sync: update Risk Register artefact to reflect new risk
  import("@/lib/agents/artefact-sync").then(({ syncRisksToArtefact }) =>
    syncRisksToArtefact(projectId).catch(() => {})
  ).catch(() => {});

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
      select: { name: true, orgId: true, budget: true },
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
    // Default fallback email body (used when Claude API fails)
    let emailBody = `**Risk Escalation: ${existing.title}**

This risk has been escalated for your immediate attention on project "${project?.name ?? "Project"}".

**Risk Source:** ${existing.description || "No description provided"}

**Risk Event & Impact:** With a probability of ${existing.probability}/5 and impact of ${existing.impact}/5 (score: ${existing.score ?? existing.probability * existing.impact}/25), this risk requires a decision on the appropriate response strategy.

**Current Mitigation:** ${existing.mitigation || "No mitigation actions documented yet."}

${customMessage ? `**Additional Context from Project Manager:**\n${customMessage}\n` : ""}

**Decision Required:** Please review this risk and select a response strategy (Accept, Mitigate, Transfer, or Avoid). Click the button below to respond — no account required.

${agentName}
${project?.name ?? "Project"} — AI Project Manager`;

    if (apiKey) {
      try {
        const prompt = `You are ${agentName}, an AI project manager for "${project?.name ?? "this project"}".

Write a professional, comprehensive risk escalation email for a senior stakeholder. British English.

RISK DETAILS:
- Title: ${existing.title}
- Description: ${existing.description || "No description provided"}
- Probability: ${existing.probability}/5 | Impact: ${existing.impact}/5 | Score: ${existing.score ?? existing.probability * existing.impact}/25
- Category: ${existing.category || "Not categorised"}
- Current Status: ${existing.status}
- Risk Owner: ${existing.owner || "Unassigned"}
- Existing Mitigation: ${existing.mitigation || "None documented"}
- Project Budget: £${(project?.budget || 0).toLocaleString()}
- Project Phase: ${deployment?.currentPhase || "Unknown"}

RESPONSE ACTIONS (${actionEntries.length}):
${actionEntries.length > 0
  ? actionEntries.map((a: any) => `- [${a.status}] ${a.action}${a.owner ? ` (Owner: ${a.owner})` : ""}`).join("\n")
  : "No response actions recorded yet."}

${customMessage ? `ADDITIONAL CONTEXT FROM PROJECT MANAGER:\n${customMessage}\n` : ""}

Write the email with these EXACT sections:

1. **Subject line** — starts with "ESCALATION:" and names the risk and project
2. **Opening** — 1 sentence: what risk, what project, why escalated now
3. **Risk Source** — what is causing this risk (root cause analysis)
4. **Risk Event & Impact** — what will happen if this risk materialises, quantified impact on schedule/cost/scope
5. **Current Response** — what mitigations are in place, their status
6. **Recommended Approaches** — 2-3 specific, actionable options the stakeholder can choose from (e.g., Accept, Mitigate with specific action, Transfer/insure, Avoid by changing scope). Include estimated cost/time for each.
7. **Decision Required** — what exactly do you need the recipient to decide, by when
8. **Sign-off** — agent name, project name

Format:
SUBJECT: [subject]
BODY:
[full email body with the sections above, using **bold** for section headers]`;

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
        // Fall back to structured template email
        const score = existing.score ?? existing.probability * existing.impact;
        const severity = score >= 20 ? "Critical" : score >= 15 ? "High" : score >= 10 ? "Medium" : "Low";
        emailBody = `Dear ${existing.owner || "Stakeholder"},

I am writing to formally escalate the following risk on project "${project?.name ?? ""}":

**Risk:** ${existing.title}
**Score:** ${score}/25 (Probability: ${existing.probability}/5, Impact: ${existing.impact}/5) — ${severity} severity
**Category:** ${existing.category || "General"}
**Description:** ${existing.description || "No detailed description available."}

**Risk Source:**
This risk has been identified through ongoing project monitoring. ${customMessage ? `Additional context: ${customMessage}` : ""}

**Impact if Materialised:**
With a ${severity.toLowerCase()} severity rating, this risk could significantly affect project ${existing.impact >= 4 ? "timeline, budget, and deliverables" : existing.impact >= 3 ? "timeline and deliverables" : "progress"}.

**Current Response:**
${actionEntries.length > 0
  ? actionEntries.map((a: any) => `- ${a.action} [${a.status}]${a.owner ? ` — Owner: ${a.owner}` : ""}`).join("\n")
  : "No response actions have been recorded yet. This requires immediate attention."}

**Recommended Approaches:**
1. **Mitigate** — ${existing.mitigation || "Define and implement specific mitigation actions to reduce probability or impact"}
2. **Accept** — Acknowledge the risk and monitor, setting clear trigger points for escalation
3. **Transfer** — Consider insurance, contractual protections, or transferring the risk to a third party

**Decision Required:**
Please review the risk register and confirm which response strategy to adopt. A decision is needed within 48 hours to prevent further project impact.

${agentName}
${project?.name ?? "Project"} — AI Project Manager`;
      }
    }

    // ── Send emails via Resend ────────────────────────────────────────────
    const resendKey = process.env.RESEND_API_KEY || process.env.RESEND_API_KEY_PROJECTOOLBOX;
    const emailsSent: string[] = [];
    const emailsFailed: string[] = [];

    if (resendKey && recipients?.length > 0) {
      // Generate magic review tokens for each recipient (no account needed)
      const { randomBytes } = await import("crypto");
      const reviewTokens: Record<string, string> = {};
      for (const email of recipients) {
        const token = randomBytes(32).toString("hex");
        reviewTokens[email] = token;
        // Create a risk-specific approval and ReviewLink for this escalation
        try {
          const riskApproval = await db.approval.create({
            data: {
              projectId,
              requestedById: deployment?.agent?.name || "system",
              type: "RISK_RESPONSE",
              title: `Risk Escalation: ${existing.title}`,
              description: emailBody.slice(0, 500),
              status: "PENDING",
              urgency: (existing.score ?? 0) >= 15 ? "CRITICAL" : (existing.score ?? 0) >= 10 ? "HIGH" : "MEDIUM",
              impact: { riskId: existing.id, riskTitle: existing.title, riskScore: existing.score } as any,
              impactScores: { schedule: 1, cost: Math.min(4, Math.ceil((existing.impact || 3) * 0.8)), scope: 1, stakeholder: Math.min(4, existing.impact || 3) } as any,
            },
          });
          const approval = riskApproval;
          if (approval) {
            await db.reviewLink.create({
              data: {
                token,
                approvalId: approval.id,
                email,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
              },
            }).catch(() => {});
          }
        } catch {}
      }
      const baseUrl = process.env.NEXTAUTH_URL || "https://projectoolbox.com";

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
            <div style="font-size:14px;color:#374151;line-height:1.7;">${emailBody
              .replace(/</g, "&lt;").replace(/>/g, "&gt;")
              .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
              .replace(/^- (.+)/gm, "<li style='margin:2px 0;'>$1</li>")
              .replace(/^(\d+)\. (.+)/gm, "<li style='margin:2px 0;'>$2</li>")
              .replace(/\n{2,}/g, "</p><p style='margin:12px 0;'>")
              .replace(/\n/g, "<br>")
            }</div>
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
            <a href="${baseUrl}/review/REVIEW_TOKEN_PLACEHOLDER"
              style="display:inline-block;margin-top:20px;background:#dc2626;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
              Review & Respond →
            </a>
            <p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:12px;">
              Sent by ${agentName} via Projectoolbox · <a href="${baseUrl}/review/REVIEW_TOKEN_PLACEHOLDER" style="color:#4f46e5;">View risk details</a> · No account required · Expires in 7 days
            </p>
          </div>
        </div>`;

      for (const email of recipients) {
        try {
          // Replace token placeholder with this recipient's magic link token
          const recipientHtml = html.replace("REVIEW_TOKEN_PLACEHOLDER", reviewTokens[email] || "");
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
              html: recipientHtml,
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

  // Track significant risk changes in KB
  if (data.status || data.probability || data.impact) {
    import("@/lib/agents/kb-event-tracker").then(({ trackRiskChange }) => {
      const changes: string[] = [];
      if (data.status) changes.push(`status → ${data.status}`);
      if (data.score) changes.push(`score → ${data.score}`);
      trackRiskChange(projectId, risk.title, changes.join(", ")).catch(() => {});
    }).catch(() => {});
  }

  // Reverse sync: update Risk Register artefact CSV
  import("@/lib/agents/artefact-sync").then(({ syncRisksToArtefact }) =>
    syncRisksToArtefact(projectId).catch(() => {})
  ).catch(() => {});

  return NextResponse.json({ data: risk });
}
