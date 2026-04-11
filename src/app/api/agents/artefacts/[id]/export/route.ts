import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/artefacts/[id]/export?format=docx|pdf|xlsx|md
 *
 * Exports an artefact as a professional document.
 * Content may be stored as "html", "markdown", or "csv" — handled accordingly.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format") || "docx";

  const artefact = await db.agentArtefact.findUnique({ where: { id } });
  if (!artefact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filename = artefact.name.replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_");
  const rawContent = artefact.content || "";

  // ── Raw markdown download ──
  if (format === "md") {
    return new Response(rawContent, {
      headers: {
        "Content-Type": "text/markdown",
        "Content-Disposition": `attachment; filename="${filename}.md"`,
      },
    });
  }

  // ── XLSX — spreadsheet export (CSV → Excel) ──
  if (format === "xlsx") {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Projectoolbox AI";
      wb.created = new Date();

      const ws = wb.addWorksheet(artefact.name.slice(0, 31));

      const rows = rawContent.split("\n").filter(l => l.trim()).map(line => {
        const cells: string[] = [];
        let cur = "";
        let inQ = false;
        for (const ch of line) {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = ""; }
          else { cur += ch; }
        }
        cells.push(cur.trim());
        return cells;
      });

      if (rows.length === 0) throw new Error("No data");

      // Header row — indigo background, white bold text
      const headerRow = ws.addRow(rows[0]);
      headerRow.height = 24;
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cell.border = { bottom: { style: "medium", color: { argb: "FF3730A3" } } };
      });

      // Data rows with alternating row colour
      rows.slice(1).forEach((rowData, idx) => {
        const row = ws.addRow(rowData);
        row.height = 18;
        const isEven = idx % 2 === 0;
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isEven ? "FFF8FAFC" : "FFFFFFFF" } };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
          cell.font = { size: 10, name: "Calibri" };
          // Right-align currency / percentage / numbers
          const v = String(cell.value || "").trim();
          if (/^[£$€]?[\d,]+(\.\d+)?$/.test(v) || /^\d+%$/.test(v)) {
            cell.alignment = { ...cell.alignment, horizontal: "right" };
          }
        });
      });

      // Auto-fit column widths
      ws.columns.forEach((col, i) => {
        const maxLen = rows.reduce((max, row) => Math.max(max, (row[i] || "").length), 0);
        col.width = Math.min(45, Math.max(12, maxLen + 4));
      });

      // Freeze header, auto-filter
      ws.views = [{ state: "frozen", ySplit: 1 }];
      if (rows.length > 1) {
        ws.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: rows[0].length },
        };
      }

      const buf = await wb.xlsx.writeBuffer();
      return new Response(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
        },
      });
    } catch (e) {
      console.error("[export] XLSX generation failed:", e);
      return NextResponse.json({ error: "XLSX generation failed" }, { status: 500 });
    }
  }

  // ── Convert content to clean body HTML ──
  // Stored as HTML → use directly (TipTap getHTML() output or our generated HTML)
  // Stored as markdown → convert via marked
  const isHtml = artefact.format === "html" || rawContent.trimStart().startsWith("<");
  let bodyHtml: string;

  if (isHtml) {
    bodyHtml = rawContent;
  } else {
    // Markdown → HTML via marked
    const { marked } = await import("marked");
    bodyHtml = marked.parse(rawContent, { gfm: true, breaks: true }) as string;
  }

  const styledHtml = buildStyledDocument(artefact.name, bodyHtml, format === "pdf");

  // ── PDF — return print-ready HTML (user prints via browser) ──
  if (format === "pdf") {
    return new Response(styledHtml, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${filename}.html"`,
      },
    });
  }

  // ── DOCX — html-to-docx ──
  if (format === "docx") {
    try {
      const HTMLtoDOCX = (await import("html-to-docx")).default;
      const docxBuffer = await HTMLtoDOCX(styledHtml, undefined, {
        title: artefact.name,
        subject: "Projectoolbox Agent Document",
        creator: "Projectoolbox AI",
        margin: { top: 1008, right: 1008, bottom: 1008, left: 1008 }, // ~1.75cm all sides
        font: "Calibri",
        fontSize: 22, // 11pt in half-points
        complexScriptsFont: "Calibri",
        lineNumber: false,
        pageNumber: true,
        table: { row: { cantSplit: true } },
        header: true,
        footer: true,
      });

      return new Response(docxBuffer as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${filename}.docx"`,
        },
      });
    } catch (e) {
      console.error("[export] DOCX generation failed:", e);
      // Fallback: Word-compatible HTML
      return new Response(styledHtml, {
        headers: {
          "Content-Type": "application/msword",
          "Content-Disposition": `attachment; filename="${filename}.doc"`,
        },
      });
    }
  }

  return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
}

