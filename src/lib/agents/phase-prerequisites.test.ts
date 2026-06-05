import { describe, it, expect } from "vitest";
import {
  evaluatePrerequisite,
  evaluatePrerequisites,
  summarisePrerequisites,
  type PrerequisiteEvalContext,
} from "./phase-prerequisites";

const baseCtx: PrerequisiteEvalContext = {
  approvedArtefactNames: [],
  rejectedArtefactNames: [],
  draftArtefactNames: [],
  stakeholderRoles: [],
  approvedPhaseGateNames: [],
  hasRisks: false,
};

const prereq = (overrides: Partial<{ description: string; isMandatory: boolean }>) => ({
  description: "Project Brief reviewed and accepted",
  category: "review" as const,
  isMandatory: true,
  requiresHumanApproval: false,
  ...overrides,
});

describe("evaluatePrerequisite — artefact-driven", () => {
  it("met when the named artefact is approved", () => {
    const out = evaluatePrerequisite(prereq({}), {
      ...baseCtx,
      approvedArtefactNames: ["Project Brief"],
    });
    expect(out.state).toBe("met");
    expect(out.evidence).toContain("APPROVED");
  });

  it("rejected when the named artefact has been rejected", () => {
    const out = evaluatePrerequisite(prereq({}), {
      ...baseCtx,
      rejectedArtefactNames: ["Project Brief"],
    });
    expect(out.state).toBe("rejected");
    expect(out.evidence).toContain("REJECTED");
  });

  it("draft when the named artefact exists but is not approved", () => {
    const out = evaluatePrerequisite(prereq({}), {
      ...baseCtx,
      draftArtefactNames: ["Project Brief"],
    });
    expect(out.state).toBe("draft");
  });

  it("unmet when the named artefact does not exist", () => {
    const out = evaluatePrerequisite(prereq({}), baseCtx);
    expect(out.state).toBe("unmet");
    expect(out.evidence).toContain("not yet generated");
  });

  it("matches the longer artefact name first (Outline Business Case beats Business Case)", () => {
    // The "Outline Business Case" entry comes before "Business Case" in our keyword
    // list specifically so we don't false-positive a generic phrase. Here the
    // approved list has Outline only — should still match because the prereq
    // text matches Outline.
    const out = evaluatePrerequisite(prereq({ description: "Outline Business Case approved by sponsor" }), {
      ...baseCtx,
      approvedArtefactNames: ["Outline Business Case"],
    });
    expect(out.state).toBe("met");
    expect(out.evidence).toContain("Outline Business Case");
  });
});

describe("evaluatePrerequisite — stakeholders, risks, gates, manual", () => {
  it("met when a sponsor stakeholder is on the register", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Sponsor identified and confirmed" }),
      { ...baseCtx, stakeholderRoles: ["Project Sponsor"] },
    );
    expect(out.state).toBe("met");
  });

  it("unmet when no sponsor is on the register", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Sponsor identified and confirmed" }),
      baseCtx,
    );
    expect(out.state).toBe("unmet");
    expect(out.evidence).toContain("sponsor");
  });

  it("met when a HIGH_TRUST KB fact mentions sponsor (chat-confirmation path)", () => {
    // The chat-agent answer-capture path stores a sponsor confirmation as a
    // KB fact titled "Project Sponsor", not as a Stakeholder Register row.
    // This test locks in that the prereq evaluator consults both surfaces.
    const out = evaluatePrerequisite(
      prereq({ description: "Sponsor identified and confirmed" }),
      { ...baseCtx, confirmedFactTitles: ["project sponsor"] },
    );
    expect(out.state).toBe("met");
    expect(out.evidence?.toLowerCase()).toContain("chat");
  });

  it("met when risks have been logged", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Initial risks identified and assessed" }),
      { ...baseCtx, hasRisks: true },
    );
    expect(out.state).toBe("met");
  });

  it("unmet when no risks have been logged", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Initial risks identified and assessed" }),
      baseCtx,
    );
    expect(out.state).toBe("unmet");
  });

  it("met when a developer is on the register — 'Team capacity established'", () => {
    // Scrum Sprint Zero gate. Without broadening the verb list this fell
    // through to manual even when the Stakeholder Register clearly had a
    // delivery team on it.
    const out = evaluatePrerequisite(
      prereq({ description: "Team capacity established" }),
      { ...baseCtx, stakeholderRoles: ["Developer", "QA Engineer"] },
    );
    expect(out.state).toBe("met");
  });

  it("met when a Scrum Master is on the register — 'Team identified'", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Team identified" }),
      { ...baseCtx, stakeholderRoles: ["Scrum Master", "Product Owner"] },
    );
    expect(out.state).toBe("met");
  });

  it("unmet when description says 'Team capacity' but register has only PM + sponsor", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Team capacity established" }),
      { ...baseCtx, stakeholderRoles: ["Project Manager", "Sponsor"] },
    );
    expect(out.state).toBe("unmet");
  });

  it("manual when nothing matches — falls back so the user can tick it", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Office space allocated for the project" }),
      baseCtx,
    );
    expect(out.state).toBe("manual");
  });
});

