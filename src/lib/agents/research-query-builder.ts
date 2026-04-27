/**
 * Artefact-driven research query builder.
 *
 * Static query templates (PHASE_RESEARCH_QUERIES) ask "best practices for
 * the Initiation phase" — they don't say "what specific facts do we need
 * to populate THESE artefacts". Result: research is generic and the
 * artefact prompts have to fill gaps from KB or invent.
 *
 * This module replaces (with fallback) that hardcoded path: given the
 * project context + phase + artefacts about to be generated, ask Haiku
 * to write 2-4 web search queries targeting the specific information
 * each artefact needs.
 *
 * Each generated query is paired with the target artefact name. When the
 * Perplexity result is stored in KB, the targetArtefact is written to
 * metadata.targetArtefact so:
 *  - the research-finding approval card knows the AUTHORITATIVE
 *    artefact mapping (not just heuristic);
 *  - the artefact-generation prompt can prefer facts targeted at that
 *    specific artefact when assembling its KB context.
 *
 * Cost: one Haiku call per phase (~$0.001). The phase research already
 * makes 2-4 Perplexity calls (paid). Net overhead is negligible.
 *
 * Falls back to the caller's static query list if Haiku fails or returns
 * unparseable JSON.
 */

import type { ProjectContext } from "./feasibility-research-types";

export interface TargetedQuery {
  artefact: string;     // The artefact this query targets
  query: string;        // The web search query string
  rationale?: string;   // Why this query is needed (optional, for audit)
}

export interface BuildQueriesInput {
  project: ProjectContext;
  phaseName: string;
  artefactNames: string[];
  /** Project methodology (e.g. "traditional", "scrum") — used in prompt context. */
  methodology?: string | null;
}

export async function buildArtefactDrivenQueries(input: BuildQueriesInput): Promise<TargetedQuery[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  if (input.artefactNames.length === 0) return [];

  const p = input.project;
  const nowYear = new Date().getFullYear();
  const startDate = (p as any).startDate ? new Date((p as any).startDate) : null;
  const endDate = (p as any).endDate ? new Date((p as any).endDate) : null;
  const projectMonth = startDate ? startDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : `${nowYear}`;
  const duration = startDate && endDate
    ? `${Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000)} days`
    : "unknown duration";
  const budget = p.budget ? `£${p.budget.toLocaleString()}` : "TBC";

  const prompt = `You are designing web research queries for a project management agent. Your goal: produce 2-4 specific, current (${nowYear}) queries that gather information the agent NEEDS to populate the listed artefacts accurately.

PROJECT
- Name: ${p.name}
- Description: ${p.description || "(none provided)"}
- Category: ${p.category || "general"}
- Budget: ${budget}
- Timing: ${projectMonth}, duration ${duration}
- Methodology: ${input.methodology || "traditional"}

PHASE: ${input.phaseName}

ARTEFACTS to be generated for this phase (each must be filled with real, defensible content — no [TBC] gaps for facts the user couldn't reasonably know):
${input.artefactNames.map((n, i) => `  ${i + 1}. ${n}`).join("\n")}

Your task: write 2-4 web search queries that will surface CURRENT data the agent can use to fill these artefacts. Each query must:
1. Reference the SPECIFIC project context (name, category, location/dates if applicable) — not generic best-practice fishing
2. Target ONE artefact's information needs (cite that artefact by name in your "artefact" field)
3. Be time-anchored to ${nowYear} — explicit "as of ${nowYear}" or "current ${nowYear} rates"
4. Cite-source-friendly (UK regulatory framing if the project is UK-based)
5. Cover the highest-value gaps — pick the artefacts where external research will most reduce hallucination/fabrication

Examples of GOOD queries:
- For a "Cost Management Plan" on a UK training project: "Current UK trainer day rates and venue hire costs as of ${nowYear} for residential 5-day technical training (50 delegates, London). Cite published rate cards or industry benchmarks."
- For a "Risk Register" on a Dubai trip: "Current FCDO travel advisories, weather risks, and visa-rejection rates for UK visitors to Dubai in [month] ${nowYear}. Cite primary government / consular sources."
- For a "Stakeholder Register" on a software migration: "Common stakeholder roles and engagement strategies for a ServiceNow migration in a UK enterprise as of ${nowYear}. Cite published case studies."

Examples of BAD queries (do NOT produce these):
- "Best practices for risk management" (too generic)
- "Project Charter content" (prompts a definition lookup, not new info)
- Anything not tied to the specific project + artefact

Return ONLY a JSON array, no preamble:
[
  { "artefact": "<artefact name from list above>", "query": "<the query>", "rationale": "<one short sentence: what gap this fills>" }
]`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return [];
    const data = await r.json();
    const text = (data.content?.[0]?.text || "").trim();
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]) as Array<{ artefact?: string; query?: string; rationale?: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((q) => typeof q?.artefact === "string" && typeof q?.query === "string" && q.query.length > 30)
      .slice(0, 4)
      .map((q) => ({
        artefact: q.artefact!.slice(0, 120),
        query: q.query!.slice(0, 800),
        rationale: typeof q.rationale === "string" ? q.rationale.slice(0, 240) : undefined,
      }));
  } catch (e) {
    console.error("[research-query-builder] Haiku call failed:", e);
    return [];
  }
}
