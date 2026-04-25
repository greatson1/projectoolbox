import { describe, it, expect } from "vitest";
import { cleanMarkdownLeakage } from "./markdown-cleanup";

// Regression suite for the bug where artefacts marked format=html still
// rendered raw markdown tokens (###, |---|, **bold**) inline. The
// guidance templates fed into the prompt are written in markdown for
// readability; when the LLM echoes them verbatim the cleanup function
// converts the leaked tokens to their HTML equivalents.

describe("cleanMarkdownLeakage", () => {
  it("converts a stray ### heading into <h4>", () => {
    const out = cleanMarkdownLeakage("<p>before</p>\n### Document Control\n<p>after</p>");
    expect(out).toContain("<h4>Document Control</h4>");
    expect(out).not.toMatch(/^### Document Control/m);
  });

  it("converts ## and # headings into <h3> and <h2>", () => {
    const out = cleanMarkdownLeakage("<p>x</p>\n## Section\n# Title\n<p>y</p>");
    expect(out).toContain("<h3>Section</h3>");
    expect(out).toContain("<h2>Title</h2>");
  });

  it("converts a markdown table block into an HTML <table>", () => {
    const md = [
      "<p>intro</p>",
      "| Field | Value |",
      "|-------|-------|",
      "| Document | Feasibility Study |",
      "| Project | Trip |",
      "<p>outro</p>",
    ].join("\n");
    const out = cleanMarkdownLeakage(md);

    expect(out).toContain("<table>");
    expect(out).toContain("<thead>");
    expect(out).toContain("<th>Field</th>");
    expect(out).toContain("<th>Value</th>");
    expect(out).toContain("<td>Document</td>");
    expect(out).toContain("<td>Feasibility Study</td>");
    // Original markdown rows must be gone
    expect(out).not.toContain("|-------|-------|");
  });

  it("converts **bold** to <strong>", () => {
    const out = cleanMarkdownLeakage("<p>**Assessment:** £10,000</p>");
    expect(out).toContain("<strong>Assessment:</strong>");
    expect(out).not.toContain("**Assessment:**");
  });

  it("converts --- horizontal rule to <hr>", () => {
    const out = cleanMarkdownLeakage("<p>before</p>\n---\n<p>after</p>");
    expect(out).toContain("<hr>");
  });

  it("strips orphan markdown table separator rows", () => {
    // A separator with no header/body around it is just visual noise — strip it.
    const out = cleanMarkdownLeakage("<p>before</p>\n|-------|-------|\n<p>after</p>");
    expect(out).not.toContain("|-------|-------|");
  });

  it("leaves clean HTML untouched", () => {
    const html = "<h2>Title</h2><p>Plain content with no markdown.</p>";
    expect(cleanMarkdownLeakage(html)).toBe(html);
  });

  it("regression: the exact 'Travel Experience' bleed pattern is normalised", () => {
    // The raw bleed seen in the screenshot — markdown table dumped into prose.
    const bleed = [
      "<p><strong>Travel Experience:</strong></p>",
      "### Document Control",
      "| Field | Detail |",
      "|-------|--------|",
      "| Document Title | Requirements Specification |",
      "| Version | 1.0 |",
    ].join("\n");

    const out = cleanMarkdownLeakage(bleed);
    expect(out).toContain("<h4>Document Control</h4>");
    expect(out).toContain("<table>");
    expect(out).toContain("<th>Field</th>");
    expect(out).toContain("<td>Document Title</td>");
    // No markdown leakage left
    expect(out).not.toMatch(/^### /m);
    expect(out).not.toMatch(/\|-+\|/);
  });
});
