/**
 * Best-effort cleanup for LLM artefact outputs that mix HTML with stray
 * markdown tokens. The artefact-generation prompt instructs Claude to emit
 * pure HTML, but the per-artefact guidance template is written in markdown
 * for readability — and Claude occasionally echoes that markdown verbatim
 * into field values or section bodies. This function rewrites the most
 * common leakage patterns to their HTML equivalents so the rendered
 * artefact doesn't show raw `###`, `**bold**`, or pipe-table syntax.
 *
 * Pure function with no Prisma / Next dependencies — safe to unit-test.
 */
export function cleanMarkdownLeakage(html: string): string {
  let out = html;

  // Convert markdown table blocks (2+ rows starting and ending with |) to HTML tables.
  // Matches a header row + separator + body rows.
  out = out.replace(
    /(^|\n)(\|[^\n]+\|)\n(\|[-:\s|]+\|)\n((?:\|[^\n]+\|\n?)+)/g,
    (_, pre, header, _sep, body) => {
      const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const headers = cells(header);
      const rows = body.trim().split("\n").map(cells);
      const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows.map((r: string[]) => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
      return `${pre}<table>${thead}${tbody}</table>`;
    },
  );

  // Headings: #### / ### / ## / # at start of line
  out = out.replace(/(^|\n)#{4,6}\s+([^\n]+)/g, (_, p, t) => `${p}<h5>${t.trim()}</h5>`);
  out = out.replace(/(^|\n)###\s+([^\n]+)/g, (_, p, t) => `${p}<h4>${t.trim()}</h4>`);
  out = out.replace(/(^|\n)##\s+([^\n]+)/g, (_, p, t) => `${p}<h3>${t.trim()}</h3>`);
  out = out.replace(/(^|\n)#\s+([^\n]+)/g, (_, p, t) => `${p}<h2>${t.trim()}</h2>`);

  // Bold: **text** → <strong>text</strong> (non-greedy, no line breaks inside)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Italic: *text* (simple) → <em>text</em>. Avoid matching bullet asterisks at line start.
  out = out.replace(/(^|[^*\n])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  // Remove stray pipe-row fragments that weren't in a full markdown table (single rows).
  out = out.replace(/(^|\n)\|[-:\s|]+\|(?=\n|$)/g, ""); // separator lines
  out = out.replace(/(^|\n)\s*-{3,}\s*(?=\n|$)/g, "$1<hr>"); // --- rule

  return out;
}
