import { describe, it, expect } from "vitest";
import { computeFulfilment, type Artefactish } from "./artefact-fulfillment";

const PRE_PROJECT_CANONICALS = [
  "Problem Statement",
  "Options Analysis",
  "Outline Business Case",
  "Project Brief",
];

describe("computeFulfilment — exact-match scenarios", () => {
  it("counts every approved canonical as approved + covered", () => {
    const items: Artefactish[] = [
      { id: "1", name: "Problem Statement", status: "APPROVED" },
      { id: "2", name: "Options Analysis", status: "APPROVED" },
      { id: "3", name: "Outline Business Case", status: "APPROVED" },
      { id: "4", name: "Project Brief", status: "APPROVED" },
    ];
    const r = computeFulfilment(PRE_PROJECT_CANONICALS, items);
    expect(r.coveredCount).toBe(4);
    expect(r.approvedCount).toBe(4);
    expect(r.missing).toEqual([]);
    expect(r.extras).toHaveLength(0);
  });

  it("counts drafts as covered but not approved", () => {
    const items: Artefactish[] = [
      { id: "1", name: "Problem Statement", status: "DRAFT" },
      { id: "2", name: "Project Brief", status: "APPROVED" },
    ];
    const r = computeFulfilment(PRE_PROJECT_CANONICALS, items);
    expect(r.coveredCount).toBe(2);
    expect(r.approvedCount).toBe(1);
    expect(r.missing.sort()).toEqual(["Options Analysis", "Outline Business Case"]);
  });
});

describe("computeFulfilment — the Griffin / Family Trip screenshot bug", () => {
  it("absorbs 'Project Brief - Family Trip to Lagos' as fulfilling 'Project Brief'", () => {
    const items: Artefactish[] = [
      { id: "1", name: "Problem Statement", status: "DRAFT" },
      { id: "2", name: "Project Brief - Family Trip to Lagos", status: "APPROVED" },
    ];
    const r = computeFulfilment(PRE_PROJECT_CANONICALS, items);
    expect(r.coveredCount).toBe(2);          // not 1
    expect(r.approvedCount).toBe(1);         // not 0 — Project Brief IS approved
    expect(r.missing.sort()).toEqual(["Options Analysis", "Outline Business Case"]);
    expect(r.extras).toHaveLength(0);        // no item counted as "extra"
    // The fulfilment for "Project Brief" should point at the custom-named item.
    const pb = r.fulfilments.find(f => f.canonical === "Project Brief");
    expect(pb?.approved).toBe(true);
    expect(pb?.matches[0].name).toBe("Project Brief - Family Trip to Lagos");
  });
});

describe("computeFulfilment — fuzzy match in both directions", () => {
  it("'Initial Project Brief' fulfils 'Project Brief'", () => {
    const items: Artefactish[] = [
      { id: "1", name: "Initial Project Brief", status: "APPROVED" },
    ];
    const r = computeFulfilment(["Project Brief"], items);
    expect(r.coveredCount).toBe(1);
    expect(r.approvedCount).toBe(1);
  });

  it("'Project Brief' fulfils 'Initial Project Brief' (other direction)", () => {
    const items: Artefactish[] = [
      { id: "1", name: "Project Brief", status: "APPROVED" },
    ];
    const r = computeFulfilment(["Initial Project Brief"], items);
    expect(r.coveredCount).toBe(1);
  });

  it("case-insensitive matching", () => {
    const items: Artefactish[] = [
      { id: "1", name: "PROJECT BRIEF — Family Trip", status: "APPROVED" },
    ];
    const r = computeFulfilment(["Project Brief"], items);
    expect(r.coveredCount).toBe(1);
  });
});

describe("computeFulfilment — extras + rejected", () => {
  it("items that match nothing surface as extras", () => {
    const items: Artefactish[] = [
      { id: "1", name: "Custom Marketing Plan", status: "APPROVED" },
      { id: "2", name: "Problem Statement", status: "DRAFT" },
    ];
    const r = computeFulfilment(PRE_PROJECT_CANONICALS, items);
    expect(r.coveredCount).toBe(1);
    expect(r.extras).toHaveLength(1);
    expect(r.extras[0].name).toBe("Custom Marketing Plan");
  });

  it("REJECTED items don't count as covered", () => {
    const items: Artefactish[] = [
      { id: "1", name: "Problem Statement", status: "REJECTED" },
    ];
    const r = computeFulfilment(["Problem Statement"], items);
    const f = r.fulfilments[0];
    expect(f.covered).toBe(false);
    expect(f.approved).toBe(false);
    // But the rejected item is still in matches so the UI can see it.
    expect(f.matches).toHaveLength(1);
  });

  it("APPROVED status wins ordering when multiple match the same canonical", () => {
    const items: Artefactish[] = [
      { id: "draft", name: "Project Brief draft v1", status: "DRAFT" },
      { id: "approved", name: "Project Brief - Final", status: "APPROVED" },
    ];
    const r = computeFulfilment(["Project Brief"], items);
    expect(r.fulfilments[0].matches[0].id).toBe("approved");
    expect(r.fulfilments[0].matches[1].id).toBe("draft");
  });
});