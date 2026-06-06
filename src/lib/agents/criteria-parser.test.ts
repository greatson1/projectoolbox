import { describe, it, expect } from "vitest";
import { parseCriteria, parseBacklogItems, dodComplete, criteriaDelta, criterionKey, isCriterionChecked } from "./criteria-parser";

describe("parseCriteria", () => {
  it("extracts dash bullets", () => {
    const md = "## Definition of Done\n- Code reviewed\n- Tests passing\n- Documentation updated";
    expect(parseCriteria(md).criteria).toEqual([
      "Code reviewed",
      "Tests passing",
      "Documentation updated",
    ]);
  });

  it("extracts star + bullet-point bullets", () => {
    const md = "* Acceptance criteria met\n• User-facing copy reviewed\n* Demoed to PO";
    expect(parseCriteria(md).criteria).toEqual([
      "Acceptance criteria met",
      "User-facing copy reviewed",
      "Demoed to PO",
    ]);
  });

  it("extracts numbered lists", () => {
    const md = "1. Story sliced thin enough\n2. Estimated\n3. Acceptance criteria written\n4) Linked to a sprint goal";
    expect(parseCriteria(md).criteria).toEqual([
      "Story sliced thin enough",
      "Estimated",
      "Acceptance criteria written",
      "Linked to a sprint goal",
    ]);
  });

  it("strips checkbox tokens — the criterion is what we want, not its state", () => {
    const md = "- [ ] Code reviewed\n- [x] Tests passing\n- [X] Documentation updated";
    expect(parseCriteria(md).criteria).toEqual([
      "Code reviewed",
      "Tests passing",
      "Documentation updated",
    ]);
  });

  it("strips bold / italic / code markers", () => {
    const md = "- **Code reviewed** by another engineer\n- *Tests* `passing`\n- _UAT signed off_";
    expect(parseCriteria(md).criteria).toEqual([
      "Code reviewed by another engineer",
      "Tests passing",
      "UAT signed off",
    ]);
  });

  it("strips trailing colons (criteria headings often introduce sub-details)", () => {
    const md = "- Code reviewed:\n- Tests passing:";
    expect(parseCriteria(md).criteria).toEqual(["Code reviewed", "Tests passing"]);
  });

  it("deduplicates case-insensitively (keeps first-seen casing)", () => {
    const md = "- Code reviewed\n- code reviewed\n- CODE REVIEWED\n- Tests passing";
    expect(parseCriteria(md).criteria).toEqual(["Code reviewed", "Tests passing"]);
  });

  it("drops <3-char debris (sloppy parse from a bad bullet)", () => {
    const md = "- Code reviewed\n- ok\n- Yes\n- Tests passing";
    // "ok" (2 chars) dropped; "Yes" (3 chars) kept.
    expect(parseCriteria(md).criteria).toEqual(["Code reviewed", "Yes", "Tests passing"]);
  });

  it("truncates >240 char criteria with an ellipsis", () => {
    const long = "x".repeat(300);
    const md = `- ${long}`;
    const parsed = parseCriteria(md);
    expect(parsed.criteria).toHaveLength(1);
    expect(parsed.criteria[0]).toHaveLength(238); // 237 chars + "…"
    expect(parsed.criteria[0].endsWith("…")).toBe(true);
  });

  it("ignores plain paragraphs — DoD must be a list to be enforceable", () => {
    const md = "Code must be reviewed.\n\nTests must pass.\n\nDocumentation updated.";
    expect(parseCriteria(md).criteria).toEqual([]);
  });

  it("flags emptyListsDetected when headings present but no bullets beneath", () => {
    const md = "## Definition of Done\n\n## Code Quality\n\n## Testing";
    const out = parseCriteria(md);
    expect(out.criteria).toEqual([]);
    expect(out.emptyListsDetected).toBe(true);
  });

  it("returns empty on null / empty / non-string input", () => {
    expect(parseCriteria("").criteria).toEqual([]);
    expect(parseCriteria(null as unknown as string).criteria).toEqual([]);
    expect(parseCriteria(undefined as unknown as string).criteria).toEqual([]);
  });
});

describe("dodComplete", () => {
  it("returns true when no DoD configured (vacuously complete)", () => {
    expect(dodComplete([], [])).toBe(true);
    expect(dodComplete(undefined, undefined)).toBe(true);
  });

  it("returns false when any criterion is unticked", () => {
    expect(dodComplete(["a", "b", "c"], [true, false, true])).toBe(false);
    expect(dodComplete(["a", "b", "c"], [true, true])).toBe(false); // missing index
    expect(dodComplete(["a", "b", "c"], null)).toBe(false);
  });

  it("returns true when every criterion has true at its index", () => {
    expect(dodComplete(["a", "b", "c"], [true, true, true])).toBe(true);
  });

  it("only `true` counts — null/false/other truthy values are unmet", () => {
    expect(dodComplete(["a"], ["true"])).toBe(false);
    expect(dodComplete(["a"], [1])).toBe(false);
  });
});

