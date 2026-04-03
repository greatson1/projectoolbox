import { Resend } from "resend";
import { db } from "@/lib/db";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export class EmailService {
  static async sendApprovalAlert(to: string, data: {
    agentName: string; projectName: string; title: string; description: string; approvalUrl: string;
  }) {
    try {
      await getResend().emails.send({
        from: "Projectoolbox <noreply@projectoolbox.com>",
        to,
        subject: `[Action Required] ${data.agentName} needs your approval — ${data.title}`,
        html: `
          <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #6366F1, #8B5CF6); padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 20px;">Approval Required</h1>
            </div>
            <div style="padding: 24px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: 0; border-radius: 0 0 12px 12px;">
              <p style="color: #64748B; font-size: 14px;">Agent <strong style="color: #6366F1;">${data.agentName}</strong> on <strong>${data.projectName}</strong> needs your approval:</p>
              <div style="background: white; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <h2 style="margin: 0 0 8px; font-size: 16px; color: #0F172A;">${data.title}</h2>
                <p style="margin: 0; color: #64748B; font-size: 14px;">${data.description}</p>
              </div>
              <a href="${data.approvalUrl}" style="display: inline-block; background: #6366F1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Review & Approve</a>
              <p style="margin-top: 24px; color: #94A3B8; font-size: 12px;">This email was sent by Projectoolbox. <a href="${data.approvalUrl}" style="color: #6366F1;">View in dashboard</a></p>
            </div>
          </div>
        `,
      });
      return true;
    } catch (e: any) {
      console.error("Email send failed:", e.message);
      return false;
    }
  }

  static async sendDeployConfirmation(to: string, data: {
    agentName: string; projectName: string; autonomyLevel: number; dashboardUrl: string;
  }) {
    try {
      await getResend().emails.send({
        from: "Projectoolbox <noreply@projectoolbox.com>",
        to,
        subject: `Agent ${data.agentName} deployed to ${data.projectName}`,
        html: `
          <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #6366F1, #8B5CF6); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
              <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(255,255,255,0.2); margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;">
                <span style="color: white; font-size: 28px; font-weight: bold;">${data.agentName[0]}</span>
              </div>
              <h1 style="color: white; margin: 0; font-size: 20px;">Agent ${data.agentName} is Live! 🎉</h1>
            </div>
            <div style="padding: 24px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: 0; border-radius: 0 0 12px 12px;">
              <p style="color: #0F172A; font-size: 14px;">Your AI Project Manager has been deployed:</p>
              <ul style="color: #64748B; font-size: 14px;">
                <li><strong>Agent:</strong> ${data.agentName}</li>
                <li><strong>Project:</strong> ${data.projectName}</li>
                <li><strong>Autonomy Level:</strong> L${data.autonomyLevel}</li>
              </ul>
              <a href="${data.dashboardUrl}" style="display: inline-block; background: #6366F1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Go to Dashboard</a>
            </div>
          </div>
        `,
      });
      return true;
    } catch (e: any) {
      console.error("Email send failed:", e.message);
      return false;
    }
  }

  static async sendCreditWarning(to: string, data: {
    balance: number; burnRate: number; depletionDays: number; topUpUrl: string;
  }) {
    try {
      await getResend().emails.send({
        from: "Projectoolbox <noreply@projectoolbox.com>",
        to,
        subject: `⚠️ Credit balance low — ${data.balance} credits remaining`,
        html: `
          <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #F59E0B; padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 20px;">⚠️ Credit Balance Warning</h1>
            </div>
            <div style="padding: 24px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: 0; border-radius: 0 0 12px 12px;">
              <p style="color: #0F172A; font-size: 14px;">Your credit balance is running low:</p>
              <div style="background: white; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="font-size: 32px; font-weight: bold; color: #F59E0B; margin: 0;">${data.balance} credits</p>
                <p style="color: #64748B; font-size: 14px; margin: 8px 0 0;">At ~${data.burnRate}/day, this will last approximately ${data.depletionDays} days.</p>
              </div>
              <a href="${data.topUpUrl}" style="display: inline-block; background: #6366F1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Top Up Credits</a>
            </div>
          </div>
        `,
      });
      return true;
    } catch (e: any) {
      console.error("Email send failed:", e.message);
      return false;
    }
  }

  /**
   * Send an email FROM an agent's email address.
   * Used for: meeting follow-ups, status updates, stakeholder comms.
   */
  static async sendAgentEmail(agentId: string, data: {
    to: string | string[];
    subject: string;
    html: string;
    replyTo?: string;
    cc?: string[];
  }) {
    try {
      // Look up agent email address
      const agentEmail = await db.agentEmail.findUnique({
        where: { agentId },
        include: { agent: { select: { name: true } } },
      });

      if (!agentEmail || !agentEmail.isActive) {
        throw new Error("Agent has no active email address");
      }

      const fromAddress = `${agentEmail.agent.name} (AI Agent) <${agentEmail.address}>`;

      await getResend().emails.send({
        from: fromAddress,
        to: Array.isArray(data.to) ? data.to : [data.to],
        subject: data.subject,
        html: `
          <div style="font-family: Inter, sans-serif; max-width: 650px; margin: 0 auto;">
            ${data.html}
            <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 24px 0 16px;" />
            <p style="color: #94A3B8; font-size: 11px; line-height: 1.5;">
              This email was sent by <strong>${agentEmail.agent.name}</strong>, an AI Project Manager powered by
              <a href="https://projectoolbox.com" style="color: #6366F1;">Projectoolbox</a>.
              Reply to this email and it will be processed by the agent.
            </p>
          </div>
        `,
        replyTo: agentEmail.address,
        ...(data.cc && { cc: data.cc }),
      });

      // Log activity
      await db.agentActivity.create({
        data: {
          agentId,
          type: "document",
          summary: `Sent email: "${data.subject}" to ${Array.isArray(data.to) ? data.to.join(", ") : data.to}`,
          metadata: { type: "email_sent", to: data.to, subject: data.subject },
        },
      });

      return true;
    } catch (e: any) {
      console.error("Agent email send failed:", e.message);
      return false;
    }
  }

  /**
   * Send a meeting follow-up from the agent after processing a transcript.
   */
  static async sendMeetingFollowUp(agentId: string, data: {
    meetingTitle: string;
    recipients: string[];
    summary: string;
    actionItems: { text: string; assignee?: string; deadline?: string }[];
    decisions: { text: string; by: string }[];
    projectUrl?: string;
  }) {
    const actionHtml = data.actionItems.length > 0
      ? `<h3 style="color: #0F172A; font-size: 15px; margin: 20px 0 8px;">Action Items</h3>
         <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
           <thead><tr style="background: #F8FAFC; border-bottom: 1px solid #E2E8F0;">
             <th style="padding: 8px 12px; text-align: left;">Action</th>
             <th style="padding: 8px 12px; text-align: left;">Owner</th>
             <th style="padding: 8px 12px; text-align: left;">Deadline</th>
           </tr></thead>
           <tbody>${data.actionItems.map(a => `
             <tr style="border-bottom: 1px solid #F1F5F9;">
               <td style="padding: 8px 12px;">${a.text}</td>
               <td style="padding: 8px 12px; color: #6366F1; font-weight: 600;">${a.assignee || "—"}</td>
               <td style="padding: 8px 12px;">${a.deadline || "—"}</td>
             </tr>`).join("")}
           </tbody>
         </table>` : "";

    const decisionsHtml = data.decisions.length > 0
      ? `<h3 style="color: #0F172A; font-size: 15px; margin: 20px 0 8px;">Decisions Made</h3>
         <ul style="margin: 0; padding-left: 20px;">
           ${data.decisions.map(d => `<li style="margin-bottom: 6px; font-size: 13px;"><strong>${d.text}</strong> — ${d.by}</li>`).join("")}
         </ul>` : "";

    return this.sendAgentEmail(agentId, {
      to: data.recipients,
      subject: `Meeting Summary: ${data.meetingTitle}`,
      html: `
        <div style="background: linear-gradient(135deg, #6366F1, #8B5CF6); padding: 20px 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 18px;">Meeting Summary</h1>
          <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0; font-size: 13px;">${data.meetingTitle}</p>
        </div>
        <div style="padding: 24px; background: #FFFFFF; border: 1px solid #E2E8F0; border-top: 0; border-radius: 0 0 12px 12px;">
          <h3 style="color: #0F172A; font-size: 15px; margin: 0 0 8px;">Summary</h3>
          <p style="color: #475569; font-size: 13px; line-height: 1.6;">${data.summary}</p>
          ${actionHtml}
          ${decisionsHtml}
          ${data.projectUrl ? `<a href="${data.projectUrl}" style="display: inline-block; margin-top: 20px; background: #6366F1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px;">View in Projectoolbox</a>` : ""}
        </div>
      `,
    });
  }
}
