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
const ROLE_KEYWORDS = /\b(managers?|leads?|directors?|sponsors?|owners?|teams?|members?|representatives?|analysts?|heads?|officers?|coordinators?|chairs?|agents?|providers?|suppliers?|contractors?|partners?|clients?|users?|stakeholders?|body|department|commission|authority|board|council|ministry|travellers?|family|spouse|child|parent|guardian|companions?|hosts?|contacts?|emergency|insurance|airline|hotel|agency|primary|secondary|self|tbd|unassigned|tbc|architects?|engineers?|developers?|designers?|testers?|masters?|specialists?|principals?|senior|junior|experts?|consultants?|advisors?|advisers?|secretary)\b/i;

const ORG_KEYWORDS = /\b(ltd|inc|corp|llc|plc|gmbh|airlines?|hotel|resort|clinic|hospital|bank|airways|ventures?|group|services?|solutions?|systems?|consultancy|consulting|agency|centre|center|commission|embassy|high commission|authority|department|ministry|international)\b/i;

// PM-domain vocabulary — a capitalised phrase containing ANY of these words
// is project terminology, never a person's name ("Approve Sprint Backlog",
// "Due Date", "Story Points", "Exception Report", "Items Awaiting
// Confirmation"). This is the systemic answer to the per-word STOP_PREFIXES
// whack-a-mole: real names contain none of these tokens, so recall on actual
// fabrications ("Sarah Mitchell") is unaffected.
const DOMAIN_KEYWORDS = /\b(sprints?|backlogs?|retrospectives?|reviews?|goals?|charts?|logs?|reports?|confirmations?|scope|points?|structures?|plans?|registers?|burndown|scrum|kanban|stor(?:y|ies)|tasks?|phases?|gates?|milestones?|artefacts?|artifacts?|documents?|items?|dates?|status|exceptions?|actions?|checklists?|criteria|metrics?|dashboards?|standups?|velocity|increments?|decommissioning|migrations?|inventor(?:y|ies)|requirements?|deliverables?|dependenc(?:y|ies)|assumptions?|budgets?|costs?|risks?|issues?|approvals?|baselines?|workshops?|meetings?|agendas?|charters?|registers?|matri(?:x|ces)|frameworks?|templates?|guidelines?|procedures?|processes?|workflows?|progress|periods?|controls?|cases?|packages?|knowledge|schedules?|escalations?|paths?|decisions?|recommendations?|summar(?:y|ies)|options?|outlines?|stages?|records?|highlights?|qualit(?:y|ies)|unresolved|raised|required|planned|approved|considered|outstanding|pending|completed?|remaining|assets?|retirement|purchase|orders?|benefits?|handover|closures?|statements?|lessons?|went|worked|improved?|releases?|formal|what|roots?|causes?|analysis|findings?|outcomes?|impacts?|recommendations?|requested|implemented|important|notes?|facts?|handed|over|proceed|certificates?|acceptance|documentation|no|by|wip|limits?|matter|triage|automation|polic(?:y|ies)|configurations?|flows?|lanes?|swimlanes?|columns?|cards?|cadences?|ceremon(?:y|ies)|replenishment|triggers?|resourcing|context|communications?|objectives?|calendars?|class(?:es)?|prioriti[sz]ation|logic|ratify|resolution|gaps?|standardi[sz]ation|prerequisites?|agreements?|level|service|do|all)\b/i;

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
  // Determiner/label prefixes — added 2026-07-08 after the Decom Sprint
  // Cadence batch flagged phrases like "This Retrospectives", "Current
  // Status", "Upstream Dependency", "Days Elapsed", "Proposed Sprint Goal".
  // None of these words ever starts a real person/organisation name.
  "This", "The", "Current", "Each", "Next", "Main", "Upstream", "Downstream",
  "Standard", "Proposed", "Extend", "Days", "Review", "Increment", "Backlog",
  "Sprints", "Retrospective", "Retrospectives", "Data", "Mitigation",
  "Contingency", "Residual", "Last", "Focus", "Overall", "Purpose",
  "Background", "Summary", "Overview", "Approach", "Objective", "Objectives",
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
  // Closing tags of cells / rows / list items / paragraphs / headings end a
  // text unit. Replace them with ". " so words from ADJACENT units can't be
  // read as one capitalised phrase — `<td>Methodology</td><td>Waterfall</td>`
  // used to collapse to "Methodology Waterfall" and get flagged as a
  // fabricated person name on every HTML Brief/Business-Case draft.
  out = out.replace(/<\/(td|tr|li|p|h[1-6]|div|section)\s*>|<br\s*\/?>/gi, ". ");
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
  // NOTE the quantifier placement: `(?:…){1,3}` INSIDE the capture group.
  // The old form `(word(?:\s+word)){1,3}` repeated the capture group itself,
  // so m[1] held only the LAST word-pair — "Engage External Suppliers" was
  // captured as "Engage External", which dodged the role/org keyword filter
  // ("Suppliers" never made it into the candidate) and produced phantom
  // two-word "names" from the tail ends of longer phrases.
  const PROPER_NAME = /\b([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+|[A-Z]\.)){1,3})\b/g;

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

    // Skip if the candidate matches role / org / PM-domain keywords (those
    // are generic terms, not fabricated names).
    if (ROLE_KEYWORDS.test(candidate)) continue;
    if (ORG_KEYWORDS.test(candidate)) continue;
    if (DOMAIN_KEYWORDS.test(candidate)) continue;

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
