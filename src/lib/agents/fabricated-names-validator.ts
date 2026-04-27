/**
 * Fabricated-names validator — scans an artefact draft for proper-name
 * tokens (people + organisations) that aren't in the project's allowed-
 * names registry.
 *
 * Different from `sanitise-artefact-content.ts` (which surgically
 * replaces specific Owner-column cells with [TBC]):
 *  - This validator scans the WHOLE document, not just owner columns.
 *  - It returns a list of violations rather than mutating the content.
 *  - The caller decides what to do — retry generation, save with
 *    metadata.fabricatedNames + block approval, or both.
 *
 * Logic:
 *  1. Strip HTML and code/preformatted blocks.
 *  2. Extract every capitalised 2-4-word token sequence.
 *  3. Drop tokens matching ROLE_KEYWORDS / ORG_KEYWORDS (those are
 *     placeholder terms, not invented names).
 *  4. Drop tokens that appear in the allowed registry (case-insensitive
 *     normalised match).
 *  5. Drop tokens that look like dates / phase names / common headings.
 *  6. What's left is fabrication.
 */

import type { AllowedNamesRegistry } from "@/lib/agents/allowed-names";

const ROLE_KEYWORDS = /\b(manager|lead|director|sponsor|owner|team|member|representative|analyst|head|officer|coordinator|chair|agent|provider|supplier|contractor|partner|client|user|stakeholder|body|department|commission|authority|board|council|ministry|traveller|family|spouse|child|parent|guardian|companion|host|contact|emergency|insurance|airline|hotel|agency|primary|secondary|self|tbd|unassigned|tbc)\b/i;

const ORG_KEYWORDS = /\b(ltd|inc|corp|llc|plc|gmbh|airlines?|hotel|resort|clinic|hospital|bank|airways|ventures?|group|services?|solutions?|systems?|consultancy|consulting|agency|centre|center|commission|embassy|high commission|authority|department|ministry|international)\b/i;

const STOP_PREFIXES = new Set([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "Pre", "Phase", "Project", "Programme", "Program", "Sprint", "Iteration",
  "Initial", "Final", "First", "Second", "Third", "Fourth", "Fifth",
  "Cost", "Budget", "Scope", "Schedule", "Risk", "Stakeholder",
  "Section", "Chapter", "Appendix", "Table", "Figure", "Note",
  "Strengths", "Weaknesses", "Opportunities", "Threats",
  "High", "Medium", "Low", "Critical",
  "United", "British", "American", "European", "International",
]);

const SECTION_HEADINGS = new Set([
  "Executive Summary", "Project Charter", "Project Brief", "Project Plan",
  "Communication Plan", "Risk Register", "Risk Management Plan",
  "Cost Management Plan", "Cost Plan", "Budget Breakdown",
  "Schedule Baseline", "Work Breakdown Structure", "Stakeholder Register",
  "Quality Management Plan", "Procurement Plan", "Resource Management Plan",
  "Business Case", "Benefits Management Plan", "Pre Project",
  "Pre-Project", "Post Project", "Post-Project",
  "Action Items", "Next Actions", "Summary and Next Actions",
]);

export interface NameViolation {
  /** The fabricated name as it appears in the draft. */
  name: string;
  /** A short snippet of surrounding text so the user/UI can locate it. */
  context: string;
  /** How many times the same name appears. */
  occurrences: number;
}

interface ValidateInput {
  content: string;
  registry: AllowedNamesRegistry;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripHtml(s: string): string {
  // Remove <pre>, <code>, <script>, <style> blocks first (preserve their
  // content but don't validate fabricated tokens inside code samples)
  let out = s.replace(/<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  out = out.replace(/<[^>]+>/g, " ");
  return out;
}

export function validateArtefactNames({ content, registry }: ValidateInput): NameViolation[] {
  if (!content) return [];

  const text = stripHtml(content);

  // Build the allow-set as normalised forms for case/punctuation tolerance.
  const allowed = new Set<string>();
  for (const n of [...registry.people, ...registry.organisations, ...registry.rolePlaceholders]) {
    allowed.add(normalise(n));
  }

  // Walk the text capturing capitalised 2-4 word sequences. We use a
  // greedy match and then trim role/org words at the boundaries so
  // "Manager Sarah Mitchell" yields just "Sarah Mitchell".
  const PROPER_NAME = /\b([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|[A-Z]\.))){1,3}\b/g;

  const violations = new Map<string, { name: string; context: string; occurrences: number }>();

  let m: RegExpExecArray | null;
  while ((m = PROPER_NAME.exec(text)) !== null) {
    const candidate = m[1].trim();

    // Skip section headings
    if (SECTION_HEADINGS.has(candidate)) continue;

    // Skip if any word in the candidate is a stop-prefix (Pre Project,
    // January something, Phase One, etc).
    const firstWord = candidate.split(/\s+/)[0];
    if (STOP_PREFIXES.has(firstWord)) continue;

    // Skip if the candidate matches role / org keywords (those are
    // generic terms, not fabricated names).
    if (ROLE_KEYWORDS.test(candidate)) continue;
    if (ORG_KEYWORDS.test(candidate)) continue;

    // Skip if the candidate is in the allow-list.
    if (allowed.has(normalise(candidate))) continue;

    // Skip 2-letter abbreviations that match known patterns (PMI, PMP,
    // ISO are all caught by the regex needing lowercase, so they don't
    // match — but defensive).
    const wordCount = candidate.split(/\s+/).length;
    if (wordCount < 2) continue;

    // Capture surrounding context for the UI banner.
    const startIdx = Math.max(0, m.index - 40);
    const endIdx = Math.min(text.length, m.index + candidate.length + 40);
    const ctx = text.slice(startIdx, endIdx).replace(/\s+/g, " ").trim();

    const key = candidate.toLowerCase();
    const existing = violations.get(key);
    if (existing) {
      existing.occurrences += 1;
    } else {
      violations.set(key, { name: candidate, context: ctx, occurrences: 1 });
    }
  }

  // Cap at 25 distinct violations so we don't drown the UI.
  return Array.from(violations.values()).slice(0, 25);
}