/**
 * Wraps body HTML in a fully styled document shell that matches the
 * TipTap editor's rendering as closely as possible.
 *
 * Styling principles:
 * - Calibri 11pt body (matches Word default)
 * - Indigo accent colour (#4F46E5) for headings and table headers
 * - Tables: indigo header row, alternating row shading
 * - No markdown symbols possible since body is already HTML
 */
function buildStyledDocument(title: string, bodyHtml: string, forPrint = false): string {
  const printStyles = forPrint ? `
    @media print {
      @page { margin: 2cm; size: A4; }
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .doc-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }` : "";

  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  /* ─── Reset ─── */
  *, *::before, *::after { box-sizing: border-box; }

  /* ─── Body ─── */
  body {
    font-family: Calibri, "Segoe UI", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.65;
    color: #1a1a2e;
    margin: 0;
    padding: 0;
    background: #ffffff;
  }

  /* ─── Document shell ─── */
  .doc-wrapper { max-width: 820px; margin: 0 auto; padding: 0 0 60px 0; }

  /* ─── Header banner ─── */
  .doc-header {
    background: linear-gradient(135deg, #1e3a5f 0%, #4f46e5 100%);
    color: white;
    padding: 36pt 48pt 32pt;
    margin-bottom: 32pt;
    page-break-inside: avoid;
  }
  .doc-header .doc-title {
    font-size: 22pt;
    font-weight: 700;
    margin: 0 0 8pt 0;
    line-height: 1.2;
    letter-spacing: -0.3px;
  }
  .doc-header .doc-meta {
    font-size: 9pt;
    opacity: 0.75;
    margin: 0;
  }

  /* ─── Body content ─── */
  .doc-body { padding: 0 48pt; }

  /* ─── Headings ─── */
  h1, h2 {
    font-size: 16pt;
    color: #1e3a5f;
    border-bottom: 2px solid #4f46e5;
    padding-bottom: 6pt;
    margin: 28pt 0 10pt 0;
    font-weight: 700;
    page-break-after: avoid;
  }
  h3 {
    font-size: 13pt;
    color: #2d4a7a;
    margin: 20pt 0 6pt 0;
    font-weight: 600;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 3pt;
    page-break-after: avoid;
  }
  h4 {
    font-size: 11pt;
    color: #374151;
    margin: 14pt 0 4pt 0;
    font-weight: 600;
    page-break-after: avoid;
  }

  /* ─── Paragraphs ─── */
  p { margin: 0 0 9pt 0; }

  /* ─── Lists ─── */
  ul, ol { margin: 0 0 10pt 0; padding-left: 22pt; }
  li { margin-bottom: 4pt; }
  ul li::marker { color: #4f46e5; }

  /* ─── Tables ─── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 14pt 0 16pt 0;
    font-size: 10pt;
    page-break-inside: auto;
  }
  thead tr, table tr:first-child {
    background: #4f46e5 !important;
    color: white !important;
  }
  thead th, table tr:first-child th, table tr:first-child td {
    background: #4f46e5 !important;
    color: white !important;
    padding: 9pt 11pt;
    text-align: left;
    font-weight: 600;
    font-size: 10pt;
    border: 1px solid #3730a3;
  }
  th {
    background: #4f46e5;
    color: white;
    padding: 9pt 11pt;
    text-align: left;
    font-weight: 600;
    border: 1px solid #3730a3;
  }
  td {
    padding: 7pt 11pt;
    border: 1px solid #e2e8f0;
    vertical-align: top;
  }
  tbody tr:nth-child(odd) td { background: #f8fafc; }
  tbody tr:nth-child(even) td { background: #ffffff; }
  tbody tr:hover td { background: #eff6ff; }

  /* ─── Inline styles ─── */
  strong { font-weight: 600; color: #1e3a5f; }
  em { font-style: italic; color: #374151; }
  code {
    font-family: "Consolas", "Courier New", monospace;
    font-size: 9.5pt;
    background: #f1f5f9;
    padding: 1pt 4pt;
    border-radius: 3px;
    color: #0f172a;
  }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12pt; border-radius: 4px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 4px solid #4f46e5;
    margin: 12pt 0;
    padding: 8pt 16pt;
    background: #f0f4ff;
    color: #374151;
    font-style: italic;
  }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 24pt 0; }

  /* ─── Footer ─── */
  .doc-footer {
    margin-top: 48pt;
    padding: 12pt 48pt;
    border-top: 1px solid #e2e8f0;
    font-size: 8pt;
    color: #9ca3af;
    display: flex;
    justify-content: space-between;
  }

  ${printStyles}
</style>
</head>
<body>
<div class="doc-wrapper">
  <div class="doc-header">
    <div class="doc-title">${escapeHtml(title)}</div>
    <div class="doc-meta">Generated ${dateStr} · Projectoolbox AI Agent · DRAFT — Awaiting Approval</div>
  </div>
  <div class="doc-body">
    ${bodyHtml}
  </div>
  <div class="doc-footer">
    <span>${escapeHtml(title)}</span>
    <span>Projectoolbox &mdash; AI-Generated &mdash; ${dateStr}</span>
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
