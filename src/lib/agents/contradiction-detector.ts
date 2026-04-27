/**
 * Contradiction detector — checks a fresh artefact draft against the
 * project's confirmed facts and returns any divergences.
 *
 * Runs as a post-generation pass before the artefact is saved to DRAFT.
 * Saves any contradictions to artefact.metadata.contradictions so the UI
 * can surface a banner ("This draft says budget = £75k, Charter says
 * £50k — confirm intentional change?") and the approval API can refuse
 * to flip to APPROVED until the user explicitly resolves the disagreement.
 *
 * One Haiku call. No-op when ANTHROPIC_API_KEY is missing.
 */

import { createHash } from "crypto";
import { db } from "@/lib/db";
import { getConfirmedFacts, type ConfirmedFacts } from "@/lib/agents/confirmed-facts";

export interface Contradiction {
  field: string;
  drafted: string;
  confirmed: string;
  source: string;
}

interface DetectInput {
  projectId: string;
  artefactName: string;
  draftContent: string;
  /** Optional artefact id — when supplied, enables content-hash dedup
   *  against artefact.metadata.contradictionsCheckedFromHash so we don't
   *  re-run Haiku on identical content (e.g. retry path or re-save). */
  artefactId?: string;
}

/** Strip HTML to plain text for the LLM prompt. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function factsAsBullets(facts: ConfirmedFacts): string {
  const symbol = facts.currency === "USD" ? "$" : facts.currency === "EUR" ? "€" : "£";
  const rows: string[] = [];
  if (facts.budget != null) rows.push(`- budget = ${symbol}${facts.budget.toLocaleString()} (source: ${facts.sources.budget})`);
  if (facts.startDate) rows.push(`- startDate = ${facts.startDate} (source: ${facts.sources.startDate})`);
  if (facts.endDate) rows.push(`- endDate = ${facts.endDate} (source: ${facts.sources.endDate})`);
  if (facts.sponsor) rows.push(`- sponsor = ${facts.sponsor} (source: ${facts.sources.sponsor})`);
  if (facts.projectManager) rows.push(`- projectManager = ${facts.projectManager} (source: ${facts.sources.projectManager})`);
  if (facts.scope) rows.push(`- scope = ${facts.scope} (source: ${facts.sources.scope})`);
  if (facts.methodology) rows.push(`- methodology = ${facts.methodology} (source: ${facts.sources.methodology})`);
  return rows.join("\n");
}

export interface DetectResult {
  contradictions: Contradiction[];
  /** Cache key to pass to persistContradictions so future identical
   *  draft+facts pairs skip the Haiku call. null when caching is disabled
   *  (no artefactId provided) or there's nothing to cache. */
  cacheKey: string | null;
}

export async function detectContradictions(input: DetectInput): Promise<DetectResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { contradictions: [], cacheKey: null };

  const facts = await getConfirmedFacts(input.projectId);
  const factBlock = factsAsBullets(facts);
  if (!factBlock) return { contradictions: [], cacheKey: null }; // nothing to compare — no Haiku call

  const draft = stripHtml(input.draftContent || "").slice(0, 12000);
  if (draft.length < 100) return { contradictions: [], cacheKey: null };

  // ── Content-hash dedup ──
  // Skip the Haiku call when the same draft+facts pair was checked
  // previously. Hash includes the fact block so a Charter approval that
  // changes confirmed budget invalidates the cache automatically.
  const cacheKey = createHash("sha1").update(draft + "|" + factBlock).digest("hex").slice(0, 16);
  if (input.artefactId) {
    const cached = await db.agentArtefact.findUnique({
      where: { id: input.artefactId },
      select: { metadata: true },
    });
    const meta = (cached?.metadata as any) || {};
    if (meta.contradictionsCheckedFromHash === cacheKey) {
      const cachedContradictions = Array.isArray(meta.contradictions) ? meta.contradictions : [];
      return { contradictions: cachedContradictions, cacheKey };
    }
  }

  const prompt = `You are an audit pass for a project artefact. Compare the DRAFT below to the CONFIRMED FACTS and report any field where the draft asserts a DIFFERENT value than the confirmed source.

CONFIRMED FACTS (system of record — these are the canonical values):
${factBlock}

DRAFT ARTEFACT ("${input.artefactName}"):
${draft}

Return ONLY a JSON object: { "contradictions": [{ "field": string, "drafted": string, "confirmed": string }] }

Rules:
- Only flag a contradiction if the draft makes an EXPLICIT claim that DIFFERS from a confirmed value. (e.g. "Budget: £75,000" when confirmed budget is £50,000.)
- If the draft uses [TBC] or doesn't mention a field, that is NOT a contradiction.
- If the draft cites a confirmed value verbatim, that is NOT a contradiction.
- Round numbers count: "approximately £50k" matches £50,000 (no contradiction).
- If no contradictions, return { "contradictions": [] }.`;

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
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return { contradictions: [], cacheKey };
    const data = await r.json();
    const text = (data.content?.[0]?.text || "").trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { contradictions: [], cacheKey };
    const parsed = JSON.parse(m[0]) as { contradictions?: Contradiction[] };
    if (!Array.isArray(parsed.contradictions)) return { contradictions: [], cacheKey };
    const contradictions = parsed.contradictions
      .filter(c => typeof c?.field === "string" && typeof c?.drafted === "string" && typeof c?.confirmed === "string")
      .slice(0, 8) // cap noise
      .map(c => ({
        field: c.field,
        drafted: c.drafted.slice(0, 120),
        confirmed: c.confirmed.slice(0, 120),
        source: facts.sources[c.field as keyof ConfirmedFacts["sources"]] || "confirmed_facts",
      }));
    return { contradictions, cacheKey };
  } catch (e) {
    console.error("[contradiction-detector] failed:", e);
    return { contradictions: [], cacheKey };
  }
}

/**
 * Persist contradictions to artefact.metadata.contradictions (overwrites).
 * Also writes the content+facts hash so future calls can skip Haiku when
 * neither the draft nor the confirmed facts have changed.
 */
export async function persistContradictions(
  artefactId: string,
  contradictions: Contradiction[],
  draftAndFactsHash?: string,
): Promise<void> {
  const artefact = await db.agentArtefact.findUnique({
    where: { id: artefactId },
    select: { metadata: true },
  });
  const existing = (artefact?.metadata as any) || {};
  await db.agentArtefact.update({
    where: { id: artefactId },
    data: {
      metadata: {
        ...existing,
        contradictions,
        contradictionsCheckedAt: new Date().toISOString(),
        ...(draftAndFactsHash ? { contradictionsCheckedFromHash: draftAndFactsHash } : {}),
      } as any,
    },
  }).catch(() => {});
}
