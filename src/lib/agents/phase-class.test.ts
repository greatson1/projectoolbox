import { describe, it, expect } from "vitest";
import { classifyPhase } from "./phase-class";

describe("classifyPhase", () => {
  it("classifies execution-bucket phase names", () => {
    expect(classifyPhase("Execution")).toBe("execution");
    expect(classifyPhase("Build")).toBe("execution");
    expect(classifyPhase("Implementation")).toBe("execution");
    expect(classifyPhase("Managing Product Delivery")).toBe("execution");
    expect(classifyPhase("Controlling a Stage")).toBe("execution");
    expect(classifyPhase("Sprint Cadence")).toBe("execution");
    expect(classifyPhase("Continuous Delivery")).toBe("execution");
    expect(classifyPhase("Iteration Cadence")).toBe("execution");
  });

  it("classifies closing-bucket phase names", () => {
    expect(classifyPhase("Closing")).toBe("closing");
    expect(classifyPhase("Closure")).toBe("closing");
    expect(classifyPhase("Managing a Stage Boundary")).toBe("closing");
    expect(classifyPhase("Inspect and Adapt")).toBe("closing");
    expect(classifyPhase("Handover")).toBe("closing");
  });

  it("classifies front-bucket phase names", () => {
    expect(classifyPhase("Pre-Project")).toBe("front");
    expect(classifyPhase("Initiation")).toBe("front");
    expect(classifyPhase("Planning")).toBe("front");
    expect(classifyPhase("Design")).toBe("front");
    expect(classifyPhase("Requirements")).toBe("front");
    expect(classifyPhase("PI Planning")).toBe("front");
    expect(classifyPhase("Sprint Zero")).toBe("front");
  });

  it("uses substring matching for compound phase names", () => {
    // Real-world project phase names often include extra context
    expect(classifyPhase("Execution Phase Test")).toBe("execution");
    expect(classifyPhase("Closing & Handover")).toBe("closing");
    expect(classifyPhase("Planning - Detailed")).toBe("front");
  });

  it("is case- and punctuation-insensitive", () => {
    expect(classifyPhase("EXECUTION")).toBe("execution");
    expect(classifyPhase("inspect & adapt")).toBe("closing");
    expect(classifyPhase("Pre Project")).toBe("front");
    expect(classifyPhase("pre-project")).toBe("front");
    expect(classifyPhase("  Execution  ")).toBe("execution");
  });

  it("defaults to front for unknown / empty input (safe fallback)", () => {
    expect(classifyPhase(null)).toBe("front");
    expect(classifyPhase(undefined)).toBe("front");
    expect(classifyPhase("")).toBe("front");
    expect(classifyPhase("Some Custom Phase Name With No Keywords")).toBe("front");
  });
});
