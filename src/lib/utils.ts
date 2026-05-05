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
  // Feature gates
  whisperAudio: boolean;       // Whisper audio transcription
  customBot: boolean;          // VPS Playwright meeting bot (STARTER+, 10 credits/hr)
  recallBot: boolean;          // Recall.ai live meeting bot (PROFESSIONAL+, 60 credits/hr)
  perplexityResearch: boolean; // Perplexity web research / PESTLE
  autonomousCycle: boolean;    // VPS background agent cycle
  emailInbox: boolean;         // agent email address + inbox
  apiAccess: boolean;          // REST API + API keys
  topUpsAllowed: boolean;      // can buy extra credits
}

export const PLAN_LIMITS: Record<string, PlanDefinition> = {
  FREE: {
    credits: 100,
    agents: 1, projects: 1, priceGbp: 0,
    whisperAudio: false, customBot: false, recallBot: false,
    perplexityResearch: false, autonomousCycle: false,
    emailInbox: false, apiAccess: false, topUpsAllowed: false,
  },
  STARTER: {
    credits: 2000,        // ~200 chats + 20 docs + some reports
    agents: 1, projects: 3, priceGbp: 29,
    whisperAudio: true,   // upload recordings
    customBot: true,      // 200 hrs of custom bot / month (10 credits/hr)
    recallBot: false,     // upsell lever — Recall is Professional+
    perplexityResearch: true,
    autonomousCycle: true, emailInbox: true,
    apiAccess: false, topUpsAllowed: true,
  },
  PROFESSIONAL: {
    credits: 6000,
    agents: 3, projects: 10, priceGbp: 79,
    whisperAudio: true,
    customBot: true,
    recallBot: true,      // ~8 hrs Recall/mo within budget
    perplexityResearch: true,
    autonomousCycle: true, emailInbox: true,
    apiAccess: true, topUpsAllowed: true,
  },
  BUSINESS: {
    credits: 20000,
    agents: 10, projects: 50, priceGbp: 199,
    whisperAudio: true, customBot: true, recallBot: true,
    perplexityResearch: true,
    autonomousCycle: true, emailInbox: true,
    apiAccess: true, topUpsAllowed: true,
  },
  ENTERPRISE: {
    credits: 999999,
    agents: 999, projects: 999, priceGbp: 0,
    whisperAudio: true, customBot: true, recallBot: true,
    perplexityResearch: true,
    autonomousCycle: true, emailInbox: true,
    apiAccess: true, topUpsAllowed: true,
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
    "whisperAudio" | "recallBot" | "perplexityResearch" |
    "autonomousCycle" | "emailInbox" | "apiAccess" | "topUpsAllowed"
  >,
): boolean {
  const def = PLAN_LIMITS[plan?.toUpperCase() ?? "FREE"];
  return def ? def[feature] : false;
}

export function planCreditsPerMonth(plan: string | null | undefined): number {
  return PLAN_LIMITS[plan?.toUpperCase() ?? "FREE"]?.credits ?? 100;
}

export function insufficientPlanResponse(feature: string) {
  const messages: Record<string, string> = {
    recallBot: "Live meeting bot requires Professional plan or above. Upgrade at /billing.",
    whisperAudio: "Audio transcription requires Starter plan or above. Upgrade at /billing.",
    perplexityResearch: "Web research requires Starter plan or above. Upgrade at /billing.",
    autonomousCycle: "Autonomous background agent requires Starter plan or above. Upgrade at /billing.",
    emailInbox: "Agent email inbox requires Starter plan or above. Upgrade at /billing.",
    apiAccess: "API access requires Professional plan or above. Upgrade at /billing.",
  };
  return {
    error: messages[feature] ?? `This feature requires a paid plan. Upgrade at /billing.`,
    code: "PLAN_INSUFFICIENT",
    upgradeUrl: "/billing",
  };
}
