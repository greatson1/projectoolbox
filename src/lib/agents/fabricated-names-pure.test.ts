import { describe, it, expect } from "vitest";
import { looksLikeFabricatedName, looksLikePlaceholderName } from "./fabricated-names-pure";

describe("looksLikePlaceholderName — Griffin screenshot bugs", () => {
  it("rejects 'To Be Assigned' (the screenshot bug)", () => {
    expect(looksLikePlaceholderName("To Be Assigned")).toBe(true);
  });

  it("rejects 'to be assigned' (case-insensitive)", () => {
    expect(looksLikePlaceholderName("to be assigned")).toBe(true);
  });

  it("rejects 'approval Dependencies' (category noun)", () => {
    expect(looksLikePlaceholderName("approval Dependencies")).toBe(true);
    expect(looksLikePlaceholderName("Approval Dependencies")).toBe(true);
  });

  it("rejects every TBC / TBA / TBD spelling", () => {
    expect(looksLikePlaceholderName("TBC")).toBe(true);
    expect(looksLikePlaceholderName("TBA")).toBe(true);
    expect(looksLikePlaceholderName("TBD")).toBe(true);
    expect(looksLikePlaceholderName("T.B.D.")).toBe(true);
    expect(looksLikePlaceholderName("[TBC]")).toBe(true);
    expect(looksLikePlaceholderName("[TBD]")).toBe(true);
  });

  it("rejects 'To Be Confirmed' / 'To Be Decided' / etc.", () => {
    expect(looksLikePlaceholderName("To Be Confirmed")).toBe(true);
    expect(looksLikePlaceholderName("To Be Decided")).toBe(true);
    expect(looksLikePlaceholderName("To Be Determined")).toBe(true);
    expect(looksLikePlaceholderName("To Be Announced")).toBe(true);
    expect(looksLikePlaceholderName("To Be Hired")).toBe(true);
  });

  it("rejects 'Unassigned' / 'Not Assigned' / 'Pending'", () => {
    expect(looksLikePlaceholderName("Unassigned")).toBe(true);
    expect(looksLikePlaceholderName("Not Assigned")).toBe(true);
    expect(looksLikePlaceholderName("Pending")).toBe(true);
    expect(looksLikePlaceholderName("Pending Approval")).toBe(true);
    expect(looksLikePlaceholderName("Pending Assignment")).toBe(true);
  });

  it("rejects category nouns commonly scraped from artefact prose", () => {
    expect(looksLikePlaceholderName("Approval Dependencies")).toBe(true);
    expect(looksLikePlaceholderName("Project Requirements")).toBe(true);
    expect(looksLikePlaceholderName("Key Deliverables")).toBe(true);
    expect(looksLikePlaceholderName("Quality Standards")).toBe(true);
    expect(looksLikePlaceholderName("Gate Criteria")).toBe(true);
  });

  it("rejects N/A and similar nullish strings", () => {
    expect(looksLikePlaceholderName("N/A")).toBe(true);
    expect(looksLikePlaceholderName("n/a")).toBe(true);
    expect(looksLikePlaceholderName("None")).toBe(true);
    expect(looksLikePlaceholderName("null")).toBe(true);
    expect(looksLikePlaceholderName("---")).toBe(true);
  });

  it("ACCEPTS real-looking person names", () => {
    expect(looksLikePlaceholderName("Ty Beetseh")).toBe(false);
    expect(looksLikePlaceholderName("Sarah Chen")).toBe(false);
    expect(looksLikePlaceholderName("Dr Ada Lovelace")).toBe(false);
    expect(looksLikePlaceholderName("Jean-Paul Sartre")).toBe(false);
  });

  it("ACCEPTS proper role titles (those go through a different filter)", () => {
    // Role titles like "Project Manager" are explicitly NOT placeholders —
    // the deploy wizard wants them on the Stakeholder Register when no
    // named individual exists yet. The fabricated-name filter handles
    // these separately.
    expect(looksLikePlaceholderName("Project Manager")).toBe(false);
    expect(looksLikePlaceholderName("Executive Sponsor")).toBe(false);
  });

  it("handles null / undefined / blank", () => {
    expect(looksLikePlaceholderName(null)).toBe(false);
    expect(looksLikePlaceholderName(undefined)).toBe(false);
    expect(looksLikePlaceholderName("")).toBe(false);
    expect(looksLikePlaceholderName("   ")).toBe(false);
  });
});

describe("looksLikeFabricatedName — regression coverage", () => {
  it("catches FirstName-LastName patterns", () => {
    expect(looksLikeFabricatedName("Sarah Mitchell")).toBe(true);
    expect(looksLikeFabricatedName("Marcus Chen")).toBe(true);
  });

  it("does NOT flag role titles (they pass)", () => {
    expect(looksLikeFabricatedName("Project Manager")).toBe(false);
    expect(looksLikeFabricatedName("Executive Sponsor")).toBe(false);
  });

  it("does NOT flag single names (too short)", () => {
    expect(looksLikeFabricatedName("Sarah")).toBe(false);
  });
});
