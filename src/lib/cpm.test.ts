import { describe, it, expect } from "vitest";
import {
  baselineCpm,
  forecastCpm,
  buildCpmInput,
  monteCarloForecast,
  CpmTaskInput,
} from "./cpm";

const t = (
  id: string,
  durationDays: number,
  dependsOn: string[] = [],
  extra: Partial<CpmTaskInput> = {},
): CpmTaskInput => ({
  id,
  phaseOrder: 0,
  durationDays,
  status: "TODO",
  progressPct: 0,
  dependsOn,
  ...extra,
});

describe("baselineCpm", () => {
  it("computes a linear chain — every task critical, zero float", () => {
    const res = baselineCpm([t("a", 2), t("b", 3, ["a"]), t("c", 1, ["b"])]);
    expect(res.finishDays).toBe(6);
    expect(res.criticalIds).toEqual(["a", "b", "c"]);
    for (const id of ["a", "b", "c"]) {
      expect(res.tasks.get(id)!.critical).toBe(true);
      expect(res.tasks.get(id)!.float).toBe(0);
    }
    expect(res.tasks.get("b")!.es).toBe(2);
    expect(res.tasks.get("c")!.ef).toBe(6);
  });

  it("gives float to the short branch of a parallel join", () => {
    // a(5) → c ;  b(2) → c
    const res = baselineCpm([t("a", 5), t("b", 2), t("c", 1, ["a", "b"])]);
    expect(res.finishDays).toBe(6);
    expect(res.tasks.get("a")!.critical).toBe(true);
    expect(res.tasks.get("c")!.critical).toBe(true);
    expect(res.tasks.get("b")!.critical).toBe(false);
    expect(res.tasks.get("b")!.float).toBe(3);
  });

  it("enforces phase ordering as an implicit constraint", () => {
    const res = baselineCpm([
      t("p0", 4, [], { phaseOrder: 0 }),
      t("p1", 2, [], { phaseOrder: 1 }),
    ]);
    expect(res.tasks.get("p1")!.es).toBe(4);
    expect(res.finishDays).toBe(6);
  });

  it("respects start-no-earlier-than constraints from stored dates", () => {
    const res = baselineCpm([t("a", 2), t("b", 2, [], { earliestStartDays: 10 })]);
    expect(res.tasks.get("b")!.es).toBe(10);
    expect(res.finishDays).toBe(12);
    expect(res.tasks.get("b")!.critical).toBe(true);
    expect(res.tasks.get("a")!.critical).toBe(false);
  });

  it("survives dependency cycles without hanging", () => {
    const res = baselineCpm([t("a", 1, ["b"]), t("b", 1, ["a"])]);
    expect(res.finishDays).toBeGreaterThan(0);
    expect(res.tasks.size).toBe(2);
  });

  it("excludes cancelled tasks", () => {
    const res = baselineCpm([t("a", 2), t("x", 99, [], { status: "CANCELLED" })]);
    expect(res.finishDays).toBe(2);
    expect(res.tasks.has("x")).toBe(false);
  });
});

describe("forecastCpm", () => {
  it("treats DONE as zero remaining and scales by progress", () => {
    const res = forecastCpm([
      t("done", 10, [], { status: "DONE" }),
      t("half", 10, ["done"], { progressPct: 50 }),
      t("todo", 4, ["half"]),
    ]);
    // done contributes 0, half has 5 remaining, todo 4 → 9
    expect(res.finishDays).toBeCloseTo(9, 1);
  });
});

describe("buildCpmInput", () => {
  const day = 86_400_000;
  const d0 = new Date("2026-01-01");
  const at = (days: number) => new Date(d0.getTime() + days * day);

  it("derives durations from dates, resolves deps by id and title, excludes parents", () => {
    const { input, edges, unresolvedDeps, anchorMs } = buildCpmInput(
      [
        { id: "parent", title: "Package", status: "TODO", startDate: at(0), endDate: at(10), progress: 0 },
        {
          id: "t1",
          title: "Dig foundations",
          status: "DONE",
          startDate: at(0),
          endDate: at(3),
          progress: 100,
          parentId: "parent",
        },
        {
          id: "t2",
          title: "Pour concrete",
          status: "TODO",
          startDate: at(3),
          endDate: at(5),
          progress: 0,
          parentId: "parent",
          dependencies: ["t1"], // db id
        },
        {
          id: "t3",
          title: "Cure & inspect",
          status: "TODO",
          startDate: at(5),
          endDate: at(9),
          progress: 0,
          dependencies: ["Pour Concrete", "WBS-999"], // title (case-insensitive) + unresolvable
        },
      ],
      [{ id: "ph1", name: "Build" }],
    );
    expect(anchorMs).toBe(d0.getTime());
    expect(input.map((x) => x.id)).toEqual(["t1", "t2", "t3"]); // parent excluded
    expect(input.find((x) => x.id === "t1")!.durationDays).toBe(3);
    expect(input.find((x) => x.id === "t2")!.dependsOn).toEqual(["t1"]);
    expect(input.find((x) => x.id === "t3")!.dependsOn).toEqual(["t2"]);
    expect(edges).toEqual([
      { from: "t1", to: "t2" },
      { from: "t2", to: "t3" },
    ]);
    expect(unresolvedDeps).toEqual(["WBS-999"]);
    expect(input.find((x) => x.id === "t3")!.earliestStartDays).toBe(5);
  });

  it("maps phase order from Phase rows whether phaseId is a CUID or a name", () => {
    const { input } = buildCpmInput(
      [
        { id: "a", title: "A", status: "TODO", startDate: null, endDate: null, progress: 0, phaseId: "ph2" },
        { id: "b", title: "B", status: "TODO", startDate: null, endDate: null, progress: 0, phaseId: "Delivery" },
        { id: "c", title: "C", status: "TODO", startDate: null, endDate: null, progress: 0, phaseId: null },
      ],
      [
        { id: "ph1", name: "Setup" },
        { id: "ph2", name: "Delivery" },
      ],
    );
    expect(input.find((x) => x.id === "a")!.phaseOrder).toBe(1);
    expect(input.find((x) => x.id === "b")!.phaseOrder).toBe(1);
    expect(input.find((x) => x.id === "c")!.phaseOrder).toBe(0);
  });

  it("clamps past start dates to 0 under a forecast anchor", () => {
    const { input } = buildCpmInput(
      [{ id: "a", title: "A", status: "TODO", startDate: at(0), endDate: at(2), progress: 0 }],
      [],
      { anchorMs: at(30).getTime() },
    );
    expect(input[0].earliestStartDays).toBe(0);
  });
});

describe("monteCarloForecast", () => {
  const inputs = [t("a", 4), t("b", 6, ["a"]), t("c", 3, ["a"])];

  it("is deterministic for a given seed and orders quantiles sensibly", () => {
    const one = monteCarloForecast(inputs, 12)!;
    const two = monteCarloForecast(inputs, 12)!;
    expect(one.p50Days).toBe(two.p50Days);
    expect(one.p85Days).toBeGreaterThanOrEqual(one.p50Days);
    expect(one.maxDays).toBeGreaterThanOrEqual(one.p85Days);
    expect(one.minDays).toBeLessThanOrEqual(one.p50Days);
    expect(one.onTargetProb).toBeGreaterThanOrEqual(0);
    expect(one.onTargetProb).toBeLessThanOrEqual(1);
  });

  it("returns null when nothing remains", () => {
    expect(monteCarloForecast([], null)).toBeNull();
    expect(monteCarloForecast([t("a", 2, [], { status: "DONE" })], null)).toBeNull();
  });
});
