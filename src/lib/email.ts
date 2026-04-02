import { Resend } from "resend";

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
}
