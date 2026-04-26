import { describe, it, expect } from "vitest";
import { sanitiseArtefactContent } from "./sanitise-artefact-content";

describe("sanitiseArtefactContent — CSV", () => {
  it("replaces fabricated owner names in a CSV with [TBC — owner]", () => {
    const csv =
      `Risk ID,Title,Owner,Status\n` +
      `R001,Budget overrun,Sarah Mitchell,Open\n` +
      `R002,Schedule slip,Project Manager,Open\n`;
    const out = sanitiseArtefactContent(csv, "csv");
    expect(out.replaced).toBe(1);
    expect(out.content).toContain("[TBC — owner]");
    expect(out.content).toContain("Project Manager"); // role names preserved
    expect(out.content).not.toContain("Sarah Mitchell");
  });

  it("preserves quotes when replacing inside quoted fields", () => {
    const csv = `Title,Owner\n"Risk A","Marcus Chen"\n`;
    const out = sanitiseArtefactContent(csv, "csv");
    expect(out.content).toContain('"[TBC — owner]"');
  });

  it("does nothing when there's no Owner column", () => {
    const csv = `Title,Status\nFoo,Open\n`;
    const out = sanitiseArtefactContent(csv, "csv");
    expect(out.replaced).toBe(0);
    expect(out.content).toBe(csv);
  });

  it("recognises common header aliases (Risk Owner / Assigned To / Responsible)", () => {
    for (const header of ["Risk Owner", "Assigned To", "Responsible", "Sponsor"]) {
      const csv = `Title,${header}\nFoo,Sarah Mitchell\n`;
      const out = sanitiseArtefactContent(csv, "csv");
      expect(out.replaced).toBe(1);
      expect(out.content).toContain("[TBC — owner]");
    }
  });

  it("does not trip on cells that match the role-keyword filter", () => {
    const csv = `Title,Owner\nFoo,Risk Owner\nBar,Project Manager\nBaz,Sponsor\n`;
    const out = sanitiseArtefactContent(csv, "csv");
    expect(out.replaced).toBe(0);
  });

  it("handles all-fabricated tables (the user's screenshot)", () => {
    const csv =
      `Title,Owner,Risk Rating\n` +
      `Venue Double-Booking,Sarah Mitchell,High\n` +
      `Food Safety Incident,Marcus Chen,High\n` +
      `Adverse Weather,Sarah Mitchell,Medium\n` +
      `Key Supplier Failure,James Rodriguez,High\n` +
      `Budget Overrun,Emma Thompson,Medium\n`;
    const out = sanitiseArtefactContent(csv, "csv");
    expect(out.replaced).toBe(5);
    expect(out.content).not.toMatch(/Sarah|Marcus|James|Emma/);
  });
});

describe("sanitiseArtefactContent — Markdown table", () => {
  it("replaces fabricated owner cells inside a markdown table", () => {
    const md = [
      "| Risk | Owner | Status |",
      "|------|-------|--------|",
      "| Venue | Sarah Mitchell | Open |",
      "| Catering | Project Manager | Open |",
    ].join("\n");
    const out = sanitiseArtefactContent(md);
    expect(out.replaced).toBe(1);
    expect(out.content).toContain("[TBC — owner]");
    expect(out.content).toContain("Project Manager");
  });

  it("preserves cell whitespace alignment", () => {
    const md = [
      "| Risk     | Owner           | Status |",
      "|----------|-----------------|--------|",
      "| Venue    | Sarah Mitchell  | Open   |",
    ].join("\n");
    const out = sanitiseArtefactContent(md);
    expect(out.replaced).toBe(1);
    expect(out.content).toContain("[TBC — owner]");
  });

  it("does not touch tables without an Owner-shaped column", () => {
    const md = [
      "| Risk | Status |",
      "|------|--------|",
      "| Venue | Sarah Mitchell would normally trip but there's no Owner col |",
    ].join("\n");
    const out = sanitiseArtefactContent(md);
    expect(out.replaced).toBe(0);
  });
});

describe("sanitiseArtefactContent — passthrough", () => {
  it("returns content unchanged for short / empty input", () => {
    expect(sanitiseArtefactContent("").content).toBe("");
    expect(sanitiseArtefactContent("hi").content).toBe("hi");
  });

  it("leaves prose paragraphs alone", () => {
    const html = "<p>The project sponsor is Sarah Mitchell and she will approve.</p>";
    const out = sanitiseArtefactContent(html, "html");
    // No table → no rewrite. Prose-level fabricated names are out of scope
    // for this sanitiser (the prompt is the right layer to fix prose).
    expect(out.content).toBe(html);
  });
});
