import { describe, it, expect } from "vitest";
import {
  applySequentialStepGating,
  classifyPhaseState,
  type PipelineStepLite,
} from "./pipeline-gating";

describe("applySequentialStepGating", () => {
  // Regression for the bug where Clarification (running, awaiting answers) and
  // Delivery Tasks (running, 0% complete) both showed as active in the UI.
  // The pipeline API independently computes each step's status; this gate
  // enforces sequential semantics so only one step is "running" at a time.
  it("downgrades a later running step when an earlier step is still running", () => {
    const steps: PipelineStepLite[] = [
      { id: "deploy",   status: "done" },
      { id: "research", status: "done" },
      { id: "clarify",  status: "running", details: "12 questions pending" },
      { id: "generate", status: "waiting" },
      { id: "approve",  status: "waiting" },
      { id: "delivery", status: "running", details: "PM: 0/11, Delivery: 0%" },
      { id: "kb",       status: "waiting" },
      { id: "gate",     status: "waiting" },
    ];

    applySequentialStepGating(steps);

    expect(steps.map(s => s.status)).toEqual([
      "done", "done", "running", "waiting", "waiting", "waiting", "waiting", "waiting",
    ]);
    expect(steps.find(s => s.id === "delivery")?.details).toBeUndefined();
  });

  it("downgrades running step after a waiting predecessor", () => {
    const steps: PipelineStepLite[] = [
      { id: "deploy",   status: "done" },
      { id: "research", status: "waiting" },
      { id: "clarify",  status: "running" },
    ];

    applySequentialStepGating(steps);

    expect(steps.map(s => s.status)).toEqual(["done", "waiting", "waiting"]);
  });

  it("downgrades running steps after a failed predecessor", () => {
    const steps: PipelineStepLite[] = [
      { id: "deploy",   status: "done" },
      { id: "research", status: "failed" },
      { id: "clarify",  status: "running" },
      { id: "generate", status: "running" },
    ];

    applySequentialStepGating(steps);

    expect(steps.map(s => s.status)).toEqual(["done", "failed", "waiting", "waiting"]);
  });

  it("treats skipped as transparent — running steps after skipped+done stay running", () => {
    const steps: PipelineStepLite[] = [
      { id: "deploy",   status: "done" },
      { id: "research", status: "skipped" },
      { id: "clarify",  status: "running" },
    ];

    applySequentialStepGating(steps);

    expect(steps.map(s => s.status)).toEqual(["done", "skipped", "running"]);
  });

  it("does not modify a sequence that is already valid", () => {
    const steps: PipelineStepLite[] = [
      { id: "a", status: "done" },
      { id: "b", status: "done" },
      { id: "c", status: "running", details: "in progress" },
      { id: "d", status: "waiting" },
    ];
    const expectedDetails = steps[2].details;

    applySequentialStepGating(steps);

    expect(steps.map(s => s.status)).toEqual(["done", "done", "running", "waiting"]);
    expect(steps[2].details).toBe(expectedDetails);
  });

  it("returns the same array reference (mutation, not copy)", () => {
    const steps: PipelineStepLite[] = [{ id: "a", status: "done" }];
    expect(applySequentialStepGating(steps)).toBe(steps);
  });
});

describe("classifyPhaseState", () => {
  // Regression for the bug where 6 APPROVED + 1 REJECTED showed
  // "Phase Complete — all 7 documents approved" with a green Generate Next
  // Phase button. allDone was checking pending===0, but REJECTED isn't pending,
  // so the flag flipped true.
  it("returns 'rejected' when any artefact is REJECTED, even with no pending", () => {
    const state = classifyPhaseState({
      approved: 6, pending: 0, rejected: 1, total: 7, generating: false,
    });
    expect(state).toBe("rejected");
  });

  it("returns 'rejected' even when other artefacts are still pending", () => {
    const state = classifyPhaseState({
      approved: 3, pending: 2, rejected: 1, total: 6, generating: false,
    });
    expect(state).toBe("rejected");
  });

  it("returns 'complete' only when every artefact is APPROVED", () => {
    expect(classifyPhaseState({
      approved: 7, pending: 0, rejected: 0, total: 7, generating: false,
    })).toBe("complete");
  });

  it("returns 'review' when artefacts are pending but none rejected", () => {
    expect(classifyPhaseState({
      approved: 3, pending: 4, rejected: 0, total: 7, generating: false,
    })).toBe("review");
  });

  it("returns 'empty' before any artefact exists", () => {
    expect(classifyPhaseState({
      approved: 0, pending: 0, rejected: 0, total: 0, generating: false,
    })).toBe("empty");
  });

  it("returns 'generating' regardless of counts when generation is active", () => {
    expect(classifyPhaseState({
      approved: 5, pending: 2, rejected: 0, total: 7, generating: true,
    })).toBe("generating");
  });

  // Critical: do NOT regress to the old "pending === 0 means complete" rule.
  // 6 approved + 1 rejected + 0 pending should never be "complete".
  it("does not regress: 6 approved + 1 rejected + 0 pending is NOT complete", () => {
    const state = classifyPhaseState({
      approved: 6, pending: 0, rejected: 1, total: 7, generating: false,
    });
    expect(state).not.toBe("complete");
  });
});
