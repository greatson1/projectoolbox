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

// Words that indicate a role/job-title rather than a person name. Extended
// to cover concrete technical / delivery roles so "Technical Architect",
// "Solution Architect", "Senior Engineer" stop reading as fabricated names
// on every Charter / Vision / Business-Case draft. New entries: architect,
// engineer, developer, designer, tester, master (scrum master), specialist,
// principal, senior, junior, expert, consultant, advisor, secretary.
const ROLE_KEYWORDS = /\b(manager|lead|director|sponsor|owner|team|member|representative|analyst|head|officer|coordinator|chair|agent|provider|supplier|contractor|partner|client|user|stakeholder|body|department|commission|authority|board|council|ministry|traveller|family|spouse|child|parent|guardian|companion|host|contact|emergency|insurance|airline|hotel|agency|primary|secondary|self|tbd|unassigned|tbc|architect|engineer|developer|designer|tester|master|specialist|principal|senior|junior|expert|consultant|advisor|adviser|secretary)\b/i;

const ORG_KEYWORDS = /\b(ltd|inc|corp|llc|plc|gmbh|airlines?|hotel|resort|clinic|hospital|bank|airways|ventures?|group|services?|solutions?|systems?|consultancy|consulting|agency|centre|center|commission|embassy|high commission|authority|department|ministry|international)\b/i;

// First-word allowlist — any 2-4 word candidate starting with one of these
// is treated as concept/sectioning, not a person name. Extended with
// concept-prefix terms commonly used in Vision / Charter / Business-Case
// docs: Strategic, Business, Technical, Status, Target, Key, Core,
// Vision, Product, Field, Document, Initiative, Awaiting, Not, Category,
// Measure, Metric, Metrics, Modernise, Modernize, Integrate, Improve,
// Enable, Escalate, Continuous, Operational, Acceptance, Definition,
// Quality, Performance, Reporting, Implementation, Delivery, Test,
// Testing, Development, Production, Staging, Release, Migration,
// Modular, Cloud, On, Multi, Cross, Non.
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
  // Concept-phrase prefixes — added 2026-06 to cut false-positive load on
  // Vision / Charter / Business-Case drafts.
  "Strategic", "Business", "Technical", "Status", "Target", "Key", "Core",
  "Vision", "Product", "Field", "Document", "Initiative", "Awaiting",
  "Not", "Category", "Measure", "Metric", "Metrics", "Modernise",
  "Modernize", "Integrate", "Improve", "Enable", "Escalate", "Continuous",
  "Operational", "Acceptance", "Definition", "Quality", "Performance",
  "Reporting", "Implementation", "Delivery", "Test", "Testing",
  "Development", "Production", "Staging", "Release", "Migration",
  "Cloud", "On", "Multi", "Cross", "Non", "Scrum", "Kanban", "Agile",
  "Waterfall", "Hybrid", "SAFe",
]);

// Whole-phrase allowlist. STOP_PREFIXES catches anything starting with the
// listed word; this list catches multi-word phrases whose first word is a
// legitimate name candidate (e.g. "Standard Operating Procedure", "End
// User Acceptance"). Add here ONLY phrases that are NEVER person names.
const SECTION_HEADINGS = new Set([
  "Executive Summary", "Project Charter", "Project Brief", "Project Plan",
  "Communication Plan", "Risk Register", "Risk Management Plan",
  "Cost Management Plan", "Cost Plan", "Budget Breakdown",
  "Schedule Baseline", "Work Breakdown Structure", "Stakeholder Register",
  "Quality Management Plan", "Procurement Plan", "Resource Management Plan",
  "Business Case", "Benefits Management Plan", "Pre Project",
  "Pre-Project", "Post Project", "Post-Project",
  "Action Items", "Next Actions", "Summary and Next Actions",
  // Concept phrases that don't begin with a STOP_PREFIX. Listed here so
  // the whole-phrase check catches them without polluting STOP_PREFIXES
  // with single words like "Standard" or "End" that ARE plausible first
  // names ("Standard Chartered" wouldn't be a person, but "End User" is
  // generic).
  "End User", "End Users", "Standard Operating Procedure", "Service Level Agreement",
  "Single Sign On", "Single Sign-On", "Disaster Recovery",
  "Change Request", "Change Requests", "Change Control",
  "Lessons Learned", "Lessons Learnt", "Go Live", "Go-Live",
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
  // Drop table-header cells entirely — column labels ("Mitigation Actions",
  // "Residual Score") are document structure, not names. Only <th>; <td>
  // content is real data and stays validated.
  out = out.replace(/<th\b[^>]*>[\s\S]*?<\/th>/gi, " ");
  out = out.replace(/<[^>]+>/g, " ");
  return out;
}

// A comma-separated line of mostly-short cells with no sentence punctuation
// is a CSV column-header row, not prose. ("Risk ID,Category,Title,…,
// Mitigation Actions,Contingency Plan,Residual Score,Last Reviewed" — every
// 2-word capitalised cell in that row used to be flagged as a fabricated
// person name, which blocked approval of every CSV artefact.)
function looksLikeCsvHeader(line: string): boolean {
  const cells = line.split(",");
  if (cells.length < 4) return false;
  if (/[.!?]\s*$/.test(line)) return false;
  const shortCells = cells.filter((c) => {
    const t = c.trim();
    return t.length > 0 && t.split(/\s+/).length <= 4;
  });
  return shortCells.length / cells.length >= 0.8;
}

/**
 * Remove structural header rows before name-scanning:
 *  - the first non-empty line when it reads as a CSV column-header row
 *  - markdown table header rows (a `| … |` line directly above a `|---|`
 *    separator)
 * Content rows are untouched — real data stays validated.
 */
function stripStructuralHeaderRows(s: string): string {
  const lines = s.split(/\r?\n/);
  const kept: string[] = [];
  let firstNonEmptySeen = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!firstNonEmptySeen && trimmed) {
      firstNonEmptySeen = true;
      if (looksLikeCsvHeader(trimmed)) continue;
    }
    const next = lines[i + 1]?.trim() ?? "";
    if (trimmed.startsWith("|") && next.includes("-") && /^\|?[\s:|-]+\|?$/.test(next)) {
      continue; // markdown table header row
    }
    kept.push(lines[i]);
  }
  return kept.join("\n");
}

export function validateArtefactNames({ content, registry }: ValidateInput): NameViolation[] {
  if (!content) return [];

  const text = stripHtml(stripStructuralHeaderRows(content));

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
