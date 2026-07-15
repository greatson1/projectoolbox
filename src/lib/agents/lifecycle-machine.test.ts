import { describe, it, expect, vi, beforeEach } from "vitest";

const state: { phaseStatus: string | null; updates: any[]; auditRows: any[]; driftCalls: any[] } = {
  phaseStatus: "active",
  updates: [],
  auditRows: [],
  driftCalls: [],
};

vi.mock("@/lib/db", () => ({
  db: {
    agentDeployment: {
      findUnique: vi.fn(async () => ({
        id: "dep1",
        phaseStatus: state.phaseStatus,
        projectId: "proj1",
        agentId: "agent1",
        agent: { orgId: "org1" },
      })),
      update: vi.fn(async (args: any) => {
        state.updates.push(args.data);
        return args.data;
      }),
    },
    auditLog: { create: vi.fn(async (args: any) => state.auditRows.push(args.data)) },
  },
}));

vi.mock("@/lib/agents/drift-telemetry", () => ({
  recordDrift: vi.fn(async (...args: any[]) => state.driftCalls.push(args)),
}));

import { normalizePhaseStatus, isTransitionAllowed, transitionPhaseStatus } from "./lifecycle-machine";

beforeEach(() => {
  state.phaseStatus = "active";
  state.updates = [];
  state.auditRows = [];
  state.driftCalls = [];
  delete process.env.LIFECYCLE_ENFORCE_TRANSITIONS;
});

describe("normalizePhaseStatus", () => {
  it("canonicalises the dual review-state spelling", () => {
    expect(normalizePhaseStatus("pending_approval")).toBe("waiting_approval");
    expect(normalizePhaseStatus("waiting_approval")).toBe("waiting_approval");
  });

  it("maps legacy/phantom values and unknowns to safe states", () => {
    expect(normalizePhaseStatus("completed")).toBe("complete");
    expect(normalizePhaseStatus("advanced")).toBe("complete");
    expect(normalizePhaseStatus(null)).toBe("active");
    expect(normalizePhaseStatus("garbage_value")).toBe("active");
  });
});

describe("isTransitionAllowed", () => {
  it("models the real lifecycle flows", () => {
    expect(isTransitionAllowed("researching", "awaiting_research_approval")).toBe(true);
    expect(isTransitionAllowed("awaiting_research_approval", "awaiting_clarification")).toBe(true);
    expect(isTransitionAllowed("awaiting_clarification", "active")).toBe(true);
    expect(isTransitionAllowed("active", "waiting_approval")).toBe(true);
    expect(isTransitionAllowed("waiting_approval", "blocked_tasks_incomplete")).toBe(true);
    expect(isTransitionAllowed("blocked_tasks_incomplete", "active")).toBe(true);
    expect(isTransitionAllowed("active", "complete")).toBe(true);
    // unlock self-heals: anything → active
    expect(isTransitionAllowed("researching", "active")).toBe(true);
    // revert/reset reopen a closed lifecycle
    expect(isTransitionAllowed("complete", "active")).toBe(true);
  });

  it("rejects flows that have no code path", () => {
    expect(isTransitionAllowed("researching", "blocked_tasks_incomplete")).toBe(false);
    expect(isTransitionAllowed("researching", "complete")).toBe(false);
    expect(isTransitionAllowed("blocked_tasks_incomplete", "complete")).toBe(false);
  });
});

describe("transitionPhaseStatus", () => {
  it("applies a valid transition, canonicalises, merges extraData, and logs it", async () => {
    state.phaseStatus = "active";
    const res = await transitionPhaseStatus({
      deploymentId: "dep1",
      to: "pending_approval", // legacy spelling in, canonical out
      source: "test",
      reason: "artefacts awaiting review",
      extraData: { nextCycleAt: "2026-07-14T00:00:00Z" },
    });
    expect(res.ok).toBe(true);
    expect(res.from).toBe("active");
    expect(res.to).toBe("waiting_approval");
    expect(state.updates[0].phaseStatus).toBe("waiting_approval");
    expect(state.updates[0].nextCycleAt).toBe("2026-07-14T00:00:00Z");
    expect(state.auditRows[0].action).toBe("LIFECYCLE_TRANSITION");
    expect(state.auditRows[0].details.from).toBe("active");
    expect(state.auditRows[0].details.to).toBe("waiting_approval");
    expect(state.driftCalls.length).toBe(0);
  });

  it("observe mode: applies an off-matrix transition but records drift", async () => {
    state.phaseStatus = "researching";
    const res = await transitionPhaseStatus({ deploymentId: "dep1", to: "complete", source: "test" });
    expect(res.ok).toBe(true);
    expect(state.updates.length).toBe(1); // still applied
    expect(state.driftCalls.length).toBe(1);
    expect(state.driftCalls[0][0]).toBe("DRIFT_INVALID_TRANSITION");
  });

  it("enforce mode: refuses the off-matrix transition but preserves extraData", async () => {
    process.env.LIFECYCLE_ENFORCE_TRANSITIONS = "1";
    state.phaseStatus = "researching";
    const res = await transitionPhaseStatus({
      deploymentId: "dep1",
      to: "complete",
      source: "test",
      extraData: { isActive: false },
    });
    expect(res.ok).toBe(false);
    expect(res.refused).toBe(true);
    // phaseStatus write suppressed; the side-fields still landed
    expect(state.updates.length).toBe(1);
    expect(state.updates[0].phaseStatus).toBeUndefined();
    expect(state.updates[0].isActive).toBe(false);
    expect(state.driftCalls.length).toBe(1);
  });

  it("no-op transitions (same state) skip the audit log", async () => {
    state.phaseStatus = "active";
    await transitionPhaseStatus({ deploymentId: "dep1", to: "active", source: "test" });
    expect(state.auditRows.length).toBe(0);
    expect(state.updates.length).toBe(1);
  });
});
