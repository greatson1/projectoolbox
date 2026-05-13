/**
 * Artefact-fulfillment matcher — decides which methodology-defined
 * artefacts have been "covered" by items in the DB.
 *
 * Background: the artefacts page banner used to compare counts via
 * `expected.length` vs `currentPhaseItems.length`. That broke whenever
 * a user uploaded or chat-created a custom-named document like
 * "Project Brief - Family Trip to Lagos" — that name doesn't equal the
 * canonical "Project Brief", so it was excluded from the per-phase
 * count, and the banner reported "0/4 approved, 3 not generated" while
 * the stats card next to it showed "2 documents, 1 approved".
 *
 * This module provides a fuzzy matcher: an item fulfils a methodology
 * artefact when its name either equals, contains, or is contained by
 * the canonical name (case-insensitive). The output is a per-canonical
 * fulfillment record so the UI can report exactly what's missing AND
 * count custom-named items as covering their methodology counterpart.
 */

export interface Artefactish {
  /** DB id — optional; useful for linking back. */
  id?: string;
  name: string;
  status: string; // "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED"
}

export interface Fulfilment {
  /** Canonical methodology artefact name. */
  canonical: string;
  /** Items that fuzzy-match this canonical name. Sorted: APPROVED first, then PENDING_REVIEW, then DRAFT. */
  matches: Artefactish[];
  /** True if at least one matching item is APPROVED. */
  approved: boolean;
  /** True if at least one matching item exists in any non-rejected status. */
  covered: boolean;
}

export interface FulfilmentSummary {
  fulfilments: Fulfilment[];
  /** Methodology names with no matching item at all. */
  missing: string[];
  /** Methodology names with at least one matching item (any status). */
  coveredCount: number;
  /** Methodology names with at least one APPROVED matching item. */
  approvedCount: number;
  /** Items in `items` that didn't match any canonical name (custom/extra). */
  extras: Artefactish[];
}

/**
 * Case-insensitive substring match in either direction. Examples:
 *   isFuzzyMatch("Project Brief - Family Trip to Lagos", "Project Brief") → true
 *   isFuzzyMatch("Project Brief", "Initial Project Brief") → true
 *   isFuzzyMatch("Stakeholder Register", "Project Brief") → false
 */
function isFuzzyMatch(itemName: string, canonical: string): boolean {
  const a = itemName.toLowerCase().trim();
  const b = canonical.toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

const STATUS_ORDER: Record<string, number> = {
  APPROVED: 0,
  PENDING_REVIEW: 1,
  DRAFT: 2,
  REJECTED: 3,
};

/**
 * Compute fulfilment for a list of items against a set of canonical
 * artefact names. Each canonical gets its own record; items that don't
 * match any canonical are returned as `extras`.
 *
 * REJECTED items are kept in `matches` so the UI can still see them,
 * but they don't count toward `covered` or `approved`.
 */
export function computeFulfilment(
  canonicals: string[],
  items: Artefactish[],
): FulfilmentSummary {
  const usedItemIds = new Set<string>();
  const itemKey = (it: Artefactish, idx: number) => it.id || `__idx_${idx}`;

  const fulfilments: Fulfilment[] = canonicals.map(canonical => {
    const matches = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => isFuzzyMatch(it.name, canonical))
      .map(({ it, idx }) => {
        usedItemIds.add(itemKey(it, idx));
        return it;
      })
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));

    const nonRejected = matches.filter(m => m.status !== "REJECTED");
    const approved = matches.some(m => m.status === "APPROVED");
    const covered = nonRejected.length > 0;
    return { canonical, matches, approved, covered };
  });

  const missing = fulfilments.filter(f => !f.covered).map(f => f.canonical);
  const coveredCount = fulfilments.filter(f => f.covered).length;
  const approvedCount = fulfilments.filter(f => f.approved).length;
  const extras = items.filter((it, idx) => !usedItemIds.has(itemKey(it, idx)));

  return { fulfilments, missing, coveredCount, approvedCount, extras };
}