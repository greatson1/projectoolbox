/**
 * Pure table helpers shared by the artefact reverse-sync paths.
 *
 * Deliberately free of any DB / Prisma / Next imports so the regex-based
 * HTML-table editing — the riskiest part of the sync — is unit-testable in
 * isolation and runnable standalone. artefact-sync.ts re-uses these for both
 * its CSV and HTML paths.
 */

/** Lowercase + strip non-alphanumerics — used for fuzzy column/title matching. */
export function normalise(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/** Index of the first header cell matching any candidate column name (-1 if none). */
export function findColIndex(header: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const norm = normalise(candidate);
    const idx = header.findIndex(h => normalise(h) === norm);
    if (idx >= 0) return idx;
  }
  return -1;
}

/** dd/mm/yyyy — the format the WBS/Schedule artefacts use in date columns. */
export function formatDate(d: Date | null | undefined | string): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Header-column candidates that identify the task-title column in a table. */
export const HTML_TITLE_COLUMNS = ["Activity", "Work Package", "Deliverable", "Task", "Task Name", "User Story", "Title", "Name"];

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function htmlRowCells(rowHtml: string): string[] {
  return Array.from(rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(m => stripTags(m[1]));
}

/** Replace the inner text of specific cells (by index) in a <tr>, keeping attributes. */
export function replaceRowCells(rowHtml: string, updates: Array<[number, string]>): string {
  let cellIdx = -1;
  return rowHtml.replace(/(<t[dh][^>]*>)([\s\S]*?)(<\/t[dh]>)/gi, (m, open, _inner, close) => {
    cellIdx++;
    const upd = updates.find(([i]) => i === cellIdx);
    return upd ? `${open}${escapeHtmlText(upd[1])}${close}` : m;
  });
}

/**
 * Find the first task table in HTML content and apply `mutate` to it.
 * `mutate` returns the new table HTML or null for "no change". Returns the
 * full new content, or null when nothing matched/changed. Tables without a
 * recognisable title column (document-control header, Sources & Assumptions)
 * are skipped automatically.
 */
export function editHtmlTaskTable(
  content: string,
  mutate: (table: { html: string; header: string[]; rowsHtml: string[]; titleIdx: number }) => string | null,
): string | null {
  const tables = content.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
  if (!tables) return null;
  for (const tableHtml of tables) {
    const rowsHtml = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
    if (!rowsHtml || rowsHtml.length < 2) continue;
    const header = htmlRowCells(rowsHtml[0]);
    const titleIdx = findColIndex(header, HTML_TITLE_COLUMNS);
    if (titleIdx < 0) continue;
    const newTable = mutate({ html: tableHtml, header, rowsHtml, titleIdx });
    if (newTable && newTable !== tableHtml) return content.replace(tableHtml, newTable);
  }
  return null;
}
