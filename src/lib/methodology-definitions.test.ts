/**
 * Travel methodology smoke tests.
 *
 * Locks in:
 *  - the Travel & Trip methodology is registered
 *  - its phases are Plan → Book → Travel → Wrap-up
 *  - its Plan-phase prereqs can ALL be auto-evaluated against a populated
 *    project (no surprise "everything is manual" experience for a user
 *    running a family trip)
 *  - getMethodology("travel") returns it; case-insensitive lookups work
 *
 * Catches regressions where someone removes the registry entry or
 * renames a phase without updating the playbook order.
 */

import { describe, it, expect } from "vitest";
import {
  getMethodology,
  getMethodologyLabel,
  toMethodologyEnum,
  METHODOLOGIES,
} from "./methodology-definitions";
import {
  evaluatePrerequisite,
  summarisePrerequisites,
  type PrerequisiteEvalContext,
} from "./agents/phase-prerequisites";

describe("Travel methodology", () => {
  it("is registered under id 'travel'", () => {
    expect(METHODOLOGIES.travel).toBeDefined();
    expect(getMethodology("travel").id).toBe("travel");
    expect(getMethodology("TRAVEL").id).toBe("travel"); // case-insensitive
  });

  it("has Plan → Book → Travel → Wrap-up phases in order", () => {
    const phases = getMethodology("travel").phases.map(p => p.name);
    expect(phases).toEqual(["Plan", "Book", "Travel", "Wrap-up"]);
  });

  it("does NOT include sprint / DoD / business-case artefacts", () => {
    // The whole point of adding this methodology was to stop forcing
    // agile/governance artefacts on trips — if any of these creep into
    // a Travel phase, the user is back to "What is the compliance lead?"
    // questions on a family holiday.
    const everyArtefact = getMethodology("travel").phases.flatMap(p =>
      p.artefacts.map(a => a.name.toLowerCase()),
    );
    expect(everyArtefact).not.toContain("sprint plans");
    expect(everyArtefact).not.toContain("definition of done");
    expect(everyArtefact).not.toContain("business case");
    expect(everyArtefact).not.toContain("outline business case");
    expect(everyArtefact).not.toContain("team charter");
    expect(everyArtefact).not.toContain("burndown chart");
  });

  it("Plan-phase prereqs are all auto-evaluable when project state is populated", () => {
    // Simulate a Lagos family trip mid-Plan-phase: Cost Plan + Risk Register
    // approved, Stakeholder Register has a Primary Traveller. Every Plan
    // prereq should evaluate to "met" (none stuck on "manual"), so the
    // user isn't asked to manually tick something the agent already
    // delivered evidence for.
    const ctx: PrerequisiteEvalContext = {
      approvedArtefactNames: [
        "Cost Management Plan",
        "Initial Risk Register",
        "Initial Stakeholder Register",
      ],
      rejectedArtefactNames: [],
      draftArtefactNames: [],
      stakeholderRoles: ["Primary Traveller", "Airline", "Hotel"],
      approvedPhaseGateNames: [],
      hasRisks: true,
    };
    const planPhase = getMethodology("travel").phases.find(p => p.name === "Plan")!;
    const evals = planPhase.gate.preRequisites.map(p =>
      evaluatePrerequisite(p, ctx),
    );
    const states = evals.map(e => e.state);
    expect(states).not.toContain("manual"); // Every prereq must auto-tick.
    expect(states).not.toContain("unmet");
    const sum = summarisePrerequisites(evals);
    expect(sum.canAdvance).toBe(true);
  });
});

