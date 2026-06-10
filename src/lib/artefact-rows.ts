/**
 * Lightweight client-side parser for tabular artefact content.
 *
 * The seeders (artefact-seeders.ts) own the canonical CSV parser used for
 * server-side seeding. The new view pages need the SAME shape (header →
 * row records) but render-only — they don't need the full handling of
 * stripped code fences, quoted cells with embedded newlines, etc.
 *
 * This parser handles:
 *   - CSV with optional header (comma-separated)
 *   - Markdown pipe tables ("| a | b |\n|---|---|\n| 1 | 2 |")
 *   - Code-fence wrappers ("```csv\n…\n```")
 *
 * Returns an empty array on anything it can't parse — never throws.
 * Empty result is the page's signal to show its empty state.
 */

export interface ArtefactRow {
  [column: string]: string;
}

export function parseArtefactRows(content: string | null | undefined): ArtefactRow[] {
  if (!content) return [];
  const cleaned = stripCodeFences(content).trim();
  if (!cleaned) return [];

  // Markdown pipe-table form: lines starting with `|` and a separator row.
  const pipeLines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isPipeRow = (l: string) => l.startsWith("|") && l.lastIndexOf("|") > 0;
  if (pipeLines.length >= 2 && pipeLines.every(isPipeRow)) {
    return parsePipeTable(pipeLines);
  }

  // Fallback: CSV.
  return parseCsv(cleaned);
}

function stripCodeFences(s: string): string {
  return s
    .replace(/^```[a-z]*\n?/im, "")
    .replace(/```\s*$/im, "");
}

function parsePipeTable(lines: string[]): ArtefactRow[] {
  const stripCells = (l: string) =>
    l
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const headerRow = stripCells(lines[0]);
  // Detect and skip the separator row (`|---|---|`).
  const sepIdx = lines.findIndex((l) => /^\|\s*[-:|\s]+\|\s*$/.test(l));
  const dataStart = sepIdx >= 0 ? sepIdx + 1 : 1;

  const rows: ArtefactRow[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cells = stripCells(lines[i]);
    if (cells.every((c) => !c)) continue;
    const obj: ArtefactRow = {};
    headerRow.forEach((h, idx) => {
      obj[h] = cells[idx] ?? "";
    });
    rows.push(obj);
  }
  return rows;
}

function parseCsv(raw: string): ArtefactRow[] {
  const lines = splitCsvLines(raw);
  if (lines.length < 2) return [];
  const headers = parseCsvRow(lines[0]).map((h) => h.trim());
  const rows: ArtefactRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    if (cells.every((c) => !c.trim())) continue;
    const obj: ArtefactRow = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? "").trim();
    });
    rows.push(obj);
  }
  return rows;
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Find a column value in an artefact row by trying multiple possible
 * column names (case-insensitive). Returns the first non-empty match.
 * Use for resilience against the small naming variations Sonnet produces
 * ("Epic" vs "Epic Name" vs "epic_name").
 */
export function pick(row: ArtefactRow, ...candidates: string[]): string {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const c = candidate.toLowerCase().replace(/[_\s]/g, "");
    for (const k of keys) {
      if (k.toLowerCase().replace(/[_\s]/g, "") === c) {
        const v = row[k];
        if (v && v.trim()) return v.trim();
      }
    }
  }
  return "";
}

/**
 * Find the canonical column name in the table headers that matches one of
 * the candidates. Returns the first matching header name (preserving its
 * original casing/punctuation in the table) so callers can WRITE to that
 * column when round-tripping changes back. Used by the inline-edit pages.
 *
 * Returns the FIRST candidate as a fallback if no header matches — that
 * way appending a new column is consistent.
 */
export function pickHeader(headers: string[], ...candidates: string[]): string {
  for (const candidate of candidates) {
    const c = candidate.toLowerCase().replace(/[_\s]/g, "");
    for (const h of headers) {
      if (h.toLowerCase().replace(/[_\s]/g, "") === c) return h;
    }
  }
  return candidates[0];
}

// ─── Table parser + serializer for round-trip editing ────────────────────

export type ArtefactFormat = "csv" | "markdown";

export interface ArtefactTable {
  format: ArtefactFormat;
  headers: string[];
  rows: ArtefactRow[];
}

/**
 * Like parseArtefactRows but also returns the original headers (in their
 * source order) and the format the artefact was stored in. Use this when
 * you need to round-trip — serializeArtefactTable will write back in the
 * same shape.
 *
 * Returns null when there's nothing parseable, so the caller can skip
 * any write attempt and surface its empty state.
 */
export function parseArtefactTable(content: string | null | undefined): ArtefactTable | null {
  if (!content) return null;
  const cleaned = stripCodeFences(content).trim();
  if (!cleaned) return null;

  const pipeLines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isPipeRow = (l: string) => l.startsWith("|") && l.lastIndexOf("|") > 0;

  if (pipeLines.length >= 2 && pipeLines.every(isPipeRow)) {
    const stripCells = (l: string) =>
      l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const headers = stripCells(pipeLines[0]);
    const sepIdx = pipeLines.findIndex((l) => /^\|\s*[-:|\s]+\|\s*$/.test(l));
    const dataStart = sepIdx >= 0 ? sepIdx + 1 : 1;
    const rows: ArtefactRow[] = [];
    for (let i = dataStart; i < pipeLines.length; i++) {
      const cells = stripCells(pipeLines[i]);
      if (cells.every((c) => !c)) continue;
      const obj: ArtefactRow = {};
      headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ""; });
      rows.push(obj);
    }
    if (rows.length === 0) return null;
    return { format: "markdown", headers, rows };
  }

  // CSV fallback.
  const lines = splitCsvLines(cleaned);
  if (lines.length < 2) return null;
  const headers = parseCsvRow(lines[0]).map((h) => h.trim());
  const rows: ArtefactRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    if (cells.every((c) => !c.trim())) continue;
    const obj: ArtefactRow = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? "").trim(); });
    rows.push(obj);
  }
  if (rows.length === 0) return null;
  return { format: "csv", headers, rows };
}

/**
 * Serialize a table back to its original format. CSV cells are quoted
 * when they contain commas, quotes, or newlines; markdown cells get the
 * pipe characters escaped. Headers preserve their original order even
 * if a row is missing a key for one of them.
 */
export function serializeArtefactTable(table: ArtefactTable): string {
  if (table.format === "markdown") {
    const escape = (s: string) => (s ?? "").replace(/\|/g, "\\|");
    const header = `| ${table.headers.map(escape).join(" | ")} |`;
    const sep = `| ${table.headers.map(() => "---").join(" | ")} |`;
    const body = table.rows
      .map((row) => `| ${table.headers.map((h) => escape(row[h] ?? "")).join(" | ")} |`)
      .join("\n");
    return body.length > 0 ? `${header}\n${sep}\n${body}` : `${header}\n${sep}`;
  }

  // CSV.
  const csvCell = (s: string) => {
    const v = s ?? "";
    if (v.includes(",") || v.includes("\n") || v.includes("\r") || v.includes('"')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const header = table.headers.map(csvCell).join(",");
  const body = table.rows
    .map((row) => table.headers.map((h) => csvCell(row[h] ?? "")).join(","))
    .join("\n");
  return body.length > 0 ? `${header}\n${body}` : header;
}
