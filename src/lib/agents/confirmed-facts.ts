/**
 * Confirmed Facts — system-of-record for cross-artefact consistency.
 *
 * Returns the "load-bearing" structured facts about a project that EVERY
 * downstream artefact must respect. Sourced (in priority order) from:
 *   1. The Project row (canonical: budget, currency, startDate, endDate)
 *   2. The Stakeholder table (sponsor + project manager + key stakeholders)
 *   3. KnowledgeBaseItem rows tagged "user_confirmed" (HIGH_TRUST)
 *   4. Approved Charter / Business Case prose (extracted via Haiku JSON)
 *
 * Used by:
 *   - getProjectKnowledgeContext() — injected as a top-priority block in
 *     every artefact-generation prompt as "CONFIRMED FACTS — DO NOT
 *     CONTRADICT" so Claude never silently overwrites a budget figure
 *     established in the Charter when generating the Cost Plan.
 *   - The contradiction-detector pass — checks the draft against this
 *     same shape so any divergence is flagged before save.
 *
 * Cached per-call rather than per-request because the function is cheap
 * (one Project read + one Stakeholder read + one KB read + maybe one
 * Haiku call when a Charter exists with no extracted-facts metadata yet).
 */

import { db } from "@/lib/db";

export interface ConfirmedFacts {
  budget: number | null;
  currency: string | null;
  startDate: string | null; // ISO yyyy-mm-dd
  endDate: string | null;
  sponsor: string | null;
  projectManager: string | null;
  scope: string | null;       // free-text; one paragraph max
  methodology: string | null;
  primaryStakeholders: Array<{ name: string; role: string }>;
  /** Provenance: which sources contributed which fact, for the prompt block. */
  sources: Record<string, "project_row" | "org_row" | "stakeholder_table" | "kb_user_confirmed" | "charter_extract">;
}

const EMPTY: ConfirmedFacts = {
  budget: null,
  currency: null,
  startDate: null,
  endDate: null,
  sponsor: null,
  projectManager: null,
  scope: null,
  methodology: null,
  primaryStakeholders: [],
  sources: {},
};

export async function getConfirmedFacts(projectId: string): Promise<ConfirmedFacts> {
  const facts: ConfirmedFacts = { ...EMPTY, sources: {} };

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      name: true, budget: true, startDate: true, endDate: true, methodology: true, description: true,
      org: { select: { currency: true } },
    },
  });
  if (!project) return facts;

  // 1. Project row — canonical baseline. Anything explicitly stored here
  // wins over text extraction.
  if (project.budget != null && project.budget > 0) {
    facts.budget = project.budget;
    facts.sources.budget = "project_row";
  }
  // Currency lives on the Organisation (the project inherits its org's
  // currency for display + Stripe). Fold it in here so prompts can render
  // "£12,000" / "$12,000" without a separate org lookup.
  if (project.org?.currency) {
    facts.currency = project.org.currency;
    facts.sources.currency = "org_row";
  }
  if (project.startDate) {
    facts.startDate = project.startDate.toISOString().slice(0, 10);
    facts.sources.startDate = "project_row";
  }
  if (project.endDate) {
    facts.endDate = project.endDate.toISOString().slice(0, 10);
    facts.sources.endDate = "project_row";
  }
  if (project.methodology) {
    facts.methodology = project.methodology;
    facts.sources.methodology = "project_row";
  }

  // 2. Stakeholder table — preferred over KB for owner-style fields
  // because it's structured (role enum) not free text.
  const stakeholders = await db.stakeholder.findMany({
    where: { projectId },
    select: { name: true, role: true, power: true, interest: true },
    orderBy: [{ power: "desc" }, { interest: "desc" }],
    take: 20,
  }).catch(() => []);
  for (const s of stakeholders) {
    const role = (s.role || "").toLowerCase();
    if (!facts.sponsor && (role.includes("sponsor") || role.includes("executive"))) {
      facts.sponsor = s.name;
      facts.sources.sponsor = "stakeholder_table";
    }
    if (!facts.projectManager && (role.includes("project manager") || role.includes("pm") || role === "project lead")) {
      facts.projectManager = s.name;
      facts.sources.projectManager = "stakeholder_table";
    }
  }
  facts.primaryStakeholders = stakeholders.slice(0, 5).map(s => ({ name: s.name, role: s.role || "" }));

  // 3. KB user_confirmed items — fill any remaining gaps. Title-keyed.
  const userConfirmed = await db.knowledgeBaseItem.findMany({
    where: {
      projectId,
      trustLevel: "HIGH_TRUST",
      tags: { has: "user_confirmed" },
    },
    select: { title: true, content: true },
    take: 50,
  }).catch(() => []);
  for (const it of userConfirmed) {
    const t = it.title.toLowerCase();
    const c = it.content.replace(/^\[User confirmed[^\]]+\]\s*/i, "").trim();
    if (!facts.budget && (t.includes("budget") || t.includes("cost"))) {
      const num = parseFloat(c.replace(/[£$,]/g, "").match(/[\d.]+/)?.[0] || "");
      if (Number.isFinite(num) && num > 0) {
        facts.budget = num;
        facts.sources.budget = "kb_user_confirmed";
      }
    }
    if (!facts.sponsor && t.includes("sponsor")) {
      facts.sponsor = c.slice(0, 80);
      facts.sources.sponsor = "kb_user_confirmed";
    }
    if (!facts.projectManager && (t.includes("project manager") || t === "pm")) {
      facts.projectManager = c.slice(0, 80);
      facts.sources.projectManager = "kb_user_confirmed";
    }
    if (!facts.scope && (t.includes("scope") || t.includes("objectives"))) {
      facts.scope = c.slice(0, 280);
      facts.sources.scope = "kb_user_confirmed";
    }
  }

  // 4. Charter / Business Case extract — last resort for anything still
  // null. Uses cached extract from the artefact metadata when available
  // (written by extract-artefact-facts on Charter approval) to avoid
  // re-running Haiku on every prompt build.
  const charter = await db.agentArtefact.findFirst({
    where: {
      projectId,
      status: "APPROVED",
      OR: [{ name: { contains: "Charter", mode: "insensitive" } }, { name: { contains: "Business Case", mode: "insensitive" } }],
    },
    orderBy: { updatedAt: "desc" },
    select: { name: true, metadata: true },
  }).catch(() => null);
  const charterFacts = (charter?.metadata as any)?.extractedFacts as Partial<ConfirmedFacts> | undefined;
  if (charterFacts) {
    if (!facts.budget && typeof charterFacts.budget === "number" && charterFacts.budget > 0) {
      facts.budget = charterFacts.budget;
      facts.sources.budget = "charter_extract";
    }
    if (!facts.startDate && charterFacts.startDate) {
      facts.startDate = charterFacts.startDate;
      facts.sources.startDate = "charter_extract";
    }
    if (!facts.endDate && charterFacts.endDate) {
      facts.endDate = charterFacts.endDate;
      facts.sources.endDate = "charter_extract";
    }
    if (!facts.sponsor && charterFacts.sponsor) {
      facts.sponsor = charterFacts.sponsor;
      facts.sources.sponsor = "charter_extract";
    }
    if (!facts.scope && charterFacts.scope) {
      facts.scope = charterFacts.scope;
      facts.sources.scope = "charter_extract";
    }
  }

  return facts;
}

