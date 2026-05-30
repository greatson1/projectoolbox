/**
 * Stakeholder name normalisation — single source of truth.
 *
 * Used by:
 *   - stakeholder-extractor's in-memory aggregation key
 *   - stakeholder-extractor's DB existence check (after fetching all rows)
 *   - merge-duplicate-stakeholders cleanup script
 *
 * Why a separate helper? Three call sites previously each rolled their own
 * normalisation (or none) — which is exactly how "Ty Beetseh" / "Ty  Beetseh"
 * (extra space) / "TY Beetseh" (different case) ended up as three duplicate
 * rows on the People page. Sharing one canonical form closes that gap.
 *
 * Strip:
 *   - leading / trailing whitespace
 *   - collapse runs of internal whitespace to a single space
 *   - Unicode NBSP (U+00A0) and other space variants treated as spaces
 *
 * Do NOT casefold — the visual name on the People page should preserve the
 * user's chosen capitalisation. Casefolding happens at the comparison site
 * (via `.toLowerCase()` after this returns).
 */
export function normaliseStakeholderName(name: string | null | undefined): string {
  if (!name) return "";
  // Replace NBSP and other non-newline whitespace runs with a single ASCII
  // space, then trim. Newlines should never appear in a name field but if
  // they do, they're treated as whitespace too.
  return name.replace(/[\s ]+/g, " ").trim();
}

/** Convenience: lower-cased + normalised key suitable for Map deduplication. */
export function stakeholderNameKey(name: string | null | undefined): string {
  return normaliseStakeholderName(name).toLowerCase();
}