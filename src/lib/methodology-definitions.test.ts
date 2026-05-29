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
import { getMethodology, METHODOLOGIES } from "./methodology-definitions";
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
