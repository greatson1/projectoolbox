import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/artefacts/[id]/export?format=docx|pdf|md
 * Exports an artefact as a real document file.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format") || "docx";

  const artefact = await db.agentArtefact.findUnique({ where: { id } });
  if (!artefact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filename = artefact.name.replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_");

  // ── Markdown download ──
  if (format === "md") {
    return new Response(artefact.content || "", {
      headers: {
        "Content-Type": "text/markdown",
        "Content-Disposition": `attachment; filename="${filename}.md"`,
      },
    });
  }

  // ── HTML for Word / PDF (convert markdown → HTML) ──
  const htmlContent = markdownToStyledHtml(artefact.name, artefact.content || "", format);

  if (format === "pdf") {
    // Return print-ready HTML — user prints to PDF via browser dialog
    return new Response(htmlContent, {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": `inline; filename="${filename}.html"`,
      },
    });
  }

  // ── DOCX export via html-to-docx ──
  if (format === "docx") {
    try {
      const HTMLtoDOCX = (await import("html-to-docx")).default;
      const docxBuffer = await HTMLtoDOCX(htmlContent, undefined, {
        title: artefact.name,
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        font: "Calibri",
        fontSize: 24,
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
      // Fallback: return HTML that Word can open
      return new Response(htmlContent, {
        headers: {
          "Content-Type": "application/msword",
          "Content-Disposition": `attachment; filename="${filename}.doc"`,
        },
      });
    }
  }

  // ── XLSX export via ExcelJS ──
  if (format === "xlsx") {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Projectoolbox";
      wb.created = new Date();

      const ws = wb.addWorksheet(artefact.name.slice(0, 31));

      // Parse CSV content
      const rows = (artefact.content || "").split("\n").filter(l => l.trim()).map(line => {
        const cells: string[] = [];
        let cur = ""; let inQ = false;
        for (const ch of line) {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = ""; }
          else { cur += ch; }
        }
        cells.push(cur.trim());
        return cells;
      });

      if (rows.length === 0) throw new Error("No data");

      // Add header row
      const headerRow = ws.addRow(rows[0]);
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cell.border = { bottom: { style: "medium", color: { argb: "FF3730A3" } } };
      });
      headerRow.height = 22;

      // Add data rows
      rows.slice(1).forEach((rowData, idx) => {
        const row = ws.addRow(rowData);
        const isEven = idx % 2 === 0;
        row.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isEven ? "FFF8FAFC" : "FFFFFFFF" } };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
          // Right-align numbers and currency
          const v = String(cell.value || "").trim();
          if (/^[£$€]?[\d,]+(\.\d+)?$/.test(v) || /^\d+%$/.test(v)) {
            cell.alignment = { ...cell.alignment, horizontal: "right" };
          }
        });
        row.height = 18;
      });

      // Auto-fit column widths (max 40, min 10)
      ws.columns.forEach((col, i) => {
        const maxLen = rows.reduce((max, row) => Math.max(max, (row[i] || "").length), 0);
        col.width = Math.min(40, Math.max(10, maxLen + 4));
      });

      // Freeze header row
      ws.views = [{ state: "frozen", ySplit: 1 }];

      // Auto-filter
      if (rows.length > 1) {
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: rows[0].length } };
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

  return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
}

function markdownToStyledHtml(title: string, md: string, format: string): string {
  // Use marked for proper GFM table support, headings, lists, bold/italic
  const { marked } = require("marked");
  const body = marked.parse(md, { gfm: true, breaks: true }) as string;

  const printStyles = format === "pdf" ? `
    @media print {
      @page { margin: 2cm; }
      body { print-color-adjust: exact; }
    }` : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #1a1a2e; margin: 0; padding: 40px; max-width: 800px; }
  h1 { font-size: 20pt; color: #1e3a5f; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; margin-top: 32px; margin-bottom: 12px; }
  h2 { font-size: 14pt; color: #2d4a7a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 24px; margin-bottom: 8px; }
  h3 { font-size: 12pt; color: #374151; margin-top: 16px; margin-bottom: 4px; }
  h4 { font-size: 11pt; color: #4b5563; margin-top: 12px; margin-bottom: 4px; }
  p { margin: 0 0 10pt 0; }
  ul, ol { margin: 0 0 10pt 0; padding-left: 20pt; }
  li { margin-bottom: 4pt; }
  table { width: 100%; border-collapse: collapse; margin: 12pt 0; font-size: 10pt; border: 1px solid #e2e8f0; }
  thead th { background: #4f46e5; color: white; padding: 8pt 10pt; text-align: left; font-weight: 600; border: 1px solid #3730a3; }
  th { background: #4f46e5; color: white; padding: 8pt 10pt; text-align: left; font-weight: 600; }
  td { padding: 7pt 10pt; border: 1px solid #e2e8f0; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  .doc-header { background: linear-gradient(135deg, #1e3a5f 0%, #4f46e5 100%); color: white; padding: 32pt 40pt; margin: -40px -40px 32pt -40px; }
  .doc-title { font-size: 24pt; font-weight: 700; margin: 0 0 8pt 0; }
  .doc-meta { font-size: 9pt; opacity: 0.8; }
  ${printStyles}
</style>
</head>
<body>
<div class="doc-header">
  <div class="doc-title">${title}</div>
  <div class="doc-meta">Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · Projectoolbox</div>
</div>
<div>${body}</div>
</body>
</html>`;
}
