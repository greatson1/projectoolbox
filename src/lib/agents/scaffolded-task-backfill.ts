/**
 * Pure logic for retro-stamping linkedEvent markers onto scaffolded task
 * descriptions that were created before the marker was added to a template.
 *
 * Old scaffolds for "Review and update Risk Register" and "Stakeholder
 * communication and updates" went into the DB with bare "[scaffolded]" in
 * description (no [event:...] tag), so the new event hooks fired by
 * /api/projects/[id]/risks and /stakeholders never matched and the task
 * never advanced. This module decides what marker (if any) a given title
 * should carry, so a script can patch existing rows without re-scaffolding
 * the whole project.
 */

export interface BackfillTitleRule {
  match: (title: string) => boolean;
  marker: string;
}

const RULES: BackfillTitleRule[] = [
  {
    match: t => /review.*risk register|update.*risk register/i.test(t),
    marker: "[event:risk_register_updated]",
  },
  {
    match: t => /stakeholder.*communication|stakeholder.*updates/i.test(t),
    marker: "[event:stakeholder_updated]",
  },
  {
    match: t => /clarification q&a|conduct.*clarification/i.test(t),
    marker: "[event:clarification_complete]",
  },
  {
    match: t => /submit.*phase.*gate|submit.*gate approval/i.test(t),
    marker: "[event:gate_request]",
  },
  {
    match: t => /obtain approval for all|all.*phase.*artefacts approved/i.test(t),
    marker: "[event:phase_advanced]",
  },
];

/** Returns the linkedEvent marker that the title implies, or null. */
export function inferLinkedEventMarker(title: string): string | null {
  for (const r of RULES) {
    if (r.match(title)) return r.marker;
  }
  return null;
}

/**
 * Decide what the new description should be — or null if no change needed.
 * Returns null if the description already contains the inferred marker, or
 * the title doesn't match any known rule.
 */
export function backfillDescription(title: string, current: string | null | undefined): string | null {
  const marker = inferLinkedEventMarker(title);
  if (!marker) return null;
  const existing = current || "";
  if (existing.includes(marker)) return null; // already stamped
  // If there's any "[event:" marker already, do not overwrite it — the title
  // matched our rule but the row already has a (possibly different) event tag.
  if (/\[event:[^\]]+\]/.test(existing)) return null;
  // Append the marker. Preserve existing "[scaffolded]" + any other tags.
  return existing.length > 0 ? `${existing} ${marker}` : `[scaffolded] ${marker}`;
}