describe("getMethodologyLabel — UI display normalisation", () => {
  // Original bug: a user picked "Traditional" and the agents-list badge
  // showed "PRINCE2" because that page read project.methodology directly
  // without going through METHOD_LABEL. The label map was duplicated in
  // 7 pages and none knew about new methodologies (e.g. travel) — they
  // drifted. These tests lock the single source of truth so any future
  // page that calls getMethodologyLabel gets the right answer.

  it("maps every legacy Prisma enum value to its UI label", () => {
    expect(getMethodologyLabel("PRINCE2")).toBe("Traditional");
    expect(getMethodologyLabel("WATERFALL")).toBe("Waterfall");
    expect(getMethodologyLabel("AGILE_SCRUM")).toBe("Scrum");
    expect(getMethodologyLabel("AGILE_KANBAN")).toBe("Kanban");
    expect(getMethodologyLabel("HYBRID")).toBe("Hybrid");
    expect(getMethodologyLabel("SAFE")).toBe("SAFe");
  });

  it("maps the new canonical enum values to UI labels", () => {
    expect(getMethodologyLabel("TRADITIONAL")).toBe("Traditional");
    expect(getMethodologyLabel("TRAVEL")).toBe("Travel & Trip");
  });

  it("maps canonical lowercase ids", () => {
    expect(getMethodologyLabel("traditional")).toBe("Traditional");
    expect(getMethodologyLabel("travel")).toBe("Travel & Trip");
    expect(getMethodologyLabel("scrum")).toBe("Scrum");
    expect(getMethodologyLabel("kanban")).toBe("Kanban");
    expect(getMethodologyLabel("safe")).toBe("SAFe");
  });

  it("handles null / undefined / empty without crashing", () => {
    expect(getMethodologyLabel(null)).toBe("Unknown");
    expect(getMethodologyLabel(undefined)).toBe("Unknown");
    expect(getMethodologyLabel("")).toBe("Unknown");
  });

  it("falls back to the raw input for genuinely unknown values", () => {
    expect(getMethodologyLabel("CUSTOM_FRAMEWORK")).toBe("CUSTOM_FRAMEWORK");
  });
});

describe("toMethodologyEnum — DB write normalisation", () => {
  // Original bug: the deploy wizard sent "traditional" and the projects
  // POST route mapped it to "PRINCE2" (the legacy enum value), which
  // leaked into every read path that didn't translate back. The same
  // function used to silently accept "scrum" / "kanban" — which the
  // reset-lifecycle path also did via .toUpperCase() — and write
  // invalid enum values that would crash at the DB layer. And it had
  // no "travel" entry at all, so Travel methodology silently bucketed
  // as WATERFALL. This test locks the new behaviour: every supported
  // methodology has a canonical enum target, no PRINCE2 writes for
  // new Traditional rows, and unknown inputs return null so the
  // caller can decide the default.

  it("traditional ids map to TRADITIONAL (not PRINCE2)", () => {
    expect(toMethodologyEnum("traditional")).toBe("TRADITIONAL");
    expect(toMethodologyEnum("Traditional")).toBe("TRADITIONAL");
    expect(toMethodologyEnum("TRADITIONAL")).toBe("TRADITIONAL");
    // Legacy PRINCE2 input still maps to TRADITIONAL (idempotent),
    // so a legacy row passed through this helper round-trips correctly.
    expect(toMethodologyEnum("prince2")).toBe("TRADITIONAL");
    expect(toMethodologyEnum("PRINCE2")).toBe("TRADITIONAL");
  });

  it("travel ids map to TRAVEL (previously silently fell back to WATERFALL)", () => {
    expect(toMethodologyEnum("travel")).toBe("TRAVEL");
    expect(toMethodologyEnum("Travel")).toBe("TRAVEL");
    expect(toMethodologyEnum("TRAVEL")).toBe("TRAVEL");
  });

  it("scrum / kanban shortforms map to AGILE_ enum values", () => {
    // Previously reset-lifecycle did .toUpperCase() → "SCRUM" / "KANBAN"
    // which the Prisma enum did NOT have, so writes silently failed.
    expect(toMethodologyEnum("scrum")).toBe("AGILE_SCRUM");
    expect(toMethodologyEnum("agile")).toBe("AGILE_SCRUM");
    expect(toMethodologyEnum("SCRUM")).toBe("AGILE_SCRUM");
    expect(toMethodologyEnum("kanban")).toBe("AGILE_KANBAN");
    expect(toMethodologyEnum("KANBAN")).toBe("AGILE_KANBAN");
  });

  it("waterfall / hybrid / safe round-trip correctly", () => {
    expect(toMethodologyEnum("waterfall")).toBe("WATERFALL");
    expect(toMethodologyEnum("hybrid")).toBe("HYBRID");
    expect(toMethodologyEnum("safe")).toBe("SAFE");
  });

  it("returns null for unknown values so caller can pick a default", () => {
    expect(toMethodologyEnum("custom-framework")).toBeNull();
    expect(toMethodologyEnum("")).toBeNull();
    expect(toMethodologyEnum(null)).toBeNull();
    expect(toMethodologyEnum(undefined)).toBeNull();
  });
});
