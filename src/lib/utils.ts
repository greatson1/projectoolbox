import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * @deprecated Prefer formatMoney from @/lib/currency or useFormatMoney from
 * @/hooks/use-currency — those consult the org's configured currency. This
 * helper exists only as a fallback and now defaults to GBP/en-GB so any
 * future caller that forgets to pass a currency at least matches the schema
 * default (Organisation.currency = "GBP") rather than rendering "$".
 */
export function formatCurrency(amount: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
}

export function formatDate(date: Date | string, style: "short" | "long" = "short") {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-GB", style === "long"
    ? { day: "numeric", month: "long", year: "numeric" }
    : { day: "numeric", month: "short", year: "2-digit" });
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
}

// ─── Credit costs ─────────────────────────────────────────────────────────────
//
// 1 credit = £0.01 to you.  Costs are set at 3–5× the actual API cost.
//
// LLM (Claude Sonnet ~£0.003/msg → 1 credit = 3× margin)
// Whisper audio: £0.003/min actual → 1 credit/min = 3× margin
// Recall.ai bot: £0.40/hr actual → 60 credits/hr = 1.5× margin (still £0.20 profit/hr)
// Perplexity: £0.01/call actual → 5 credits = 5× margin
// Autonomous cycle: ~£0.05 worth of LLM → 20 credits = 4× margin

export const CREDIT_COSTS = {
  // ── Core LLM ──────────────────────────────────────────────────────────────
  SIMPLE_QUERY:              1,   // basic chat message
  COMPLEX_ANALYSIS:          5,   // multi-step reasoning, planning
  AUTONOMOUS_DECISION:       3,   // agent proposes an action
  DOCUMENT_GENERATION:       8,   // generate a PM artefact
  REPORT_GENERATION:        10,   // weekly/status report
  MONTE_CARLO:              15,   // risk simulation
  AGENT_DEPLOYMENT:         10,   // initial project setup + lifecycle init

  // ── External APIs (metered — cost reflects real provider pricing) ─────────
  WHISPER_PER_MINUTE:        1,   // £0.003/min actual → £0.01 charged → 3×
  RECALL_BOT_PER_HOUR:      60,   // £0.40/hr actual → £0.60 charged → 1.5×
  CUSTOM_BOT_PER_HOUR:      10,   // VPS Playwright bot: ~8 credits/hr Whisper + 2 overhead
  PERPLEXITY_RESEARCH:       5,   // £0.01/call actual → £0.05 charged → 5×
  KNOWLEDGE_INGEST:          2,   // Claude Haiku extraction per ingest job
  EMAIL_PROCESSING:          2,   // auto-process inbound email into KB
  MEETING_PROCESSING:        5,   // extract decisions/risks from transcript

  // ── Autonomous cycle ──────────────────────────────────────────────────────
  AUTONOMOUS_CYCLE:         20,   // full monitoring loop run (max per cycle)
} as const;

export type CreditCostKey = keyof typeof CREDIT_COSTS;

// ─── Plan definitions ──────────────────────────────────────────────────────────
//
// credits: monthly allowance granted on renewal
// agents / projects: hard caps
// features: which premium APIs are unlocked
//
// FREE is deliberately limited to core chat + KB — no external APIs.
// Users hit the credit wall naturally in 3–4 days of real use.

