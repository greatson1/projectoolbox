import { describe, it, expect } from "vitest";
import {
  checkWbsHoursVsLabour,
  checkScheduleVsProjectWindow,
  checkCostPlanTotalVsBudget,
  checkScheduleCoversWbs,
  checkSprintCommitmentVsVelocity,
} from "./reconciliation-checks";

describe("checkWbsHoursVsLabour", () => {
  it("no-ops when both totals are zero", () => {
    expect(checkWbsHoursVsLabour({
      wbsTotalHours: 0, costPlanLabourTotal: 0, labourRate: 50,
    })).toBeNull();
  });

  it("warns when Cost Plan has labour but WBS has no hours", () => {
    const f = checkWbsHoursVsLabour({
      wbsTotalHours: 0, costPlanLabourTotal: 40_000, labourRate: 50,
    });
    expect(f?.severity).toBe("WARNING");
    expect(f?.code).toBe("wbs-empty-but-cost-labour");
  });

  it("warns when WBS has hours but Cost Plan has no labour line", () => {
    const f = checkWbsHoursVsLabour({
      wbsTotalHours: 800, costPlanLabourTotal: 0, labourRate: 50,
    });
    expect(f?.severity).toBe("WARNING");
    expect(f?.code).toBe("wbs-hours-no-cost-labour");
  });

  it("no-ops when no labour rate available", () => {
    expect(checkWbsHoursVsLabour({
      wbsTotalHours: 800, costPlanLabourTotal: 40_000, labourRate: null,
    })).toBeNull();
  });

  it("passes when WBS hours × rate matches Cost Plan within 10 %", () => {
    // 800h × £50 = £40,000 expected, actual £42,000 = 5% drift → INFO (null)
    expect(checkWbsHoursVsLabour({
      wbsTotalHours: 800, costPlanLabourTotal: 42_000, labourRate: 50,
    })).toBeNull();
  });

  it("warns at 10–25 % drift", () => {
    // 800h × £50 = £40k expected, actual £48k = 20% drift → WARNING
    const f = checkWbsHoursVsLabour({
      wbsTotalHours: 800, costPlanLabourTotal: 48_000, labourRate: 50,
    });
    expect(f?.severity).toBe("WARNING");
    expect(f?.code).toBe("wbs-hours-vs-cost-labour");
    expect(f?.title).toMatch(/exceeds.*20 %/);
  });

  it("errors at ≥25 % drift", () => {
    // 800h × £50 = £40k expected, actual £25k = 37.5% under → ERROR
    const f = checkWbsHoursVsLabour({
      wbsTotalHours: 800, costPlanLabourTotal: 25_000, labourRate: 50,
    });
    expect(f?.severity).toBe("ERROR");
    expect(f?.title).toMatch(/is below.*38 %/);
  });
});

describe("checkScheduleVsProjectWindow", () => {
  it("no-ops when project window is missing", () => {
    expect(checkScheduleVsProjectWindow({
      scheduleEarliestStart: new Date("2026-01-01"),
      scheduleLatestEnd: new Date("2026-06-01"),
      projectStart: null,
      projectEnd: null,
    })).toBeNull();
  });

  it("no-ops when schedule fits inside project window", () => {
    expect(checkScheduleVsProjectWindow({
      scheduleEarliestStart: new Date("2026-02-01"),
      scheduleLatestEnd: new Date("2026-05-01"),
      projectStart: new Date("2026-01-01"),
      projectEnd: new Date("2026-06-01"),
    })).toBeNull();
  });

  it("warns when schedule starts before project start", () => {
    const f = checkScheduleVsProjectWindow({
      scheduleEarliestStart: new Date("2026-01-15"),
      scheduleLatestEnd: new Date("2026-05-01"),
      projectStart: new Date("2026-02-01"),
      projectEnd: new Date("2026-06-01"),
    });
    expect(f?.severity).toBe("WARNING");
    expect(f?.detail).toMatch(/17 day\(s\) before project start/);
  });

  it("warns when schedule ends after project end", () => {
    const f = checkScheduleVsProjectWindow({
      scheduleEarliestStart: new Date("2026-02-01"),
      scheduleLatestEnd: new Date("2026-07-15"),
      projectStart: new Date("2026-02-01"),
      projectEnd: new Date("2026-06-01"),
    });
    expect(f?.severity).toBe("WARNING");
    expect(f?.detail).toMatch(/44 day\(s\) after project end/);
  });
});

