import { describe, it, expect } from "vitest";
import { inferLinkedEventMarker, backfillDescription } from "./scaffolded-task-backfill";

describe("inferLinkedEventMarker", () => {
  const cases: Array<{ title: string; expected: string | null }> = [
    { title: "Review and update Risk Register", expected: "[event:risk_register_updated]" },
    { title: "Stakeholder communication and updates", expected: "[event:stakeholder_updated]" },
    { title: "Conduct clarification Q&A with project owner", expected: "[event:clarification_complete]" },
    { title: "Submit Phase 1 gate approval", expected: "[event:gate_request]" },
    { title: "Submit Sprint Zero gate approval", expected: "[event:gate_request]" },
    { title: "Obtain approval for all Phase 1 artefacts", expected: "[event:phase_advanced]" },
    { title: "Generate Project Brief", expected: null }, // artefact tasks aren't event-linked
    { title: "Random task", expected: null },
  ];

  for (const c of cases) {
    it(`maps "${c.title}" → ${c.expected ?? "null"}`, () => {
      expect(inferLinkedEventMarker(c.title)).toBe(c.expected);
    });
  }
});

describe("backfillDescription", () => {
  it("appends the marker when description has [scaffolded] but no event tag", () => {
    const out = backfillDescription("Review and update Risk Register", "[scaffolded]");
    expect(out).toBe("[scaffolded] [event:risk_register_updated]");
  });

  it("returns null when the description already carries the same marker (idempotent)", () => {
    const out = backfillDescription(
      "Review and update Risk Register",
      "[scaffolded] [event:risk_register_updated]",
    );
    expect(out).toBeNull();
  });

  it("returns null when the description already carries a different event marker", () => {
    // Don't overwrite — title rule could be wrong; safer to leave alone.
    const out = backfillDescription(
      "Review and update Risk Register",
      "[scaffolded] [event:custom_thing]",
    );
    expect(out).toBeNull();
  });

  it("seeds [scaffolded] when description is empty", () => {
    const out = backfillDescription("Stakeholder communication and updates", "");
    expect(out).toBe("[scaffolded] [event:stakeholder_updated]");
  });

  it("returns null for titles that don't match any rule (e.g. artefact tasks)", () => {
    expect(backfillDescription("Generate Project Brief", "[scaffolded]")).toBeNull();
  });

  it("preserves existing description text when appending", () => {
    const out = backfillDescription(
      "Conduct clarification Q&A with project owner",
      "[scaffolded] human note here",
    );
    expect(out).toBe("[scaffolded] human note here [event:clarification_complete]");
  });
});