export interface PlanDefinition {
  credits: number;          // monthly credit grant
  agents: number;           // max agents
  projects: number;         // max projects
  priceGbp: number;         // monthly price in GBP (0 = free)
  /** Highest autonomy level the org can deploy an agent at. L1 = advisor,
   *  L2 = supervised, L3 = autonomous. autonomousCycle (background work)
   *  rides on L3 specifically. */
  maxAutonomyLevel: 1 | 2 | 3;
  /** Document export tier:
   *    "pdf-only"   — FREE; users can still preview HTML but export is PDF
   *    "standard"   — PDF + Word + Excel
   *    "all"        — adds PPT and any custom-branded formats added later
   */
  exportFormats: "pdf-only" | "standard" | "all";
  // ── Resource feature gates ─────────────────────────────────────────────
  whisperAudio: boolean;       // Whisper audio transcription
  customBot: boolean;          // VPS Playwright meeting bot (STARTER+, 10 credits/hr)
  recallBot: boolean;          // Recall.ai live meeting bot (PROFESSIONAL+, 60 credits/hr)
  perplexityResearch: boolean; // Perplexity web research / PESTLE
  autonomousCycle: boolean;    // VPS background agent cycle
  emailInbox: boolean;         // agent email address + inbox
  apiAccess: boolean;          // REST API + API keys
  webhooks: boolean;           // outbound webhooks (PROFESSIONAL+)
  topUpsAllowed: boolean;      // can buy extra credits
  // ── Enterprise governance gates (BUSINESS+) ────────────────────────────
  ssoSaml: boolean;            // SAML / SSO via WorkOS
  auditLog: boolean;           // immutable per-org audit trail
  orgMfaEnforce: boolean;      // org-wide MFA enforcement (Org.requireMfa)
  ipAllowlist: boolean;        // restrict access by IP range
  dedicatedCsm: boolean;       // dedicated CSM + SLA
  // ── Enterprise-only ────────────────────────────────────────────────────
  whiteLabel: boolean;         // custom branding, custom domain
  customIntegrations: boolean; // bespoke integration work included
}

/**
 * Single source of truth for the SaaS plan partition.
 *
 * Tier shape:
 *   - FREE        — trial-only floor. 14-day paywall trial sits ON FREE,
 *                   then middleware blocks the dashboard until upgrade.
 *   - STARTER     — solo PM running 1-2 projects.
 *   - PROFESSIONAL — small PMO, multi-project, API access, Recall.ai.
 *   - BUSINESS    — programme / enterprise governance (SSO, audit log,
 *                   IP allowlist, org-wide MFA).
 *   - ENTERPRISE  — unlimited resources, bespoke contract, white-label.
 *
 * Principles:
 *   - 1 agent = 1 active project, so `projects === agents` on every tier.
 *   - PM-hygiene features (DoD/DoR enforcement, contradiction detector,
 *     cross-artefact reconciliation, phase gates, multi-methodology) are
 *     NOT plan-gated — they're fundamental to the product.
 *   - Resource consumption (credits, agents, projects, autonomy) scales
 *     by tier.
 *   - Enterprise governance (SSO, audit log, IP allowlist) is BUSINESS+.
 *   - White-label + bespoke integrations are ENTERPRISE-only.
 *
 * Drift guard: PLAN_CREDIT_GRANTS in src/lib/stripe.ts and ALL plan UI
 * surfaces (home page, billing page, PaywallScreen) MUST derive from
 * this object. If you change a number here, run grep for the old number
 * and update copy.
 */
export const PLAN_LIMITS: Record<string, PlanDefinition> = {
  FREE: {
    credits: 50,
    agents: 1, projects: 1, priceGbp: 0,
    maxAutonomyLevel: 1,
    exportFormats: "pdf-only",
    whisperAudio: false, customBot: false, recallBot: false,
    perplexityResearch: false, autonomousCycle: false,
    emailInbox: false, apiAccess: false, webhooks: false,
    topUpsAllowed: false,
    ssoSaml: false, auditLog: false, orgMfaEnforce: false,
    ipAllowlist: false, dedicatedCsm: false,
    whiteLabel: false, customIntegrations: false,
  },
  STARTER: {
    credits: 500,
    agents: 2, projects: 2, priceGbp: 29,
    maxAutonomyLevel: 2,
    exportFormats: "standard",  // PDF + Word + Excel
    whisperAudio: true,        // upload recordings
    customBot: true,           // ~50 hrs Playwright bot (10 credits/hr)
    recallBot: false,          // upsell lever — Recall is PROFESSIONAL+
    perplexityResearch: true,
    autonomousCycle: true, emailInbox: true,
    apiAccess: false, webhooks: false,
    topUpsAllowed: true,
    ssoSaml: false, auditLog: false, orgMfaEnforce: false,
    ipAllowlist: false, dedicatedCsm: false,
    whiteLabel: false, customIntegrations: false,
  },
  PROFESSIONAL: {
    credits: 2000,
    agents: 5, projects: 5, priceGbp: 79,
    maxAutonomyLevel: 3,       // unlocks autonomous cycle for L3 deployments
    exportFormats: "all",      // PDF + Word + Excel + PPT
    whisperAudio: true,
    customBot: true,
    recallBot: true,           // ~30 hrs Recall.ai / mo (60 credits/hr)
    perplexityResearch: true,
    autonomousCycle: true, emailInbox: true,
    apiAccess: true,           // REST API + API keys
    webhooks: true,
    topUpsAllowed: true,
    ssoSaml: false, auditLog: false, orgMfaEnforce: false,
    ipAllowlist: false, dedicatedCsm: false,
    whiteLabel: false, customIntegrations: false,
  },
  BUSINESS: {
    credits: 10000,
    agents: 15, projects: 15, priceGbp: 199,
    maxAutonomyLevel: 3,
    exportFormats: "all",
    whisperAudio: true, customBot: true, recallBot: true,
    perplexityResearch: true,
    autonomousCycle: true, emailInbox: true,
    apiAccess: true, webhooks: true,
    topUpsAllowed: true,
    // Enterprise governance — the upgrade reason at this tier.
    ssoSaml: true, auditLog: true, orgMfaEnforce: true,
    ipAllowlist: true, dedicatedCsm: true,
    whiteLabel: false, customIntegrations: false,
  },
  ENTERPRISE: {
    credits: 50000,
    agents: 999, projects: 999, priceGbp: 0, // bespoke
    maxAutonomyLevel: 3,
    exportFormats: "all",
    whisperAudio: true, customBot: true, recallBot: true,
    perplexityResearch: true,
    autonomousCycle: true, emailInbox: true,
    apiAccess: true, webhooks: true,
    topUpsAllowed: true,
    ssoSaml: true, auditLog: true, orgMfaEnforce: true,
    ipAllowlist: true, dedicatedCsm: true,
    whiteLabel: true, customIntegrations: true,
  },
};

