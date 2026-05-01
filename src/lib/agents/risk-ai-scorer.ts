/**
 * AI-driven probability/impact scoring + mitigation drafting for risks.
 *
 * Risks created by the research extractor (risk-extractor.ts) ship with a
 * heuristic default of 3×3 = 9 (MEDIUM) and no mitigation text. That's
 * fine as a placeholder, but the user really wants a usable starting point
 * — which means proper context-aware scoring and a one-line mitigation.
 *
 * This module bundles every "ungroomed" risk on a project into a single
 * Haiku call (one round-trip per project, not per risk) and returns the
 * AI's scoring + mitigation suggestions. Each risk's score considers:
 *   - The risk title + description
 *   - Project context: budget, timeline, methodology, category
 *   - Standard PM heuristics (probability × impact on a 1–5 scale)
 *
 * Idempotent — only acts on risks where (probability=3 AND impact=3 AND
 * mitigation IS NULL), which is the signature of a research-extracted
 * default. User-edited rows and artefact-seeded rows with explicit scores
 * are never touched.
 *
 * Fire-and-forget at the call site. A failure (no API key, parse error,
 * 5xx) leaves the placeholders in place — never blocks the lifecycle.
 */

import { db } from "@/lib/db";

interface AIScore {
  title: string;
  probability: number;          // 1–5
  impact: number;               // 1–5
  mitigation: string;           // 1-line action
  ownerRole?: string | null;    // suggested role (e.g. "Project Manager")
}

/**
 * The prompt strategy: one shot, all risks at once. Returns a JSON array
 * matched on title so the LLM can't drift the order. Strict 1–5 scoring
 * for probability + impact (Excel/PMI convention).
 */
const SYSTEM_PROMPT = `You are a senior project risk analyst scoring risks against PMI/PRINCE2 conventions.

For each risk, return:
- probability: integer 1-5 (1=rare, 5=almost certain)
- impact:      integer 1-5 (1=negligible, 5=catastrophic)
- mitigation:  a single concrete action (≤140 chars), British English, imperative voice ("Book early to lock the rate", not "Booking early would help")
- ownerRole:   the role most likely to own this — choose from "Project Manager", "Project Sponsor", "Risk Owner", "Lead Architect", "Procurement Lead", "Finance Lead", "Compliance Lead", or "Team Lead". Don't invent personal names.

Score realistically against the project context. A "Scope creep" on a small £3k training programme is probability 3, impact 3 (annoying but not catastrophic). The same risk on a £3M government IT migration is probability 4, impact 5.

Return ONLY a JSON array: [{ "title": "exact title from input", "probability": N, "impact": N, "mitigation": "...", "ownerRole": "..." }]`;

interface ScoreRisksInput {
  projectId: string;
  /** Limit how many risks to score in one call. */
  max?: number;
}

interface ScoreRisksResult {
  scored: number;
  skipped: number;
}

export async function scoreRisksWithAI(input: ScoreRisksInput): Promise<ScoreRisksResult> {
  const { projectId, max = 12 } = input;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { scored: 0, skipped: 0 };
  }

  // Find ungroomed risks — default score (3×3=9), no mitigation, no owner.
  // These are the signature of a research-extractor or fallback default.
  const ungroomed = await db.risk.findMany({
    where: {
      projectId,
      probability: 3,
      impact: 3,
      OR: [
        { mitigation: null },
        { mitigation: "" },
      ],
    },
    select: { id: true, title: true, description: true, category: true },
    take: max,
  });

  if (ungroomed.length === 0) {
    return { scored: 0, skipped: 0 };
  }

  // Project context — gives the AI the basis to weight scoring properly.
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      description: true,
      methodology: true,
      category: true,
      budget: true,
      startDate: true,
      endDate: true,
    },
  });
  if (!project) return { scored: 0, skipped: 0 };

  const budgetStr = project.budget ? `£${project.budget.toLocaleString()}` : "TBC";
  const dur = project.startDate && project.endDate
    ? Math.max(1, Math.round((new Date(project.endDate).getTime() - new Date(project.startDate).getTime()) / 86400000))
    : null;
  const durStr = dur ? `${dur} days` : "TBC";

  const userPrompt = `PROJECT CONTEXT
Name:        ${project.name}
Description: ${project.description || "—"}
Methodology: ${project.methodology}
Category:    ${project.category || "general"}
Budget:      ${budgetStr}
Duration:    ${durStr}

RISKS TO SCORE (${ungroomed.length}):
${ungroomed.map((r, i) => `${i + 1}. "${r.title}"${r.category ? ` [${r.category}]` : ""}${r.description ? ` — ${r.description.slice(0, 200)}` : ""}`).join("\n")}

Return ONLY the JSON array described in your instructions, with one entry per risk above. Match titles exactly.`;

  let parsed: AIScore[] = [];
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.error("[risk-ai-scorer] API error", res.status);
      return { scored: 0, skipped: ungroomed.length };
    }
    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return { scored: 0, skipped: ungroomed.length };
    parsed = JSON.parse(match[0]);
  } catch (e) {
    console.error("[risk-ai-scorer] generation failed:", e);
    return { scored: 0, skipped: ungroomed.length };
  }

  // Apply scores — match by title, never trust LLM-supplied IDs. Re-check
  // each risk's current state (the user could have edited it between fetch
  // and apply), and only update when probability+impact are still default.
  let scored = 0;
  for (const ai of parsed) {
    if (!ai?.title) continue;
    const matchRisk = ungroomed.find(r => r.title.trim().toLowerCase() === ai.title.trim().toLowerCase());
    if (!matchRisk) continue;

    const prob = clampInt(ai.probability, 1, 5);
    const imp  = clampInt(ai.impact, 1, 5);
    const score = prob * imp;
    const mitigation = (ai.mitigation || "").trim().slice(0, 500) || null;
    const ownerRole = (ai.ownerRole || "").trim().slice(0, 100) || null;

    try {
      const fresh = await db.risk.findUnique({
        where: { id: matchRisk.id },
        select: { probability: true, impact: true, mitigation: true, owner: true },
      });
      if (!fresh) continue;
      // Don't overwrite user edits — only fill in when still at defaults
      if (fresh.probability !== 3 || fresh.impact !== 3) continue;
      if (fresh.mitigation && fresh.mitigation.trim().length > 0) continue;

      await db.risk.update({
        where: { id: matchRisk.id },
        data: {
          probability: prob,
          impact: imp,
          score,
          mitigation,
          owner: fresh.owner || ownerRole,
        },
      });
      scored++;
    } catch (e) {
      console.error("[risk-ai-scorer] update failed:", matchRisk.title, e);
    }
  }

  return { scored, skipped: ungroomed.length - scored };
}

function clampInt(n: any, min: number, max: number): number {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return Math.round((min + max) / 2);
  return Math.max(min, Math.min(max, v));
}
