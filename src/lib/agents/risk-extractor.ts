/**
 * Promote research-identified risks to the canonical Risk table.
 *
 * Feasibility research produces KB items like "Key Project Risks" whose
 * content is a comma-separated list of risk descriptions. Until this layer
 * existed, those KB items just sat there — the Risk Register page stayed
 * empty unless the user generated and approved an Initial Risk Register
 * artefact (which only happens in Initiation, not Pre-Project).
 *
 * This module scans the KB for risk-shaped items the agent has already
 * produced, parses each into discrete Risk rows, and creates them with
 * sensible default scores. The user can refine probability/impact on the
 * Risk page; the goal here is to make sure research findings flow through
 * to the canonical table immediately, not eight weeks later.
 *
 * Idempotent — every promoted KB item gains a "risk_promoted" tag so
 * subsequent runs skip already-processed items. Re-running on a project is
 * always safe.
 */

import { db } from "@/lib/db";

export interface PromoteRisksResult {
  scanned: number;
  created: number;
  skipped: number;
}

/**
 * Split a free-text risk blob into discrete risk titles. Handles:
 *   "Scope creep, resource constraints, vendor delays"
 *   "Scope creep; vendor delays; budget overrun"
 *   "1. Scope creep — undefined outcomes\n2. Resource constraints"
 *   "- Scope creep\n- Resource constraints"
 * Strips leading bullet markers / numbering, trims, drops empties + any
 * fragment longer than 200 chars (likely whole-paragraph noise).
 */
function splitRiskBlob(content: string): string[] {
  if (!content) return [];
  // Strip the [Research — …] / [User confirmed dd/mm/yyyy] prefix
  const stripped = content
    .replace(/^\[(research|user confirmed)[^\]]*\]\s*/i, "")
    .replace(/^q:[\s\S]*?\na:\s*/i, "")
    .trim();

  // Try newline / numbered split first
  const lineCandidates = stripped
    .split(/\r?\n|;|·|•|^\s*\d+[.)]\s+/m)
    .map(s => s.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);

  let candidates: string[];
  if (lineCandidates.length >= 2) {
    candidates = lineCandidates;
  } else {
    // Fall back to comma split — only when the blob looks like a list
    // ("scope creep, vendor delays, budget overrun") rather than prose
    // ("budget overrun is the biggest risk, requiring careful management").
    const commaCount = (stripped.match(/,/g) || []).length;
    if (commaCount >= 2 && stripped.length < 600) {
      candidates = stripped.split(/,/).map(s => s.trim()).filter(Boolean);
    } else {
      candidates = [stripped];
    }
  }

  // Keep the first sentence-ish chunk per candidate (titles, not paragraphs).
  // Strip leading conjunctions ("and resource shortages" → "resource
  // shortages") and capitalise the first letter so the Risk Register reads
  // cleanly.
  return candidates
    .map(c => c.split(/[.—:]/)[0].trim())
    .map(c => c.replace(/^(and|or|plus|also|including|such as|like)\s+/i, "").trim())
    .map(c => c.length > 0 ? c[0].toUpperCase() + c.slice(1) : c)
    .filter(c => c.length >= 6 && c.length <= 200);
}

/**
 * Heuristic: which KB items are risk lists worth promoting?
 *   - title contains "risk" or "blocker" or "threat"
 *   - tag list includes "risk" or "blocker"
 *   - NOT already promoted (no "risk_promoted" tag)
 *   - NOT itself a placeholder (e.g. clarification session metadata)
 */
async function findRiskItems(projectId: string) {
  // Prisma's OR + NOT combined in one where clause was returning 0 rows
  // even when the OR by itself matched — the AND pairing with NOT seems to
  // collapse the predicate. Workaround: query by OR alone, then post-filter
  // in JS to drop session-metadata titles and already-promoted items.
  const all = await db.knowledgeBaseItem.findMany({
    where: {
      projectId,
      OR: [
        { title: { contains: "risk", mode: "insensitive" } },
        { title: { contains: "blocker", mode: "insensitive" } },
        { title: { contains: "threat", mode: "insensitive" } },
        { tags: { hasSome: ["risk", "blocker"] } },
      ],
    },
    select: { id: true, title: true, content: true, tags: true, trustLevel: true },
    take: 50,
  });
  return all.filter(i =>
    !i.title.startsWith("__") &&
    !i.tags.includes("risk_promoted"),
  );
}