// ─── Feature gate helper ───────────────────────────────────────────────────────
//
// Usage in API routes:
//   const plan = await getOrgPlan(orgId);
//   if (!canUseFeature(plan, "recallBot")) return insufficientPlan("recallBot");

export function canUseFeature(
  plan: string | null | undefined,
  feature: keyof Pick<PlanDefinition,
    "whisperAudio" | "customBot" | "recallBot" | "perplexityResearch" |
    "autonomousCycle" | "emailInbox" | "apiAccess" | "webhooks" |
    "topUpsAllowed" | "ssoSaml" | "auditLog" | "orgMfaEnforce" |
    "ipAllowlist" | "dedicatedCsm" | "whiteLabel" | "customIntegrations"
  >,
): boolean {
  const def = PLAN_LIMITS[plan?.toUpperCase() ?? "FREE"];
  return def ? def[feature] : false;
}

export function planCreditsPerMonth(plan: string | null | undefined): number {
  return PLAN_LIMITS[plan?.toUpperCase() ?? "FREE"]?.credits ?? PLAN_LIMITS.FREE.credits;
}

export function insufficientPlanResponse(feature: string) {
  const messages: Record<string, string> = {
    recallBot: "Live meeting bot requires Professional plan or above. Upgrade at /billing.",
    whisperAudio: "Audio transcription requires Starter plan or above. Upgrade at /billing.",
    perplexityResearch: "Web research requires Starter plan or above. Upgrade at /billing.",
    autonomousCycle: "Autonomous background agent requires Starter plan or above. Upgrade at /billing.",
    emailInbox: "Agent email inbox requires Starter plan or above. Upgrade at /billing.",
    apiAccess: "API access requires Professional plan or above. Upgrade at /billing.",
    webhooks: "Outbound webhooks require Professional plan or above. Upgrade at /billing.",
    ssoSaml: "SSO / SAML requires Business plan or above. Upgrade at /billing.",
    auditLog: "Audit log access requires Business plan or above. Upgrade at /billing.",
    orgMfaEnforce: "Org-wide MFA enforcement requires Business plan or above. Upgrade at /billing.",
    ipAllowlist: "IP allowlisting requires Business plan or above. Upgrade at /billing.",
    customIntegrations: "Custom integrations require an Enterprise contract. Contact us.",
    whiteLabel: "White-label branding requires an Enterprise contract. Contact us.",
  };
  return {
    error: messages[feature] ?? `This feature requires a paid plan. Upgrade at /billing.`,
    code: "PLAN_INSUFFICIENT",
    upgradeUrl: "/billing",
  };
}
