import { describe, it, expect, vi } from "vitest";

const day = 86_400_000;
const d0 = new Date("2026-01-01T00:00:00Z");
const at = (days: number) => new Date(d0.getTime() + days * day);

// Two sequential tasks (b depends on a): a 0→5d, b 5→10d. Baseline finish
// day 10. Moving b's endDate +6d should push the computed finish by ~6d.
const TASKS = [
  {
    id: "a", title: "Groundworks", status: "IN_PROGRESS", startDate: at(0), endDate: at(5),
    progress: 40, parentId: null, phaseId: "ph1", dependencies: [], estimatedHours: 40,
  },
  {
    id: "b", title: "Fit-out", status: "TODO", startDate: at(5), endDate: at(10),
    progress: 0, parentId: null, phaseId: "ph1", dependencies: ["a"], estimatedHours: 40,
  },
];

vi.mock("@/lib/db", () => ({
  db: {
    task: { findMany: vi.fn(async () => TASKS.map((t) => ({ ...t }))) },
    phase: { findMany: vi.fn(async () => [{ id: "ph1", name: "Build" }]) },
  },
}));

import { computeChangeImpact } from "./change-proposals";

describe("computeChangeImpact", () => {
  it("re-runs CPM with the proposed changes and reports the finish delta", async () => {
    const ci = await computeChangeImpact("proj1", [
      {
        entityType: "task", entityId: "b", title: "Fit-out", field: "endDate",
        currentValue: at(10).toISOString(), proposedValue: at(16).toISOString(),
        reason: "supplier delay",
      },
    ]);
    expect(ci).not.toBeNull();
    expect(ci!.deltaDays).toBeCloseTo(6, 0);
    expect(ci!.tasksAffected).toBe(1);
    // b is on the critical path (last task of the chain)
    expect(ci!.criticalTasksAffected).toBe(1);
  });

  it("sums estimated-hour deltas and reports zero schedule delta for cost-only changes", async () => {
    const ci = await computeChangeImpact("proj1", [
      {
        entityType: "task", entityId: "a", title: "Groundworks", field: "estimatedHours",
        currentValue: "40", proposedValue: "56", reason: "scope grew",
      },
    ]);
    expect(ci).not.toBeNull();
    expect(ci!.deltaHours).toBe(16);
    expect(ci!.deltaDays).toBe(0);
  });

  it("returns null when no task-level changes are proposed", async () => {
    const ci = await computeChangeImpact("proj1", [
      {
        entityType: "risk", entityId: "r1", title: "Some risk", field: "impact",
        currentValue: "2", proposedValue: "3", reason: "worsening",
      },
    ]);
    expect(ci).toBeNull();
  });
});
