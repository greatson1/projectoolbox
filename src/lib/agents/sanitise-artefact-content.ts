/**
 * Strip fabricated personal names from generated artefact content (CSV
 * rows or markdown table cells) before the artefact is persisted.
 *
 * Why this exists:
 *   The Sonnet prompt explicitly forbids inventing personal names — Claude
 *   still slips through with "Sarah Mitchell" / "Marcus Chen" style cells.
 *   The downstream seeders already sanitise when copying CSV → Risk /
 *   Stakeholder rows, but the artefact's own .content field keeps the
 *   fabricated text and the user sees it on the artefact view.
 *
 * Strategy:
 *   - Identify CSV-shaped or markdown-table-shaped content.
 *   - Find the column header that names the owner ("Owner", "Risk Owner",
 *     "Assigned To", "Responsible", "Sponsor").
 *   - For each row, if that cell matches looksLikeFabricatedName, replace
 *     it with "[TBC — owner]". The PM Tracker / Stakeholder Register pages
 *     already prompt the user to fill these in.
 *
 * Pure function: no DB access, takes a string in, returns a string out.
 */

import { looksLikeFabricatedName } from "./fabricated-names-pure";

const OWNER_HEADERS = [
  "owner",
  "risk owner",
  "assigned to",
  "responsible",
  "assignee",
  "sponsor",
  "lead",
  "task owner",
  "action owner",
  "accountable",
];

const TBC_REPLACEMENT = "[TBC — owner]";

function isOwnerHeader(h: string): boolean {
  const norm = h.toLowerCase().trim().replace(/[*_]/g, "");
  return OWNER_HEADERS.includes(norm);
}

/** Split a CSV line preserving "quoted, fields". */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== "\\") {
      inQuotes = !inQuotes;
      cur += c;
      continue;
    }
    if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function unwrap(cell: string): string {
  const t = cell.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1);
  return t;
}

function rewrap(original: string, replacement: string): string {
  const t = original.trim();
  return t.startsWith('"') ? `"${replacement}"` : replacement;
}

function sanitiseCsv(content: string): { content: string; replaced: number } {
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) return { content, replaced: 0 };

  // First line that looks like CSV with at least one comma is treated as header
  const headerLineIdx = lines.findIndex(l => l.includes(",") && !l.startsWith("#"));
  if (headerLineIdx < 0) return { content, replaced: 0 };

  const headerCells = splitCsvLine(lines[headerLineIdx]).map(unwrap);
  const ownerCol = headerCells.findIndex(isOwnerHeader);
  if (ownerCol < 0) return { content, replaced: 0 };

  let replaced = 0;
  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || !line.includes(",")) continue;
    const cells = splitCsvLine(line);
    if (cells.length <= ownerCol) continue;
    const original = cells[ownerCol];
    const value = unwrap(original);
    if (looksLikeFabricatedName(value)) {
      cells[ownerCol] = rewrap(original, TBC_REPLACEMENT);
      lines[i] = cells.join(",");
      replaced += 1;
    }
  }
  return { content: lines.join("\n"), replaced };
}

function sanitiseMarkdownTable(content: string): { content: string; replaced: number } {
  const lines = content.split(/\r?\n/);
  let replaced = 0;
  // Walk line-by-line, finding table blocks (header line | separator | body)
  for (let i = 0; i < lines.length - 1; i++) {
    const head = lines[i];
    const sep = lines[i + 1];
    if (!head.includes("|") || !/^\s*\|?\s*[-:|\s]+\|?\s*$/.test(sep)) continue;
    const headers = head.split("|").map(c => c.trim());
    const ownerCol = headers.findIndex(isOwnerHeader);
    if (ownerCol < 0) continue;
    // Walk body rows until we leave the table (blank line or non-pipe line)
    for (let j = i + 2; j < lines.length; j++) {
      const row = lines[j];
      if (!row.trim() || !row.includes("|")) break;
      const cells = row.split("|");
      if (cells.length <= ownerCol) continue;
      const value = cells[ownerCol].trim();
      if (looksLikeFabricatedName(value)) {
        // Preserve the leading whitespace of the original cell so the table
        // visually keeps its alignment.
        const prefix = cells[ownerCol].match(/^\s*/)?.[0] ?? " ";
        const suffix = cells[ownerCol].match(/\s*$/)?.[0] ?? " ";
        cells[ownerCol] = `${prefix}${TBC_REPLACEMENT}${suffix}`;
        lines[j] = cells.join("|");
        replaced += 1;
      }
    }
    i = i + 1; // skip the separator
  }
  return { content: lines.join("\n"), replaced };
}

export interface SanitiseResult {
  content: string;
  replaced: number;
}

/**
 * Sanitise artefact content in place. Detects CSV vs markdown vs HTML and
 * applies the matching sanitiser. Returns the new content and a count of
 * how many cells were rewritten — caller can log this for audit.
 */
export function sanitiseArtefactContent(content: string, format?: string): SanitiseResult {
  if (!content || content.length < 10) return { content, replaced: 0 };
  const fmt = (format || "").toLowerCase();
  const looksLikeCsv = fmt === "csv" || /^[^|<\n]*,[^|<\n]*[\r\n]/.test(content.slice(0, 500));
  if (looksLikeCsv) {
    return sanitiseCsv(content);
  }
  // Markdown / HTML / mixed — fall through to the markdown table walker.
  // It only matches lines with the `| header | header |` shape, so HTML
  // content without tables passes through untouched.
  return sanitiseMarkdownTable(content);
}
