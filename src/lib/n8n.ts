/**
 * n8n Workflow Forwarding Utility
 *
 * Forwards event payloads to n8n webhook URLs for external orchestration.
 * Each workflow type has its own env var for the webhook URL.
 * If the env var is not set, the function returns false and the caller
 * should fall back to hardcoded logic.
 *
 * Env vars:
 *   N8N_WEBHOOK_INBOUND_EMAIL    — inbound email routing workflow
 *   N8N_WEBHOOK_APPROVAL_ESCALATION — approval timeout/escalation workflow
 *   N8N_WEBHOOK_MEETING_TRANSCRIPT — meeting transcript processing workflow
 *   N8N_WEBHOOK_FEASIBILITY_RESEARCH — feasibility research pipeline
 *   N8N_WEBHOOK_STRIPE_EVENT     — Stripe payment event routing
 *   N8N_WEBHOOK_REPORT_SCHEDULE  — scheduled report generation
 *   N8N_API_KEY                  — optional auth header for all n8n calls
 *
 * Callback: n8n workflows can POST results back to
 *   POST /api/webhooks/n8n-callback
 *   with { workflowType, resultData, orgId?, agentId? }
 */

export type N8nWorkflow =
  | "inbound_email"
  | "approval_escalation"
  | "meeting_transcript"
  | "feasibility_research"
  | "stripe_event"
  | "report_schedule";

const WORKFLOW_ENV_MAP: Record<N8nWorkflow, string> = {
  inbound_email: "N8N_WEBHOOK_INBOUND_EMAIL",
  approval_escalation: "N8N_WEBHOOK_APPROVAL_ESCALATION",
  meeting_transcript: "N8N_WEBHOOK_MEETING_TRANSCRIPT",
  feasibility_research: "N8N_WEBHOOK_FEASIBILITY_RESEARCH",
  stripe_event: "N8N_WEBHOOK_STRIPE_EVENT",
  report_schedule: "N8N_WEBHOOK_REPORT_SCHEDULE",
};

/**
 * Check if an n8n workflow is configured for this type.
 */
export function isN8nEnabled(workflow: N8nWorkflow): boolean {
  const envKey = WORKFLOW_ENV_MAP[workflow];
  return !!process.env[envKey];
}

/**
 * Forward a payload to an n8n webhook.
 * Returns true if forwarded successfully, false if not configured or failed.
 *
 * On failure, logs the error but does NOT throw — caller should fall back
 * to hardcoded logic.
 */
export async function forwardToN8n(
  workflow: N8nWorkflow,
  payload: Record<string, any>,
  options?: { timeout?: number }
): Promise<boolean> {
  const envKey = WORKFLOW_ENV_MAP[workflow];
  const webhookUrl = process.env[envKey];

  if (!webhookUrl) return false;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Workflow-Type": workflow,
  };

  const apiKey = process.env.N8N_API_KEY;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workflowType: workflow,
        timestamp: new Date().toISOString(),
        ...payload,
      }),
      signal: AbortSignal.timeout(options?.timeout || 10_000),
    });

    if (!res.ok) {
      console.error(`[n8n] ${workflow} webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
      return false;
    }

    return true;
  } catch (err: any) {
    console.error(`[n8n] ${workflow} webhook error: ${err.message}`);
    return false;
  }
}