describe("criteriaDelta", () => {
  it("reports satisfied/total counts and the unmet list", () => {
    const out = criteriaDelta(["a", "b", "c"], [true, false, true]);
    expect(out.complete).toBe(false);
    expect(out.satisfied).toBe(2);
    expect(out.total).toBe(3);
    expect(out.unmet).toEqual(["b"]);
  });

  it("complete=true with empty unmet when all ticked", () => {
    const out = criteriaDelta(["a", "b"], [true, true]);
    expect(out.complete).toBe(true);
    expect(out.unmet).toEqual([]);
  });

  it("complete=true when no criteria configured", () => {
    expect(criteriaDelta([], []).complete).toBe(true);
    expect(criteriaDelta(undefined, undefined).complete).toBe(true);
  });
});

describe("criterionKey — stable normalisation", () => {
  it("lowercases and collapses whitespace", () => {
    expect(criterionKey("Code  Review   Completed")).toBe("code review completed");
    expect(criterionKey("  Code Reviewed  ")).toBe("code reviewed");
    expect(criterionKey("Code\tReviewed")).toBe("code reviewed");
  });

  it("returns empty string for null/undefined/empty input", () => {
    expect(criterionKey("")).toBe("");
    expect(criterionKey(undefined as any)).toBe("");
    expect(criterionKey(null as any)).toBe("");
  });
});

describe("isCriterionChecked — dual-shape resolver", () => {
  it("reads legacy positional boolean[] by index", () => {
    expect(isCriterionChecked("any", [true, false], 0)).toBe(true);
    expect(isCriterionChecked("any", [true, false], 1)).toBe(false);
    expect(isCriterionChecked("any", [true, false], 9)).toBe(false); // out of range
  });

  it("reads keyed Record by criterion text", () => {
    const checks = { "code review completed": true, "tests passing": false };
    expect(isCriterionChecked("Code Review Completed", checks, 0)).toBe(true);
    expect(isCriterionChecked("Tests Passing", checks, 1)).toBe(false);
    expect(isCriterionChecked("Not in record", checks, 2)).toBe(false);
  });

  it("only `true` counts in either shape", () => {
    expect(isCriterionChecked("x", [1 as any], 0)).toBe(false);
    expect(isCriterionChecked("x", { x: 1 } as any, 0)).toBe(false);
  });

  it("returns false for null/undefined/non-object checks", () => {
    expect(isCriterionChecked("x", null, 0)).toBe(false);
    expect(isCriterionChecked("x", undefined, 0)).toBe(false);
    expect(isCriterionChecked("x", "string", 0)).toBe(false);
  });
});

describe("dodComplete — works with both shapes", () => {
  const criteria = ["Code reviewed", "Tests passing", "Docs updated"];

  it("legacy positional array — all true", () => {
    expect(dodComplete(criteria, [true, true, true])).toBe(true);
  });

  it("keyed record — all true", () => {
    const checks = {
      "code reviewed": true,
      "tests passing": true,
      "docs updated": true,
    };
    expect(dodComplete(criteria, checks)).toBe(true);
  });

  it("keyed record survives reordering of criteria (the whole point)", () => {
    // Same checks, but the DoD reordered the criteria list.
    const reordered = ["Docs updated", "Code reviewed", "Tests passing"];
    const checks = {
      "code reviewed": true,
      "tests passing": true,
      "docs updated": true,
    };
    expect(dodComplete(reordered, checks)).toBe(true);
  });

  it("legacy positional array breaks on reorder (motivates the keyed shape)", () => {
    // Positional array [true, true, false] meant criterion[2] was unmet.
    // After reorder, criterion[2] is a DIFFERENT criterion — and the
    // array's false now applies to it. Demonstrates the bug we're fixing.
    expect(dodComplete(["a", "b", "c"], [true, true, false])).toBe(false);
    const reordered = ["c", "a", "b"];
    // Same array of checks, but now "c" inherits the true at index 0 —
    // wrong but expected behaviour given the positional shape.
    expect(dodComplete(reordered, [true, true, false])).toBe(false);
  });

  it("keyed record — missing key counts as unticked", () => {
    const checks = { "code reviewed": true, "tests passing": true };
    expect(dodComplete(criteria, checks)).toBe(false); // docs updated absent
  });
});

