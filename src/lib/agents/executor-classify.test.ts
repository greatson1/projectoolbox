import { describe, it, expect } from "vitest";
import { classifyExecutor } from "./executor-classify";

describe("classifyExecutor", () => {
  it("classifies document production as AGENT", () => {
    expect(classifyExecutor("Generate Initial Risk Register")).toBe("AGENT");
    expect(classifyExecutor("Draft the Communication Plan")).toBe("AGENT");
    expect(classifyExecutor("Update Risk Register")).toBe("AGENT");
    expect(classifyExecutor("Analyse stakeholder sentiment trends")).toBe("AGENT");
    expect(classifyExecutor("Prepare weekly status report")).toBe("AGENT");
  });

  it("classifies real-world work as HUMAN", () => {
    expect(classifyExecutor("Install network cabling on floor 3")).toBe("HUMAN");
    expect(classifyExecutor("Procure office furniture")).toBe("HUMAN");
    expect(classifyExecutor("Conduct team kickoff and charter walkthrough session")).toBe("HUMAN");
    expect(classifyExecutor("Train team on Ready criteria and process")).toBe("HUMAN");
    expect(classifyExecutor("Obtain charter approval from Project Sponsor")).toBe("HUMAN");
    expect(classifyExecutor("Hire two delivery engineers")).toBe("HUMAN");
    expect(classifyExecutor("ERP System Integration")).toBe("HUMAN");
    expect(classifyExecutor("Cloud Platform Setup", "Provision the production environment")).toBe("HUMAN");
  });

  it("HUMAN wins when both signal sets match", () => {
    // "conduct ... session" (human) + "document" (agent-ish word in title)
    expect(classifyExecutor("Conduct requirements workshop session and document outcomes")).toBe("HUMAN");
  });

  it("defaults to HUMAN for ambiguous work", () => {
    expect(classifyExecutor("Finalise core team member assignments")).toBe("HUMAN");
    expect(classifyExecutor("issue 1")).toBe("HUMAN");
  });
});