/**
 * Format the confirmed facts as a prompt block. Every field that has a
 * value is rendered with its provenance so Claude can see which facts
 * are immutable system-of-record vs which are inferred from prose.
 */
export function formatConfirmedFactsBlock(facts: ConfirmedFacts): string {
  const rows: string[] = [];
  const symbol = facts.currency === "USD" ? "$" : facts.currency === "EUR" ? "€" : "£";

  if (facts.budget != null) rows.push(`- **Budget**: ${symbol}${facts.budget.toLocaleString()} _(source: ${facts.sources.budget})_`);
  if (facts.startDate) rows.push(`- **Start date**: ${facts.startDate} _(source: ${facts.sources.startDate})_`);
  if (facts.endDate) rows.push(`- **End date**: ${facts.endDate} _(source: ${facts.sources.endDate})_`);
  if (facts.methodology) rows.push(`- **Methodology**: ${facts.methodology} _(source: ${facts.sources.methodology})_`);
  if (facts.sponsor) rows.push(`- **Sponsor**: ${facts.sponsor} _(source: ${facts.sources.sponsor})_`);
  if (facts.projectManager) rows.push(`- **Project Manager**: ${facts.projectManager} _(source: ${facts.sources.projectManager})_`);
  if (facts.scope) rows.push(`- **Scope**: ${facts.scope} _(source: ${facts.sources.scope})_`);
  if (facts.primaryStakeholders.length > 0) {
    rows.push(`- **Primary stakeholders**:`);
    for (const s of facts.primaryStakeholders) {
      rows.push(`  - ${s.name}${s.role ? ` (${s.role})` : ""}`);
    }
  }

  if (rows.length === 0) {
    return "── CONFIRMED FACTS — DO NOT CONTRADICT ──\n_(No system-of-record facts established yet — feel free to use [TBC] markers and the user will fill them in.)_\n";
  }

  return [
    "── CONFIRMED FACTS — DO NOT CONTRADICT ──",
    rows.join("\n"),
    "",
    "**RULES**:",
    "- If your draft would say a different value for any of these, write `[TBC — confirm change with sponsor]` instead of inventing a different number.",
    "- These values come from the Project record, the Stakeholder table, the user's confirmed answers, or the approved Charter — they are SYSTEM OF RECORD.",
    "- Use these EXACT values verbatim where applicable. Do not paraphrase a budget figure or round a date.",
    "",
  ].join("\n");
}