describe("checkCostPlanTotalVsBudget", () => {
  it("no-ops when project budget is null or zero", () => {
    expect(checkCostPlanTotalVsBudget({
      costPlanEstimateTotal: 50_000, projectBudget: null,
    })).toBeNull();
    expect(checkCostPlanTotalVsBudget({
      costPlanEstimateTotal: 50_000, projectBudget: 0,
    })).toBeNull();
  });

  it("passes when cost plan total matches budget within tolerance", () => {
    expect(checkCostPlanTotalVsBudget({
      costPlanEstimateTotal: 52_000, projectBudget: 50_000,
    })).toBeNull(); // 4% drift = INFO
  });

  it("warns at 10–25 % drift", () => {
    const f = checkCostPlanTotalVsBudget({
      costPlanEstimateTotal: 60_000, projectBudget: 50_000,
    });
    expect(f?.severity).toBe("WARNING");
    expect(f?.title).toMatch(/exceeds.*20 %/);
  });

  it("errors at ≥25 % drift", () => {
    const f = checkCostPlanTotalVsBudget({
      costPlanEstimateTotal: 75_000, projectBudget: 50_000,
    });
    expect(f?.severity).toBe("ERROR");
    expect(f?.title).toMatch(/exceeds.*50 %/);
  });
});

describe("checkScheduleCoversWbs", () => {
  it("no-ops when either count is zero", () => {
    expect(checkScheduleCoversWbs({
      wbsWorkPackageCount: 0, scheduleActivityCount: 10,
    })).toBeNull();
    expect(checkScheduleCoversWbs({
      wbsWorkPackageCount: 10, scheduleActivityCount: 0,
    })).toBeNull();
  });

  it("warns when schedule has fewer activities than WBS work packages", () => {
    // 10 WP, 5 activities → 50% of WP count → below 75% threshold
    const f = checkScheduleCoversWbs({
      wbsWorkPackageCount: 10, scheduleActivityCount: 5,
    });
    expect(f?.severity).toBe("WARNING");
  });

  it("passes when schedule covers ≥75 % of WBS work packages", () => {
    expect(checkScheduleCoversWbs({
      wbsWorkPackageCount: 10, scheduleActivityCount: 8,
    })).toBeNull();
  });

  it("passes when schedule decomposes WBS (more activities than WP)", () => {
    expect(checkScheduleCoversWbs({
      wbsWorkPackageCount: 10, scheduleActivityCount: 35,
    })).toBeNull();
  });
});

describe("checkSprintCommitmentVsVelocity", () => {
  it("no-ops when velocity is unknown", () => {
    expect(checkSprintCommitmentVsVelocity({
      sprintCommittedPoints: 60, teamVelocity: null,
    })).toBeNull();
  });

  it("passes when commitment is within tolerance of velocity", () => {
    expect(checkSprintCommitmentVsVelocity({
      sprintCommittedPoints: 60, teamVelocity: 60,
    })).toBeNull();
    expect(checkSprintCommitmentVsVelocity({
      sprintCommittedPoints: 64, teamVelocity: 60,
    })).toBeNull(); // ~7% over
  });

  it("warns at 10–25 % overcommitment", () => {
    const f = checkSprintCommitmentVsVelocity({
      sprintCommittedPoints: 72, teamVelocity: 60,
    });
    expect(f?.severity).toBe("WARNING");
    expect(f?.title).toMatch(/overcommits.*20 %/);
  });

  it("errors at >25 % overcommitment", () => {
    const f = checkSprintCommitmentVsVelocity({
      sprintCommittedPoints: 90, teamVelocity: 60,
    });
    expect(f?.severity).toBe("ERROR");
  });
});
