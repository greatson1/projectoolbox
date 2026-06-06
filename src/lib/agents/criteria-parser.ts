/**
 * Definition of Done / Definition of Ready criteria parser.
 *
 * Takes the markdown body of an approved DoD / DoR artefact and extracts
 * a structured criteria list the UI can render as a checklist and the
 * Task status gate can enforce.
 *
 * Pure — easy to test without touching the DB or the LLM.
 *
 * What we look for, in order:
 *   1. Bulleted lines:  `- foo`, `* foo`, `• foo`
 *   2. Numbered lines:  `1. foo`, `1) foo`
 *   3. Checkbox lines:  `- [ ] foo`, `- [x] foo`  (state ignored — we
 *                       want the criterion, not whether it's been ticked
 *                       on the source doc)
 *
 * We deliberately ignore plain paragraphs — DoDs that don't use a list
 * format are conversational not enforceable; the user can rewrite as a
 * list and re-approve.
 */

export interface ParsedCriteria {
  /** Flat list of criterion strings. Order preserved from the source. */
  criteria: string[];
  /** True when the source had at least one heading we recognised but no
   *  list items beneath — used by the artefact-approval hook to log a
   *  helpful warning instead of silently storing an empty array. */
  emptyListsDetected: boolean;
}

const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/;
const CHECKBOX_RE = /^\[\s*[ xX]?\s*\]\s+(.+)$/;

/**
 * Extract criteria from a markdown body.
 *
 * Stripping rules:
 *   - Inline markdown formatting (`**`, `*`, `_`, backticks) removed.
 *   - Leading checkbox tokens (`[ ]`, `[x]`) stripped — keep the prose.
 *   - Trailing colons stripped (so "Code reviewed:" becomes "Code reviewed").
 *   - Whitespace collapsed.
 *   - Items longer than 240 chars are kept but truncated for storage — a
 *     DoD criterion that long is almost certainly a paragraph posing as a
 *     bullet; we keep the first 240 chars so it's still recognisable.
 *   - Items shorter than 3 chars are dropped (debris from a sloppy parse).
 *
 * Deduplicates case-insensitively while preserving first-seen casing.
 */
export function parseCriteria(markdown: string): ParsedCriteria {
  if (!markdown || typeof markdown !== "string") {
    return { criteria: [], emptyListsDetected: false };
  }
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();
  let sawHeading = false;
  let sawAnyListItem = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    // Track headings so we can warn about "DoD with headings but no
    // bullets beneath them" — a common bad shape.
    if (/^#{1,6}\s/.test(line)) {
      sawHeading = true;
      continue;
    }

    const m = BULLET_RE.exec(line);
    if (!m) continue;
    sawAnyListItem = true;

    let text = m[1].trim();
    // Strip leading checkbox token if the bullet started with one.
    const cb = CHECKBOX_RE.exec(text);
    if (cb) text = cb[1].trim();

    // Strip surrounding markdown emphasis + inline code.
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
    text = text.replace(/__([^_]+)__/g, "$1");
    text = text.replace(/(?<![*_])\*([^*]+)\*(?![*_])/g, "$1");
    text = text.replace(/(?<![*_])_([^_]+)_(?![*_])/g, "$1");
    text = text.replace(/`([^`]+)`/g, "$1");

    // Strip trailing colon (criteria often end with one to introduce
    // sub-details — we want the headline).
    text = text.replace(/\s*[:：]\s*$/, "");

    // Collapse internal whitespace.
    text = text.replace(/\s+/g, " ").trim();

    if (text.length < 3) continue;
    if (text.length > 240) text = `${text.slice(0, 237)}…`;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return {
    criteria: out,
    emptyListsDetected: sawHeading && !sawAnyListItem,
  };
}

/**
 * Stable, normalised key for a criterion — used when Task.dodChecks is
 * stored as a Record<key, boolean> rather than the legacy positional
 * boolean[]. The keyed shape survives DoD criteria being reordered or
 * having items inserted in the middle, which the array shape can't.
 *
 * Lowercased + whitespace-collapsed so cosmetic edits to a criterion
 * (extra spaces, capitalisation) don't accidentally drop a tick. A
 * SEMANTIC edit produces a new key and resets the tick on that
 * criterion only — which is the correct behaviour: a changed criterion
 * deserves a fresh check.
 */
export function criterionKey(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Resolve whether a specific criterion is ticked in `checks`. Accepts:
 *   - boolean[]              — legacy positional shape (looked up by idx)
 *   - Record<string,boolean> — new keyed shape (looked up by criterionKey)
 *   - anything else          — treated as not ticked
 *
 * The two shapes coexist by design: existing rows in the DB stay as
 * arrays until the next save; new writes use the keyed shape.
 */
export function isCriterionChecked(criterion: string, checks: unknown, idx: number): boolean {
  if (Array.isArray(checks)) return checks[idx] === true;
  if (checks && typeof checks === "object") {
    return (checks as Record<string, unknown>)[criterionKey(criterion)] === true;
  }
  return false;
}

/**
 * Parse Initial Product Backlog artefacts into a flat list of item titles.
 *
 * `parseCriteria` only catches `-`/`*`/numbered bullets — good for DoD/DoR
 * which are always short bullet lists. The Product Backlog artefact is
 * generated as a richer document with one of these shapes:
 *
 *   - `#### PBI-001: Cloud Platform Setup` (heading-per-item, most common)
 *   - `| ID | Title | Story Points | Sprint |` markdown table
 *   - Plain bullets (rare but supported as a final fallback)
 *
 * We try each strategy in turn and return the first one that finds ≥1 item.
 * The title returned is the short headline only — story-point detail,
 * acceptance criteria, etc. live on the artefact and aren't duplicated onto
 * the seeded Task row.
 *
 * Returns { items, pbiRefs } — pbiRefs is the parallel "PBI-001" reference
 * (or null) per item so callers can put it in the Task description for
 * artefact traceability.
 */
