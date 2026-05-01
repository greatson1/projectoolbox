/**
 * Title-similarity helpers used by action-executor to refuse
 * fabricated TASK_ASSIGNMENT proposals.
 *
 * Two checks:
 *   1. hasStatusClaimSuffix(title) — proposal title ending in
 *      "- approved", "- complete", "- done", "- signed off",
 *      "- finished", "- ticked" or "- resolved" is treated as a
 *      self-asserted completion claim, never a unit of work.
 *   2. fuzzyMatchScaffolded(title, candidates) — token-overlap match
 *      against an existing list of scaffolded task titles. Returns
 *      the best match if ≥2 significant tokens overlap, else null.
 *
 * Pure functions — no DB. Extracted from action-executor.ts so the
 * regex set + stop-word list + match threshold can be regression-tested.
 */

// Title ends with an isolated status word, optionally preceded by a dash,
// colon, em/en-dash, or just whitespace. Matches the Nova bug pattern
// "X - Project initiation approved" (status word last, dash earlier in
// the title) as well as the simpler "X - approved" pattern.
const STATUS_CLAIM = /[\s\-–—:]+(approved|complete[d]?|done|finished|signed[\s-]?off|ticked|resolved)\s*$/i;

export function hasStatusClaimSuffix(title: string): boolean {
  return STATUS_CLAIM.test(title);
}

export function stripStatusClaimSuffix(title: string): string {
  return title.replace(STATUS_CLAIM, "").trim();
}

// Stop words for task-title matching. Keep the list TIGHT — strong content
// tokens like "communication", "review", "update", "stakeholder", "register"
// must remain matchable. Only strip:
//   - generic English connectives ("the", "and", "with"…)
//   - filler verbs that appear in task title prefixes ("task", "new", "add")
//   - status-claim words (handled additionally by stripStatusClaimSuffix)
// Anything domain-specific stays in.
const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "over", "under",
  "task", "tasks", "item", "items",
  "approved", "complete", "completed", "done", "finished",
]);

export function tokenise(s: string): Set<string> {
  const toks = s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  return new Set(toks.filter(t => t.length >= 4 && !STOP.has(t)));
}

export interface ScaffoldedCandidate {
  id: string;
  title: string;
  status?: string;
}

export interface TitleMatch {
  id: string;
  title: string;
  overlap: number;
  status?: string;
}

/**
 * Find the best fuzzy match for `proposalTitle` among `candidates`.
 * Returns null if no candidate shares ≥2 significant tokens.
 */
export function fuzzyMatchScaffolded(
  proposalTitle: string,
  candidates: ScaffoldedCandidate[],
): TitleMatch | null {
  const proposalTokens = tokenise(stripStatusClaimSuffix(proposalTitle));
  if (proposalTokens.size === 0) return null;

  let best: TitleMatch | null = null;
  for (const c of candidates) {
    const cTokens = tokenise(c.title);
    let overlap = 0;
    for (const t of proposalTokens) if (cTokens.has(t)) overlap++;
    if (overlap >= 2 && (!best || overlap > best.overlap)) {
      best = { id: c.id, title: c.title, overlap, status: c.status };
    }
  }
  return best;
}
