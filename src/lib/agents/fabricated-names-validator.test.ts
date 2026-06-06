import { describe, it, expect } from "vitest";
import { validateArtefactNames } from "./fabricated-names-validator";

const emptyRegistry = { people: [], organisations: [], rolePlaceholders: [] };

describe("validateArtefactNames", () => {
  it("flags a plausible person name when the registry is empty", () => {
    const out = validateArtefactNames({
      content: "The sponsor for this project is Sarah Mitchell from Acme Bank.",
      registry: emptyRegistry,
    });
    expect(out.some(v => v.name === "Sarah Mitchell")).toBe(true);
  });

  it("does not flag a name already in the registry", () => {
    const out = validateArtefactNames({
      content: "Sarah Mitchell signed off on the budget.",
      registry: { ...emptyRegistry, people: ["Sarah Mitchell"] },
    });
    expect(out.some(v => v.name === "Sarah Mitchell")).toBe(false);
  });

  it("does not flag the project's own name when it's in the registry", () => {
    // Mirror what getAllowedNamesRegistry does: add the project name's
    // n-grams to people[].
    const out = validateArtefactNames({
      content: "The Digital Transformation Initiative delivers cloud platform setup.",
      registry: {
        ...emptyRegistry,
        people: ["Digital Transformation", "Transformation Initiative", "Digital Transformation Initiative"],
      },
    });
    expect(out.some(v => v.name === "Digital Transformation")).toBe(false);
    expect(out.some(v => v.name === "Digital Transformation Initiative")).toBe(false);
  });

  it("does not flag concept phrases starting with a STOP_PREFIX word", () => {
    // These all start with words now in the extended STOP_PREFIXES.
    const out = validateArtefactNames({
      content: `
        Strategic Objectives are defined.
        Business Value will be measured.
        Technical Outcomes include cloud migration.
        Status Modernise is the active phase.
        Target Outcomes are tracked.
        Key Success metrics: uptime and CSAT.
        Vision Statement: cloud-first by 2027.
        Product Vision drives the backlog.
        Awaiting Approval — Sprint Zero gate.
        Not Started — Sprint Two.
        Category Specific gates apply.
        Measure Target reviewed monthly.
        Continuous Integration enabled.
        Operational Excellence is core.
        Quality Management Plan attached.
        Technical Architect is a role.
        Scrum Master leads the team.
      `,
      registry: emptyRegistry,
    });
    const flaggedNames = out.map(v => v.name);
    // None of these should appear in the violations list.
    const concepts = [
      "Strategic Objectives", "Business Value", "Technical Outcomes",
      "Status Modernise", "Target Outcomes", "Key Success", "Vision Statement",
      "Product Vision", "Awaiting Approval", "Not Started",
      "Category Specific", "Measure Target", "Continuous Integration",
      "Operational Excellence", "Quality Management",
      "Technical Architect", "Scrum Master",
    ];
    for (const c of concepts) {
      expect(flaggedNames, `concept phrase "${c}" should not be flagged`).not.toContain(c);
    }
  });

  it("still flags a clear two-word person name even amid concept phrases", () => {
    // Regression guard — the extensions above must not blow a hole big
    // enough for a real fabricated name to walk through.
    const out = validateArtefactNames({
      content: "Strategic Objectives drafted by Robert Chen, Technical Architect.",
      registry: emptyRegistry,
    });
    expect(out.some(v => v.name === "Robert Chen")).toBe(true);
  });

  it("respects the 25-violation cap so the UI never drowns", () => {
    // Generate 30 distinct plausible names and confirm we cap output at 25.
    const names = Array.from({ length: 30 }, (_, i) => `Person${String.fromCharCode(65 + i)} Smith${i}`);
    const content = names.join(". ") + ".";
    // The name shape `PersonX SmithN` won't match the proper-name regex
    // (digits in the second word), so we craft alphabetical variants.
    const realisticNames = Array.from({ length: 30 }, (_, i) =>
      `${String.fromCharCode(65 + i)}aron Smithers${String.fromCharCode(97 + i)}`,
    );
    const realisticContent = realisticNames.join(". ") + ".";
    const out = validateArtefactNames({
      content: realisticContent || content,
      registry: emptyRegistry,
    });
    expect(out.length).toBeLessThanOrEqual(25);
  });
});