describe("parseBacklogItems", () => {
  it("extracts PBI-numbered headings (the format the generator actually uses)", () => {
    const md = `# Initial Product Backlog

## Backlog Items

#### PBI-001: Cloud Platform Setup
**User Story:** As a business user...

#### PBI-002: Identity and Access Management
**User Story:** As a system admin...

#### PBI-003: ERP System Integration
Description here.`;
    const out = parseBacklogItems(md);
    expect(out).toEqual([
      { title: "Cloud Platform Setup", pbiRef: "PBI-001", epic: null },
      { title: "Identity and Access Management", pbiRef: "PBI-002", epic: null },
      { title: "ERP System Integration", pbiRef: "PBI-003", epic: null },
    ]);
  });

  it("does not pick up section headings like '### Epic 2' as items", () => {
    // Section headings without a PBI prefix shouldn't be treated as items
    // when ANY PBI-prefixed item exists. The presence of PBI items signals
    // we're in heading-format mode; non-PBI headings are sectioning, not
    // items.
    const md = `### Epic 1: Foundation

#### PBI-001: Cloud Setup

### Epic 2: Legacy Integration

#### PBI-002: ERP Integration`;
    const out = parseBacklogItems(md);
    expect(out.map(i => i.pbiRef)).toEqual(["PBI-001", "PBI-002"]);
  });

  it("attaches the current Epic heading to each PBI item below it", () => {
    // The actual artefact-generator output groups PBI items under Epic
    // sub-headings. Seeded Task rows need to inherit the epic so the
    // Agile Board swimlanes group them the same way the artefact does.
    const md = `# Initial Product Backlog

### Epic 1: Foundation
**Priority:** HIGH

#### PBI-001: Cloud Platform Setup
**User Story:** As a business user...

#### PBI-002: Identity and Access Management
**User Story:** As a system admin...

### Epic 2: Legacy System Integration

#### PBI-003: ERP System Integration
Description.

#### PBI-004: CRM Migration
Description.`;
    const out = parseBacklogItems(md);
    expect(out).toEqual([
      { title: "Cloud Platform Setup",          pbiRef: "PBI-001", epic: "Foundation" },
      { title: "Identity and Access Management", pbiRef: "PBI-002", epic: "Foundation" },
      { title: "ERP System Integration",        pbiRef: "PBI-003", epic: "Legacy System Integration" },
      { title: "CRM Migration",                 pbiRef: "PBI-004", epic: "Legacy System Integration" },
    ]);
  });

  it("resets epic to null when a 'Backlog Items' / 'Uncategorised' catch-all section appears", () => {
    const md = `### Epic 1: Foundation

#### PBI-001: In epic

### Backlog Items

#### PBI-002: No epic`;
    const out = parseBacklogItems(md);
    expect(out).toEqual([
      { title: "In epic", pbiRef: "PBI-001", epic: "Foundation" },
      { title: "No epic", pbiRef: "PBI-002", epic: null },
    ]);
  });

  it("leaves epic null when no Epic headings exist", () => {
    // The artefact may be just a flat list of PBI items with no epic
    // grouping. The parser must not invent epics — Task.epic stays null
    // and the user can categorise manually.
    const md = `#### PBI-001: Cloud Setup
#### PBI-002: Identity`;
    const out = parseBacklogItems(md);
    expect(out.every(i => i.epic === null)).toBe(true);
  });

  it("falls back to markdown tables when no PBI headings present", () => {
    const md = `## Backlog

| ID | Title | Story Points |
|---|---|---|
| PBI-001 | Login screen | 5 |
| PBI-002 | Reset password flow | 8 |`;
    const out = parseBacklogItems(md);
    expect(out).toEqual([
      { title: "Login screen", pbiRef: "PBI-001", epic: null },
      { title: "Reset password flow", pbiRef: "PBI-002", epic: null },
    ]);
  });

  it("falls back to bullets when neither headings nor tables present", () => {
    const md = `## Backlog

- Build the auth flow
- Wire the dashboard
- Ship analytics`;
    const out = parseBacklogItems(md);
    expect(out).toEqual([
      { title: "Build the auth flow", pbiRef: null, epic: null },
      { title: "Wire the dashboard", pbiRef: null, epic: null },
      { title: "Ship analytics", pbiRef: null, epic: null },
    ]);
  });

  it("returns empty when the artefact has prose but no structured items", () => {
    const md = "This is the product backlog. We will build many things.";
    expect(parseBacklogItems(md)).toEqual([]);
  });

  it("dedups case-insensitively within heading format", () => {
    const md = `#### PBI-001: Login Screen
#### PBI-002: login screen
#### PBI-003: Dashboard`;
    const out = parseBacklogItems(md);
    expect(out.map(i => i.title)).toEqual(["Login Screen", "Dashboard"]);
  });

  it("handles bold markers around the heading title", () => {
    const md = "#### **PBI-001: Cloud Setup**";
    expect(parseBacklogItems(md)).toEqual([
      { title: "Cloud Setup", pbiRef: "PBI-001", epic: null },
    ]);
  });

  it("returns empty on null / empty input", () => {
    expect(parseBacklogItems("")).toEqual([]);
    expect(parseBacklogItems(null as unknown as string)).toEqual([]);
  });
});
