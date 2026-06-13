/**
 * Assignee / owner plausibility guard.
 *
 * Mis-aligned artefact tables (and document-control header rows getting
 * swept into the parser) produced junk in the owner column — fragments like
 * "Methodology Scrum Team Charter" or "Up to" — which then surfaced as
 * Task.assigneeName across the Schedule and PM Tracker UIs. A real owner is a
 * short person/role label; anything else should become null ("Unassigned"),
 * which is honest where junk text is not.
 *
 * Shared by the action-item extractor (reject at parse time) and the
 * assignee-cleanup pass (heal existing rows), so both use one definition.
 */

/** Returns a trimmed plausible owner, or null when the value is junk/empty. */
export function cleanAssignee(raw: string | null | undefined): string | null {
  const owner = (raw || "").trim();
  if (!owner) return null;
  // Placeholder / not-yet-assigned markers carry no owner information.
  if (/^\[?\s*(TBC|TBD|N\/?A|—|-)\s*\]?$/i.test(owner) || /^\[TBC/i.test(owner)) return null;
  // Real names/roles are short; long strings are concatenated cell fragments.
  if (owner.length > 50) return null;
  if (owner.split(/\s+/).length > 5) return null;
  // Document-control vocabulary — appears in the doc header table, never in a
  // person/role name.
  if (/\b(methodology|charter|version|document|draft|template|awaiting)\b/i.test(owner)) return null;
  return owner;
}

/** True when a non-empty value exists but is implausible as an owner. */
export function isImplausibleAssignee(raw: string | null | undefined): boolean {
  const v = (raw || "").trim();
  return v.length > 0 && cleanAssignee(v) === null;
}
