import { describe, it, expect } from "vitest";
import { cleanAssignee, isImplausibleAssignee } from "./assignee-plausibility";

describe("cleanAssignee", () => {
  it("keeps real role/person labels", () => {
    for (const ok of ["Project Manager", "Sponsor", "Sarah", "BA Lead", "User-added", "Scrum Master"]) {
      expect(cleanAssignee(ok)).toBe(ok);
    }
  });

  it("rejects the document-control junk that triggered this", () => {
    expect(cleanAssignee("Methodology Scrum Team Charter")).toBeNull();
    expect(cleanAssignee("Draft — Awaiting Approval")).toBeNull();
    expect(cleanAssignee("Version 1.0")).toBeNull();
  });

  it("rejects placeholders and empties", () => {
    for (const junk of ["", "  ", "TBC", "TBD", "[TBC — owner]", "N/A", "—", "-"]) {
      expect(cleanAssignee(junk)).toBeNull();
    }
  });

  it("rejects over-long / many-word fragments (concatenated cells)", () => {
    expect(cleanAssignee("a".repeat(51))).toBeNull();
    expect(cleanAssignee("one two three four five six")).toBeNull();
  });
});

describe("isImplausibleAssignee", () => {
  it("is true only for non-empty junk", () => {
    expect(isImplausibleAssignee("Methodology Scrum Team Charter")).toBe(true);
    expect(isImplausibleAssignee("TBC")).toBe(true);
    expect(isImplausibleAssignee("Project Manager")).toBe(false);
    // Empty is "no assignee", not "implausible assignee" — don't flag it.
    expect(isImplausibleAssignee("")).toBe(false);
    expect(isImplausibleAssignee(null)).toBe(false);
  });
});
