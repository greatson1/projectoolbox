/**
 * Server-safe parser for the universal source-prefix rule.
 *
 * The agent embeds a prefix in artefact Notes / Description columns at
 * generation time so every row carries its provenance:
 *
 *   - Research-anchored — facts grounded in real research / live data
 *   - User-confirmed    — direct from a clarification answer
 *   - Default-template  — generic placeholder content (fabricated names etc.)
 *   - Research-thin     — research attempted but inconclusive
 *   - Reserved          — placeholder cell that should not be relied on
 *
 * The pure variant lives here (no React, no Prisma) so it can be imported
 * from server modules. The client-side renderer in components/artefacts/
 * source-prefix.tsx wraps the same regex for badges and reasoning panels.
 */

const PREFIX_RE = /(Research-anchored|User-confirmed|Default-template|Default-percentage|Research-thin|Reserved)\s*[—:-]/i;

export type ServerSourceKind =
  | "research"
  | "user_confirmed"
  | "default_template"
  | "research_thin"
  | "reserved"
  | "unknown";

export function parseSourceKind(text: string | null | undefined): ServerSourceKind {
  if (!text) return "unknown";
  const m = text.match(PREFIX_RE);
  if (!m) return "unknown";
  const tag = m[1].toLowerCase();
  if (tag === "research-anchored") return "research";
  if (tag === "user-confirmed") return "user_confirmed";
  if (tag === "default-template" || tag === "default-percentage") return "default_template";
  if (tag === "research-thin") return "research_thin";
  if (tag === "reserved") return "reserved";
  return "unknown";
}

/**
 * Aggregates source kinds across an artefact's rows / lines. Returns the
 * dominant lineage so KB extraction can decide an appropriate trust level.
 *
 *   "high"     — most rows are research-anchored or user-confirmed
 *   "low"      — most rows are default-template or research-thin
 *   "mixed"    — neither side has a clear majority
 *   "unknown"  — no source prefixes detected at all
 */
export function summariseArtefactSource(content: string): "high" | "low" | "mixed" | "unknown" {
  if (!content) return "unknown";
  // Match every prefix occurrence in the content (CSV cell, prose paragraph, etc.)
  const matches = content.match(/(Research-anchored|User-confirmed|Default-template|Default-percentage|Research-thin|Reserved)/gi) || [];
  if (matches.length === 0) return "unknown";

  let high = 0;
  let low = 0;
  for (const raw of matches) {
    const kind = raw.toLowerCase();
    if (kind === "research-anchored" || kind === "user-confirmed") high++;
    else if (kind === "default-template" || kind === "default-percentage" || kind === "research-thin" || kind === "reserved") low++;
  }
  const total = high + low;
  if (total === 0) return "unknown";
  // ≥70% of one side is enough to call it; otherwise mixed.
  if (high / total >= 0.7) return "high";
  if (low / total >= 0.7) return "low";
  return "mixed";
}

/**
 * Maps the artefact-level source summary to a KnowledgeBaseItem.trustLevel.
 *
 *   high    → HIGH_TRUST     (safe to use in downstream prompts / generation)
 *   mixed   → STANDARD       (usable but flagged — agent should re-verify)
 *   low     → REFERENCE_ONLY (excluded from generation context — see
 *                             getProjectKnowledgeContext, which only injects
 *                             HIGH_TRUST + STANDARD into prompts)
 *   unknown → STANDARD       (be conservative — older artefacts may pre-date
 *                             the source-prefix rule)
 */
export function trustFromArtefactSource(
  summary: ReturnType<typeof summariseArtefactSource>,
): "HIGH_TRUST" | "STANDARD" | "REFERENCE_ONLY" {
  if (summary === "high") return "HIGH_TRUST";
  if (summary === "low") return "REFERENCE_ONLY";
  return "STANDARD";
}