/**
 * Default scoring — research-derived risks come in without explicit
 * probability/impact. Score 9 (3×3, MEDIUM) is the safe default; the user
 * adjusts on the Risk Register page. Severity hints in the title bump it:
 *   - "critical", "severe", "major" → 4×4 = 16 (HIGH)
 *   - "minor", "low risk" → 2×3 = 6 (LOW)
 */
function inferScore(title: string): { probability: number; impact: number; score: number } {
  const t = title.toLowerCase();
  if (/\b(critical|severe|major|catastrophic|cancel|fail)\b/.test(t)) {
    return { probability: 3, impact: 4, score: 12 };
  }
  if (/\b(minor|low risk|negligible)\b/.test(t)) {
    return { probability: 2, impact: 2, score: 4 };
  }
  return { probability: 3, impact: 3, score: 9 };
}

/**
 * Try to assign a category from common risk-language keywords. The Risk
 * Register page groups by category, so a non-null value gives the user a
 * usable starting point.
 */
function inferCategory(title: string): string | null {
  const t = title.toLowerCase();
  if (/\b(budget|cost|spend|funding|cash)\b/.test(t))                 return "Financial";
  if (/\b(schedule|delay|timeline|deadline|slip)\b/.test(t))          return "Schedule";
  if (/\b(scope|requirement|change)\b/.test(t))                       return "Scope";
  if (/\b(resource|staff|team|people|skill)\b/.test(t))               return "Resource";
  if (/\b(vendor|supplier|contract|procurement)\b/.test(t))           return "Vendor";
  if (/\b(stakeholder|sponsor|engagement|approval)\b/.test(t))        return "Stakeholder";
  if (/\b(security|compliance|regulatory|legal|gdpr|data)\b/.test(t)) return "Compliance";
  if (/\b(quality|defect|performance|technical)\b/.test(t))           return "Quality";
  return "General";
}

/**
 * Main entry. Idempotent — items are tagged "risk_promoted" so re-running
 * is a no-op. Returns counts for logging at the call site.
 */
export async function promoteKBRisksToCanonical(projectId: string): Promise<PromoteRisksResult> {
  const items = await findRiskItems(projectId);
  let created = 0;
  let skipped = 0;

  for (const item of items) {
    const titles = splitRiskBlob(item.content);
    if (titles.length === 0) {
      skipped++;
      continue;
    }

    let madeAny = false;
    for (const title of titles) {
      // De-dupe within the project — never two rows with the same title
      const existing = await db.risk.findFirst({
        where: { projectId, title },
        select: { id: true },
      });
      if (existing) continue;

      const { probability, impact, score } = inferScore(title);
      const category = inferCategory(title);

      try {
        await db.risk.create({
          data: {
            projectId,
            title: title.slice(0, 255),
            description: `Identified during ${item.tags.includes("research") ? "feasibility research" : "user clarification"}: ${title}`,
            probability,
            impact,
            score,
            status: "OPEN",
            category,
          },
        });
        created++;
        madeAny = true;
      } catch (e) {
        console.error("[risk-extractor] create failed:", title, e);
      }
    }

    // Tag the source item as promoted regardless of whether anything was
    // actually created — re-running shouldn't re-scan items we've already
    // looked at, even if every candidate was a duplicate.
    if (madeAny || titles.length > 0) {
      await db.knowledgeBaseItem.update({
        where: { id: item.id },
        data: { tags: Array.from(new Set([...item.tags, "risk_promoted"])) },
      }).catch(() => {});
    }
  }

  return { scanned: items.length, created, skipped };
}