describe("evaluatePrerequisite — manual confirmation override", () => {
  it("forces 'met' when the prereq is in manuallyConfirmed, even if otherwise unmet", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Office space allocated" }),
      {
        ...baseCtx,
        phaseName: "Pre-Project",
        manuallyConfirmed: new Set(["Pre-Project::Office space allocated"]),
      },
    );
    expect(out.state).toBe("met");
    expect(out.manuallyConfirmed).toBe(true);
    expect(out.evidence).toBe("Manually confirmed");
  });

  it("manual confirmation overrides a draft state too", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Project Brief reviewed and accepted" }),
      {
        ...baseCtx,
        draftArtefactNames: ["Project Brief"],
        phaseName: "Requirements",
        manuallyConfirmed: new Set(["Requirements::Project Brief reviewed and accepted"]),
      },
    );
    expect(out.state).toBe("met");
    expect(out.manuallyConfirmed).toBe(true);
  });

  it("does not affect prereqs from other phases", () => {
    // Confirmation is scoped to one phase. A confirmation under Initiation
    // should NOT auto-tick a prereq with the same description under Closure.
    const out = evaluatePrerequisite(
      prereq({ description: "Office space allocated" }),
      {
        ...baseCtx,
        phaseName: "Closure",
        manuallyConfirmed: new Set(["Initiation::Office space allocated"]),
      },
    );
    expect(out.state).toBe("manual");
    expect(out.manuallyConfirmed).not.toBe(true);
  });
});

describe("summarisePrerequisites", () => {
  it("canAdvance when every mandatory prereq is met and none manual", () => {
    const evals = evaluatePrerequisites(
      [prereq({}), prereq({ description: "Sponsor identified" })],
      { ...baseCtx, approvedArtefactNames: ["Project Brief"], stakeholderRoles: ["Sponsor"] },
    );
    const sum = summarisePrerequisites(evals);
    expect(sum.canAdvance).toBe(true);
    expect(sum.met).toBe(2);
    expect(sum.blockers).toBe(0);
  });

  it("blocks advancement when a mandatory prereq is unmet", () => {
    const evals = evaluatePrerequisites(
      [prereq({}), prereq({ description: "Sponsor identified" })],
      { ...baseCtx, approvedArtefactNames: ["Project Brief"] },
    );
    const sum = summarisePrerequisites(evals);
    expect(sum.canAdvance).toBe(false);
    expect(sum.blockers).toBe(1);
  });

  it("treats manual prereqs as blocking advancement until the user ticks them", () => {
    const evals = evaluatePrerequisites(
      [prereq({ description: "Funding confirmed" })],
      baseCtx,
    );
    const sum = summarisePrerequisites(evals);
    expect(sum.manual).toBe(1);
    expect(sum.canAdvance).toBe(false);
  });
});

describe("evaluatePrerequisite — travel methodology prereqs", () => {
  // The Travel methodology adds Plan-gate prereqs that none of the
  // pre-existing rules picked up. These tests lock the new branches in
  // so a future refactor of the artefact-keyword / role-hint maps can't
  // silently regress a Lagos family trip back to all-manual prereqs.

  it("'Travellers confirmed' ticks when Stakeholder Register has Primary Traveller", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Travellers confirmed" }),
      { ...baseCtx, stakeholderRoles: ["Primary Traveller", "Travel Insurance Provider"] },
    );
    expect(out.state).toBe("met");
    expect(out.evidence).toMatch(/traveller/i);
  });

  it("'Travellers confirmed' falls to unmet when no traveller in the register", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Travellers confirmed" }),
      { ...baseCtx, stakeholderRoles: ["Airline", "Hotel"] },
    );
    expect(out.state).toBe("unmet");
  });

  it("'Budget agreed' ticks when Cost Management Plan is approved", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Budget agreed" }),
      { ...baseCtx, approvedArtefactNames: ["Cost Management Plan"] },
    );
    expect(out.state).toBe("met");
    expect(out.evidence).toContain("Cost Management Plan");
  });

  it("'Budget agreed' marked draft when Cost Plan is in DRAFT", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Budget agreed" }),
      { ...baseCtx, draftArtefactNames: ["Cost Management Plan"] },
    );
    expect(out.state).toBe("draft");
  });

  it("'Budget agreed' stays manual when no Cost Plan exists yet", () => {
    const out = evaluatePrerequisite(
      prereq({ description: "Budget agreed" }),
      baseCtx,
    );
    expect(out.state).toBe("manual");
  });

  it("'Lessons learned captured' ticks when Lessons Learned artefact is approved", () => {
    // Previously failed: the artefact list had only "Lessons Learnt Report"
    // (British spelling). The travel/hybrid methodology calls it
    // "Lessons Learned" — without both spellings the prereq fell through
    // to manual even when the artefact was approved.
    const out = evaluatePrerequisite(
      prereq({ description: "Lessons learned captured" }),
      { ...baseCtx, approvedArtefactNames: ["Lessons Learned"] },
    );
    expect(out.state).toBe("met");
  });

  it("'Risk register populated' still ticks via the existing risk rule", () => {
    // Regression — the new budget-rules branch sits BEFORE the
    // stakeholder/risk branches; make sure it doesn't shadow them.
    const out = evaluatePrerequisite(
      prereq({ description: "Risk register populated" }),
      { ...baseCtx, approvedArtefactNames: ["Initial Risk Register"] },
    );
    expect(out.state).toBe("met");
  });
});