const PBI_HEADING_RE = /^#{2,6}\s+(?:\*\*)?(PBI[-_\s]?\d+)[:.\s]+(.+?)(?:\*\*)?$/i;
const PBI_PLAIN_RE = /^#{2,6}\s+(?:\*\*)?(.+?)(?:\*\*)?$/;
const TABLE_ROW_RE = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|(.*)$/;

export interface ParsedBacklogItem {
  title: string;
  pbiRef: string | null;
}

export function parseBacklogItems(markdown: string): ParsedBacklogItem[] {
  if (!markdown || typeof markdown !== "string") return [];
  const lines = markdown.split(/\r?\n/);

  // Strategy 1 — PBI-numbered headings (`#### PBI-001: Cloud Platform Setup`)
  // This is the format the artefact generator currently uses, so it should
  // hit first on real data. Stripping the PBI prefix keeps the title clean
  // ("Cloud Platform Setup") while we preserve the ref ("PBI-001") for the
  // Task description.
  const headingItems: ParsedBacklogItem[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    const m = PBI_HEADING_RE.exec(line);
    if (!m) continue;
    const pbiRef = m[1].toUpperCase().replace(/[_\s]/g, "-");
    let title = m[2].trim().replace(/^\*\*|\*\*$/g, "").trim();
    if (title.length < 3) continue;
    if (title.length > 240) title = `${title.slice(0, 237)}…`;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    headingItems.push({ title, pbiRef });
  }
  if (headingItems.length > 0) return headingItems;

  // Strategy 2 — markdown table rows. Expect a header row containing
  // "title" / "item" / "story" in one of the columns; use that column index
  // for the title. Skip the separator (`|---|---|`) row. Stops working
  // gracefully on tables without an identifiable title column.
  let inTable = false;
  let titleColIdx = -1;
  let idColIdx = -1;
  const tableItems: ParsedBacklogItem[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("|")) { inTable = false; titleColIdx = -1; continue; }
    const cells = line.slice(1, line.endsWith("|") ? -1 : line.length).split("|").map(c => c.trim());
    if (!inTable) {
      // Header row — find the title column.
      titleColIdx = cells.findIndex(c => /title|item|story|name|backlog/i.test(c));
      idColIdx = cells.findIndex(c => /^id$|pbi/i.test(c));
      if (titleColIdx >= 0) inTable = true;
      continue;
    }
    // Skip the separator row (all dashes).
    if (cells.every(c => /^[-:\s]+$/.test(c))) continue;
    const titleRaw = cells[titleColIdx];
    if (!titleRaw) continue;
    let title = titleRaw.replace(/^\*\*|\*\*$/g, "").trim();
    if (title.length < 3) continue;
    if (title.length > 240) title = `${title.slice(0, 237)}…`;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const pbiRefRaw = idColIdx >= 0 ? cells[idColIdx] : "";
    const pbiRef = /pbi[-_]?\d+/i.test(pbiRefRaw) ? pbiRefRaw.toUpperCase().replace(/[_\s]/g, "-") : null;
    tableItems.push({ title, pbiRef });
  }
  if (tableItems.length > 0) return tableItems;

  // Strategy 3 — fall back to the strict bullet parser. Useful when the
  // user manually edits the artefact down to a quick bullet list.
  const bulletParsed = parseCriteria(markdown);
  return bulletParsed.criteria.map(title => ({ title, pbiRef: null }));
}

/**
 * Decide whether a list of dodChecks is complete. Accepts either the
 * legacy positional boolean[] shape or the keyed Record<key,boolean>
 * shape via isCriterionChecked.
 *
 *   - Empty criteria array       → vacuously complete (no DoD configured)
 *   - Missing tick on any item   → not complete
 *
 * Use this rather than reading checks[i] directly anywhere new — the
 * helper enforces a single semantics for both shapes.
 */
export function dodComplete(criteria: string[] | undefined, checks: unknown): boolean {
  if (!criteria || criteria.length === 0) return true; // no DoD configured
  for (let i = 0; i < criteria.length; i++) {
    if (!isCriterionChecked(criteria[i], checks, i)) return false;
  }
  return true;
}

/**
 * Same shape as dodComplete but with a richer return so callers can show
 * the user exactly which criteria are unmet without having to recompute.
 */
export function criteriaDelta(
  criteria: string[] | undefined,
  checks: unknown,
): { complete: boolean; satisfied: number; total: number; unmet: string[] } {
  const total = criteria?.length ?? 0;
  if (total === 0) return { complete: true, satisfied: 0, total: 0, unmet: [] };
  const unmet: string[] = [];
  let satisfied = 0;
  for (let i = 0; i < total; i++) {
    if (isCriterionChecked(criteria![i], checks, i)) satisfied++;
    else unmet.push(criteria![i]);
  }
  return { complete: satisfied === total, satisfied, total, unmet };
}
