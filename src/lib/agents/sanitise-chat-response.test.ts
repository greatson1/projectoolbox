import { describe, it, expect } from "vitest";
import { sanitiseChatResponse, stripContextMarkerLeaks, type PhaseCompletionSnapshot } from "./sanitise-chat-response";
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

describe("sanitiseChatResponse — leaked context markers (regression)", () => {
  // The chat-stream feeds Claude an inbound history wrapped in <prior_*>
  // XML tags and legacy [I asked the user]: "..." prose. Claude occasionally
  // echoes these formats in its own replies; the sanitiser is the third
  // line of defense (after the system-prompt rule and the rehydration
  // format change) so a single slip never reaches the user-facing chat UI.

  it("strips a leaked <prior_question> tag", () => {
    const out = sanitiseChatResponse(
      `<prior_question idx="3/20" options="A | B | C">What is the comms method?</prior_question> Here is my next thought.`,
      emptyFacts,
    );
    expect(out.content).not.toMatch(/prior_question/i);
    expect(out.content).toContain("Here is my next thought.");
    expect(out.corrections.some(c => c.kind === "stripped_context_marker_leak")).toBe(true);
  });

  it("strips a leaked <prior_clarification> tag", () => {
    const out = sanitiseChatResponse(
      `<prior_clarification idx="1/5">Who is the compliance lead?</prior_clarification>`,
      emptyFacts,
    );
    expect(out.content).not.toMatch(/prior_clarification/i);
    expect(out.content).not.toContain("Who is the compliance lead?");
  });

  it("strips a leaked <prior_event ... /> self-closing tag", () => {
    const out = sanitiseChatResponse(
      `Sure thing. <prior_event kind="project_status" project="Acme" phase="Pre-Project"/> What else?`,
      emptyFacts,
    );
    expect(out.content).not.toMatch(/prior_event/i);
    expect(out.content).toContain("Sure thing.");
    expect(out.content).toContain("What else?");
  });

  it("strips nested <effect> children that survive after the wrapper", () => {
    const out = sanitiseChatResponse(
      `Done. <effect status="ok">Created task</effect> <effect status="failed">DB write</effect>`,
      emptyFacts,
    );
    expect(out.content).not.toMatch(/<\/?effect/i);
    expect(out.content).toContain("Done.");
  });

  it("strips the legacy [I asked the user]: \"...\" prose with options", () => {
    const out = sanitiseChatResponse(
      `[I asked the user]: "What should be the primary communication method for reaching the development team?" (options: Daily stand-ups + Slack, Email updates, Team meetings, Microsoft Teams)`,
      emptyFacts,
    );
    expect(out.content).not.toMatch(/I asked the user/i);
    expect(out.content).not.toContain("Daily stand-ups");
    expect(out.corrections.some(c => c.kind === "stripped_context_marker_leak")).toBe(true);
  });

  it("strips legacy [I posted ...] and [I flagged ...] forms", () => {
    const out = sanitiseChatResponse(
      `Earlier: [I posted a project status card for "Acme"] and [I flagged a pending decision for the user to confirm: "approve"]. Continuing now.`,
      emptyFacts,
    );
    expect(out.content).not.toMatch(/\[I posted/i);
    expect(out.content).not.toMatch(/\[I flagged/i);
    expect(out.content).toContain("Continuing now.");
  });

  // Broadened verb coverage — the LEGACY_BRACKET_LEAK_REGEX used to enumerate
  // a fixed list (asked, posted, flagged, proposed, suggested, confirmed,
  // executed). Sonnet can produce any reporting verb in this format, so the
  // regex now matches any -ed/-ied past-tense verb + common irregulars.
  // These tests pin the broader coverage so a future tightening doesn't
  // silently regress.
  it.each([
    "[I generated a new risk register]",
    "[I created 3 milestones]",
    "[I updated the budget figure]",
    "[I scheduled a meeting]",
    "[I noted the stakeholder concern]",
    "[I drafted an email]",
    "[I approved the artefact]",
    "[I rejected the proposal]",
    "[I extracted 4 risks from research]",
    "[I logged the decision]",
    "[I checked the dependencies]",
    "[I started the research phase]",
    "[I completed the kickoff]",
    "[I reviewed the charter]",
    "[I sent a notification]",
    "[I made an assumption]",
    "[I wrote the cost plan]",
    "[I told the user about the gate]",
    "[I found 2 issues]",
    "[I built the risk matrix]",
  ])("strips broadened past-tense verb leak: %s", (leaked) => {
    const input = `Earlier: ${leaked}. Moving on.`;
    const out = sanitiseChatResponse(input, emptyFacts);
    expect(out.content).not.toContain(leaked);
    expect(out.content).toContain("Moving on.");
    expect(out.corrections.some(c => c.kind === "stripped_context_marker_leak")).toBe(true);
  });

  it("leaves [I am the agent] alone (not past-tense)", () => {
    const clean = "Hello — [I am the agent assigned to this project]. How can I help?";
    const out = sanitiseChatResponse(clean, emptyFacts);
    expect(out.content).toContain("[I am the agent assigned to this project]");
  });

  it("leaves [I think ...] alone (not past-tense)", () => {
    const clean = "Quick note — [I think we should split the work] before continuing.";
    const out = sanitiseChatResponse(clean, emptyFacts);
    expect(out.content).toContain("[I think we should split the work]");
  });

  it("leaves [I will ...] alone (not past-tense)", () => {
    const clean = "Next — [I will draft a milestone plan] and share it.";
    const out = sanitiseChatResponse(clean, emptyFacts);
    expect(out.content).toContain("[I will draft a milestone plan]");
  });

  it("leaves clean prose untouched", () => {
    const clean = "Sure — here are the two options I'd recommend. Which fits best?";
    const out = sanitiseChatResponse(clean, emptyFacts);
    expect(out.content).toBe(clean);
    expect(out.corrections.filter(c => c.kind === "stripped_context_marker_leak")).toHaveLength(0);
  });
});

describe("stripContextMarkerLeaks — read-path defence in depth", () => {
  it("strips the exact screenshot leak (Griffin chat history)", () => {
    const leaked = `[I asked the user]: "What is the team's estimated velocity or capacity for story points per sprint?" (options: We haven't established velocity yet, 20-30 story points per sprint, 30-50 story points per sprint, 50+ story points per sprint)`;
    const out = stripContextMarkerLeaks(leaked);
    expect(out).not.toMatch(/I asked the user/i);
    expect(out).not.toContain("story points per sprint");
  });

  it("strips smart-quoted variant Claude sometimes emits", () => {
    const leaked = `[I asked the user]: “What is the team’s estimated velocity?” (options: A, B, C)`;
    const out = stripContextMarkerLeaks(leaked);
    expect(out).not.toMatch(/I asked the user/i);
    expect(out).not.toContain("velocity");
  });

  it("strips <prior_clarification> XML wrappers", () => {
    const leaked = `<prior_clarification>What was the original question?</prior_clarification> The answer is X.`;
    const out = stripContextMarkerLeaks(leaked);
    expect(out).not.toContain("prior_clarification");
    expect(out).toContain("The answer is X.");
  });

  it("returns empty string unchanged", () => {
    expect(stripContextMarkerLeaks("")).toBe("");
  });

  it("returns clean content unchanged", () => {
    const clean = "Here are the next steps. Approve the gate when ready.";
    expect(stripContextMarkerLeaks(clean)).toBe(clean);
  });
});
