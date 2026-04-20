/**
 * n8n Workflow Forwarding Utility
 *
 * Forwards event payloads to n8n webhook URLs for external orchestration.
 * URLs are resolved in order of priority:
 *   1. Integration DB record (type="n8n", config.workflows.{workflowType})
 *   2. Per-workflow env var (N8N_WEBHOOK_{TYPE})
 *
 * If neither is set, returns false — caller falls back to hardcoded logic.
 *
 * Callback: n8n workflows POST results to /api/webhooks/n8n-callback
 */

import { db } from "@/lib/db";

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

// In-memory cache for DB-sourced URLs (refreshed every 60s)
let _cachedConfig: { urls: Record<string, string>; apiKey?: string; callbackSecret?: string; fetchedAt: number } | null = null;
const CACHE_TTL = 60_000;

/**
 * Load n8n config from the Integration DB.
 * Looks for an integration with type="n8n" and reads config.workflows.
 */
async function getDbConfig(): Promise<{ urls: Record<string, string>; apiKey?: string; callbackSecret?: string }> {
  if (_cachedConfig && Date.now() - _cachedConfig.fetchedAt < CACHE_TTL) {
    return _cachedConfig;
  }

  try {
    // Find any n8n integration across all orgs (for server-side usage).
    // In multi-tenant, you'd scope this per orgId — but the forwarding
    // happens in server context where orgId is already known.
    const integration = await db.integration.findFirst({
      where: { type: "n8n", status: "connected" },
      select: { config: true },
    });

    const config = (integration?.config || {}) as any;
    const workflows = config.workflows || {};
    const urls: Record<string, string> = {};

    for (const [key, url] of Object.entries(workflows)) {
      if (typeof url === "string" && url.startsWith("http")) {
        urls[key] = url;
      }
    }

    _cachedConfig = {
      urls,
      apiKey: config.apiKey || undefined,
      callbackSecret: config.callbackSecret || undefined,
      fetchedAt: Date.now(),
    };

    return _cachedConfig;
  } catch {
    return { urls: {} };
  }
}

/**
 * Resolve the webhook URL for a workflow.
 * Priority: DB config → env var → null.
 */
async function resolveWebhookUrl(workflow: N8nWorkflow): Promise<string | null> {
  // 1. Check DB
  const dbConfig = await getDbConfig();
  if (dbConfig.urls[workflow]) return dbConfig.urls[workflow];

  // 2. Check env var
  const envKey = WORKFLOW_ENV_MAP[workflow];
  if (process.env[envKey]) return process.env[envKey]!;

  return null;
}

/**
 * Check if an n8n workflow is configured (DB or env var).
 */
export async function isN8nEnabled(workflow: N8nWorkflow): Promise<boolean> {
  const url = await resolveWebhookUrl(workflow);
  return !!url;
}

/**
 * Forward a payload to an n8n webhook.
 * Returns true if forwarded successfully, false if not configured or failed.
 */
export async function forwardToN8n(
  workflow: N8nWorkflow,
  payload: Record<string, any>,
  options?: { timeout?: number }
): Promise<boolean> {
  const url = await resolveWebhookUrl(workflow);
  if (!url) return false;

  const dbConfig = await getDbConfig();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Workflow-Type": workflow,
  };

  // Auth: DB apiKey → env N8N_API_KEY
  const apiKey = dbConfig.apiKey || process.env.N8N_API_KEY;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, {
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

/**
 * Clear the cached config (call after integration settings change).
 */
export function clearN8nCache() {
  _cachedConfig = null;
}
