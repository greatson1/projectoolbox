/**
 * Pure classifier for free-text role strings → canonical key-role title.
 *
 * Extracted from key-role-recorder.ts so it can be unit-tested without
 * importing Prisma (which would throw at test time when DATABASE_URL
 * isn't set).
 *
 * The canonical title becomes the KB item title that the phase-prereq
 * evaluator does a substring match against, so any role string that
 * should auto-tick the same prereq MUST canonicalise to the same value.
 */

/**
 * Canonical role titles + the patterns that classify into them.
 * Keep this list small — only ROLES THAT HAVE A PHASE PREREQ should
 * live here. Adding "QA" or "Tech Lead" pollutes the KB with low-
 * value confirmed facts.
 */
const KEY_ROLE_PATTERNS: Array<{ canonical: string; pattern: RegExp }> = [
  // Sponsor — trigger for "Sponsor identified and confirmed" prereq on
  // Traditional/PMBOK Pre-Project gates.
  { canonical: "Project Sponsor", pattern: /\b(sponsor|exec(?:utive)?\s*sponsor|sponsoring\s*executive|sponsoring|sponsorship)\b/i },
  // PM — referenced by "PM identified" prereqs and by the agent system
  // prompt when describing project ownership. Anchored to avoid
  // matching "PMO Lead" as a PM.
  { canonical: "Project Manager", pattern: /^(?:pm|project\s*manager|programme\s*manager|program\s*manager)$/i },
  // Client / commissioning org — drives the "client engaged" line in
  // status reports and the procurement plan.
  { canonical: "Client Organisation", pattern: /^(?:client(?:\s*organisation|\s*org)?|commissioning\s*organisation)$/i },
];

/**
 * Return the canonical role title for a free-text role string, or null
 * when the string doesn't match a key role.
 *
 *   classifyKeyRole("Sponsor")           → "Project Sponsor"
 *   classifyKeyRole("project sponsor")   → "Project Sponsor"
 *   classifyKeyRole("Executive Sponsor") → "Project Sponsor"
 *   classifyKeyRole("PM")                → "Project Manager"
 *   classifyKeyRole("Project Manager")   → "Project Manager"
 *   classifyKeyRole("Client")            → "Client Organisation"
 *   classifyKeyRole("QA")                → null
 */
export function classifyKeyRole(roleOrTitle: string | null | undefined): string | null {
  if (!roleOrTitle) return null;
  const s = String(roleOrTitle).trim();
  if (!s) return null;
  for (const { canonical, pattern } of KEY_ROLE_PATTERNS) {
    if (pattern.test(s)) return canonical;
  }
  return null;
}
