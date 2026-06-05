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
 * Decide whether a list of dodChecks (boolean per criterion) is complete.
 * Empty criteria array = no DoD → vacuously complete.
 * Missing or shorter checks array = treated as all-false for missing
 * indices.
 */
export function dodComplete(criteria: string[] | undefined, checks: unknown): boolean {
  if (!criteria || criteria.length === 0) return true; // no DoD configured
  if (!Array.isArray(checks)) return false;
  for (let i = 0; i < criteria.length; i++) {
    if (checks[i] !== true) return false;
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
  const arr = Array.isArray(checks) ? checks : [];
  const unmet: string[] = [];
  let satisfied = 0;
  for (let i = 0; i < total; i++) {
    if (arr[i] === true) satisfied++;
    else unmet.push(criteria![i]);
  }
  return { complete: satisfied === total, satisfied, total, unmet };
}
