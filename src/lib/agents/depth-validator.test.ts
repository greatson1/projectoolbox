import { describe, it, expect } from "vitest";
import { assessSingleArtefactDepth, assessArtefactDepth } from "./depth-validator";

function makeMarkdownTable(rows: number): string {
  const header = "| Col A | Col B |";
  const sep = "|---|---|";
  const dataRows = Array.from({ length: rows }, (_, i) => `| a${i + 1} | b${i + 1} |`);
  return [header, sep, ...dataRows].join("\n");
}

function makeCsvTable(rows: number): string {
  const lines = ["Col A,Col B"];
  for (let i = 0; i < rows; i++) lines.push(`a${i + 1},b${i + 1}`);
  return lines.join("\n");
}

describe("assessSingleArtefactDepth", () => {
  it("returns null when WBS hits the row target", () => {
    const result = assessSingleArtefactDepth("Work Breakdown Structure", makeMarkdownTable(30), "Planning");
    expect(result).toBeNull();
  });

  it("flags a 12-row Planning WBS as a shortfall", () => {
    const result = assessSingleArtefactDepth("Work Breakdown Structure", makeMarkdownTable(12), "Planning");
    expect(result).not.toBeNull();
    expect(result?.severity).toBe("shortfall");
    expect(result?.observed).toBe(12);
    expect(result?.target).toBe(25);
  });

  it("flags a borderline 18-row WBS as a warning, not shortfall", () => {
    const result = assessSingleArtefactDepth("Work Breakdown Structure", makeMarkdownTable(18), "Planning");
    expect(result?.severity).toBe("warning");
  });

  it("handles CSV format", () => {
    const result = assessSingleArtefactDepth("WBS", makeCsvTable(8), "Planning");
    expect(result?.severity).toBe("shortfall");
    expect(result?.observed).toBe(8);
  });

  it("does not apply Planning WBS rule to Execution phase", () => {
    // WBS rule is front-only — won't fire for execution-class phase
    const result = assessSingleArtefactDepth("WBS", makeMarkdownTable(5), "Execution");
    expect(result).toBeNull();
  });

  it("flags a 3-row Risk Register as a shortfall during Initiation", () => {
    const result = assessSingleArtefactDepth("Risk Register", makeMarkdownTable(3), "Initiation");
    expect(result?.severity).toBe("shortfall");
  });

  it("flags a short Project Charter on word count", () => {
    const result = assessSingleArtefactDepth("Project Charter", "Tiny one-paragraph charter.", "Initiation");
    expect(result?.severity).toBe("shortfall");
    expect(result?.metric).toBe("wordCount");
  });

  it("ignores artefacts that don't match any rule", () => {
    const result = assessSingleArtefactDepth("Communication Plan", "Some content here.", "Planning");
    expect(result).toBeNull();
  });
});

describe("assessArtefactDepth (batch)", () => {
  it("reports hasShortfall=true when any artefact is shortfall", () => {
    const result = assessArtefactDepth([
      { name: "WBS", content: makeMarkdownTable(8) }, // shortfall
      { name: "Communication Plan", content: "ok" }, // ignored
    ], "Planning");
    expect(result.hasShortfall).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it("reports hasShortfall=false when only warnings present", () => {
    const result = assessArtefactDepth([
      { name: "WBS", content: makeMarkdownTable(20) }, // warning (60-100% of 25)
    ], "Planning");
    expect(result.hasShortfall).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].severity).toBe("warning");
  });

  it("returns empty warnings when everything hits target", () => {
    const result = assessArtefactDepth([
      { name: "WBS", content: makeMarkdownTable(30) },
      { name: "Risk Register", content: makeMarkdownTable(12) },
    ], "Planning");
    expect(result.warnings).toHaveLength(0);
    expect(result.hasShortfall).toBe(false);
  });
});
