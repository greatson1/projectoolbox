import { describe, it, expect } from "vitest";
import {
  normalise, findColIndex, htmlRowCells, replaceRowCells, editHtmlTaskTable, HTML_TITLE_COLUMNS,
} from "./artefact-table-utils";

// A realistic WBS document: a document-control header table (no title column,
// must be skipped) followed by the actual task table.
const DOC = `
<h2>Work Breakdown Structure</h2>
<table>
  <thead><tr><th>Field</th><th>Detail</th></tr></thead>
  <tbody>
    <tr><td>Document</td><td>WBS</td></tr>
    <tr><td>Status</td><td>DRAFT</td></tr>
  </tbody>
</table>
<h3>Work Packages</h3>
<table>
  <thead><tr><th>Task</th><th>Owner</th><th>Status</th><th>% Complete</th></tr></thead>
  <tbody>
    <tr><td>Establish baseline measurements</td><td>PM</td><td>TODO</td><td>0%</td></tr>
    <tr><td>Finalise user requirements</td><td>BA</td><td>TODO</td><td>0%</td></tr>
  </tbody>
</table>`;

describe("findColIndex", () => {
  it("matches columns case/punctuation-insensitively", () => {
    expect(findColIndex(["Task", "Owner", "% Complete"], ["progress", "% complete"])).toBe(2);
  });
  it("returns -1 when no candidate matches", () => {
    expect(findColIndex(["Field", "Detail"], HTML_TITLE_COLUMNS)).toBe(-1);
  });
});

describe("editHtmlTaskTable", () => {
  it("skips the doc-control table and edits the real task table", () => {
    const out = editHtmlTaskTable(DOC, ({ html, header, rowsHtml, titleIdx }) => {
      // Should have landed on the Work Packages table, not the header table.
      expect(header).toEqual(["Task", "Owner", "Status", "% Complete"]);
      expect(titleIdx).toBe(0);
      const statusIdx = findColIndex(header, ["Status"]);
      for (let r = 1; r < rowsHtml.length; r++) {
        if (normalise(htmlRowCells(rowsHtml[r])[titleIdx]) === normalise("Establish baseline measurements")) {
          return html.replace(rowsHtml[r], replaceRowCells(rowsHtml[r], [[statusIdx, "DONE"], [3, "100%"]]));
        }
      }
      return null;
    });
    expect(out).not.toBeNull();
    expect(out).toContain("<td>DONE</td>");
    expect(out).toContain("<td>100%</td>");
    // The doc-control "Status / DRAFT" row must be untouched.
    expect(out).toContain("<td>DRAFT</td>");
  });

  it("renames a row: matches on the OLD title and writes the NEW one", () => {
    const oldTitle = "Establish baseline measurements";
    const newTitle = "Establish baseline & KPI measurements";
    const out = editHtmlTaskTable(DOC, ({ html, rowsHtml, titleIdx }) => {
      for (let r = 1; r < rowsHtml.length; r++) {
        if (normalise(htmlRowCells(rowsHtml[r])[titleIdx]) === normalise(oldTitle)) {
          return html.replace(rowsHtml[r], replaceRowCells(rowsHtml[r], [[titleIdx, newTitle]]));
        }
      }
      return null;
    });
    expect(out).not.toBeNull();
    // New title present, escaped (& → &amp;); old title gone.
    expect(out).toContain("Establish baseline &amp; KPI measurements");
    expect(out).not.toContain("<td>Establish baseline measurements</td>");
    // The other task row is undisturbed.
    expect(out).toContain("<td>Finalise user requirements</td>");
  });

  it("returns null when the row title is not found (fails safe)", () => {
    const out = editHtmlTaskTable(DOC, ({ html, rowsHtml, titleIdx }) => {
      for (let r = 1; r < rowsHtml.length; r++) {
        if (normalise(htmlRowCells(rowsHtml[r])[titleIdx]) === normalise("Nonexistent task")) {
          return html.replace(rowsHtml[r], "");
        }
      }
      return null;
    });
    expect(out).toBeNull();
  });

  it("returns null when content has no tables at all", () => {
    expect(editHtmlTaskTable("<p>No tables here</p>", () => "x")).toBeNull();
  });
});

describe("replaceRowCells", () => {
  it("replaces only the targeted cell indices, keeping the rest", () => {
    const row = "<tr><td>A</td><td>B</td><td>C</td></tr>";
    expect(replaceRowCells(row, [[1, "Z"]])).toBe("<tr><td>A</td><td>Z</td><td>C</td></tr>");
  });
  it("preserves cell attributes", () => {
    const row = `<tr><td class="x">A</td><td>B</td></tr>`;
    expect(replaceRowCells(row, [[0, "Q"]])).toBe(`<tr><td class="x">Q</td><td>B</td></tr>`);
  });
});
