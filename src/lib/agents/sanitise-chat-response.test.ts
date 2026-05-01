import { describe, it, expect } from "vitest";
import { sanitiseChatResponse, type PhaseCompletionSnapshot } from "./sanitise-chat-response";
import type { ConfirmedFacts } from "./confirmed-facts";

const emptyFacts: ConfirmedFacts = {
  budget: null,
  currency: null,
  startDate: null,
  endDate: null,
  sponsor: null,
  projectManager: null,
  scope: null,
  methodology: "traditional",
  primaryStakeholders: [],
  sources: {},
};

const notReadyPhase: PhaseCompletionSnapshot = {
  phaseName: "Pre-Project",
  canAdvance: false,
  artefacts: { done: 3, total: 4 },
  pmTasks: { done: 5, total: 6 },
  deliveryTasks: { done: 0, total: 0 },
  requiredArtefactCount: 0,
  aiGeneratableArtefactCount: 4,
};

const readyPhase: PhaseCompletionSnapshot = {
  ...notReadyPhase,
  canAdvance: true,
  artefacts: { done: 4, total: 4 },
  pmTasks: { done: 6, total: 6 },
};

describe("sanitiseChatResponse — phase-complete claims", () => {
  it("rewrites 'phase is now complete' when canAdvance is false", () => {
    const out = sanitiseChatResponse(
      "Pre-Project phase is now complete ✅. Ready for gate approval.",
      emptyFacts,
      notReadyPhase,
    );
    expect(out.content).toContain("[NOT READY");
    expect(out.content).toContain("3/4 artefacts approved");
    expect(out.content).toContain("5/6 PM tasks done");
    expect(out.corrections.some(c => c.kind === "rewrote_phase_complete_claim")).toBe(true);
  });

  it("rewrites 'ready to advance' when canAdvance is false", () => {
    const out = sanitiseChatResponse(
      "All work is done — ready to advance to Initiation.",
      emptyFacts,
      notReadyPhase,
    );
    expect(out.content).not.toContain("ready to advance to Initiation");
    expect(out.corrections.some(c => c.kind === "rewrote_phase_complete_claim")).toBe(true);
  });

  it("rewrites 'all PM tasks are complete' when not actually complete", () => {
    const out = sanitiseChatResponse(
      "All PM tasks are complete and the phase is good to go.",
      emptyFacts,
      notReadyPhase,
    );
    expect(out.content).toContain("[NOT READY");
    expect(out.content).not.toMatch(/all pm tasks are complete/i);
  });

  it("leaves 'phase is complete' alone when canAdvance is true", () => {
    const out = sanitiseChatResponse(
      "Pre-Project phase is now complete ✅",
      emptyFacts,
      readyPhase,
    );
    expect(out.content).toContain("Pre-Project phase is now complete");
    expect(out.corrections.filter(c => c.kind === "rewrote_phase_complete_claim").length).toBe(0);
  });

  it("leaves prose alone when no phase snapshot is provided", () => {
    const out = sanitiseChatResponse(
      "Pre-Project phase is now complete ✅",
      emptyFacts,
      undefined,
    );
    expect(out.content).toContain("Pre-Project phase is now complete");
  });
});

describe("sanitiseChatResponse — required-count claims", () => {
  it("rewrites '3 of 3 required artefacts' when methodology has 0 required", () => {
    const out = sanitiseChatResponse(
      "Status: 3 of 3 required artefacts are APPROVED.",
      emptyFacts,
      notReadyPhase,
    );
    expect(out.content).not.toMatch(/3 of 3 required artefacts/i);
    expect(out.content).toContain("3/4 artefacts generated");
    expect(out.corrections.some(c => c.kind === "rewrote_required_count_claim")).toBe(true);
  });

  it("rewrites '3 required artefacts have been approved'", () => {
    const out = sanitiseChatResponse(
      "Good news: 3 required artefacts have been approved.",
      emptyFacts,
      notReadyPhase,
    );
    expect(out.content).not.toMatch(/3 required artefacts have been approved/i);
  });

  it("preserves a correct required count when it matches the methodology", () => {
    const phase: PhaseCompletionSnapshot = {
      ...notReadyPhase,
      requiredArtefactCount: 3,
      artefacts: { done: 2, total: 3 },
    };
    const out = sanitiseChatResponse(
      "We're at 2 of 3 required artefacts approved.",
      emptyFacts,
      phase,
    );
    expect(out.content).toContain("2 of 3 required artefacts");
  });
});

describe("sanitiseChatResponse — verified-tag stripping (regression)", () => {
  it("still strips [VERIFIED] tags", () => {
    const out = sanitiseChatResponse("Budget: £3,000 [VERIFIED]", emptyFacts);
    expect(out.content).not.toContain("[VERIFIED]");
    expect(out.corrections.some(c => c.kind === "stripped_verified_tag")).toBe(true);
  });
});
