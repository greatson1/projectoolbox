/**
 * Pure numerical-reconciliation checks across artefacts.
 *
 * Kept in a db-free module so the math is unit-testable without standing
 * up Postgres. The orchestrator (cross-artefact-reconciliation.ts) loads
 * the raw data and feeds it through these functions.
 *
 * The contradiction-detector already catches scalar disagreements ("draft
 * says budget = £75k, Charter says £50k"). These checks catch the
 * arithmetic disagreements one layer below — where each artefact agrees
 * on the headline number but the *components* don't add up:
 *
 *   - WBS work packages total 1,200 hours but Cost Plan budgets only
 *     800 hours of labour at the stated rate.
 *   - Schedule end date is 2026-12-01 but Project / Charter end date is
 *     2026-09-30.
 *   - Cost Plan ESTIMATE line items sum to £62k but Project / Charter
 *     budget is £50k.
 *   - Sprint Plan commits 120 story points across the sprint but the
 *     team's stated velocity is 60.
 *
 * Each check returns a finding or null. Findings carry a severity so the
 * UI can colour-code them and the approval API can decide whether to block.
 */

export type Severity = "ERROR" | "WARNING" | "INFO";

export interface ReconciliationFinding {
  /** Stable kebab-case identifier so the UI can dedupe / suppress. */
  code: string;
  severity: Severity;
  /** Short, user-readable title — fits in a banner. */
  title: string;
  /** Longer prose explanation including the actual numbers in play. */
  detail: string;
  /** Names of the artefacts involved — so the UI can deep-link. */
  artefacts: string[];
}

const PCT_TOLERANCE_WARN = 0.10;  // ≤ 10 % drift = info, beyond = warning
const PCT_TOLERANCE_ERROR = 0.25; //   25 % drift = error

function classify(actualVsExpected: number): Severity {
  const drift = Math.abs(actualVsExpected);
  if (drift >= PCT_TOLERANCE_ERROR) return "ERROR";
  if (drift >= PCT_TOLERANCE_WARN) return "WARNING";
  return "INFO";
}

function pct(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : 1;
  return (a - b) / b;
}

function fmtMoney(n: number, currency = "GBP"): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "£";
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

// ─── Check 1: WBS estimated hours vs Cost Plan labour ─────────────────────────

/**
 * If WBS totals N hours of effort and the Cost Plan has a labour rate L,
 * then Cost Plan labour budget should be roughly N × L. A large gap means
 * either the WBS overstates work, the Cost Plan understates labour, or
 * the labour rate assumption is wrong.
 *
 * Returns null when:
 *   - WBS hours total is 0 (no data — no signal)
 *   - Cost Plan labour total is 0 AND WBS hours = 0 (both empty, fine)
 *   - No labour rate could be derived (pure budget-line cost plan)
 */
export function checkWbsHoursVsLabour(input: {
  wbsTotalHours: number;
  costPlanLabourTotal: number;
  /** £ per hour. When null, we can only compare presence/absence. */
  labourRate: number | null;
  currency?: string;
}): ReconciliationFinding | null {
  const { wbsTotalHours, costPlanLabourTotal, labourRate, currency } = input;
  if (wbsTotalHours === 0 && costPlanLabourTotal === 0) return null;

  if (wbsTotalHours === 0 && costPlanLabourTotal > 0) {
    return {
      code: "wbs-empty-but-cost-labour",
      severity: "WARNING",
      title: "Cost Plan budgets labour but WBS has no estimated hours",
      detail: `Cost Plan labour budget is ${fmtMoney(costPlanLabourTotal, currency)} but the WBS lists 0 estimated hours. Add Est. Duration / Hours to the WBS work packages so labour cost ties back to specific work.`,
      artefacts: ["Work Breakdown Structure", "Cost Management Plan"],
    };
  }
  if (wbsTotalHours > 0 && costPlanLabourTotal === 0) {
    return {
      code: "wbs-hours-no-cost-labour",
      severity: "WARNING",
      title: "WBS estimates labour but Cost Plan has no labour line",
      detail: `WBS totals ${Math.round(wbsTotalHours).toLocaleString()} hours of effort but the Cost Plan has no LABOUR category entries. Either add labour costs or mark the work as in-kind.`,
      artefacts: ["Work Breakdown Structure", "Cost Management Plan"],
    };
  }

  if (labourRate === null || labourRate <= 0) {
    // We can't derive an expected labour budget without a rate. Don't fire.
    return null;
  }

  const expected = wbsTotalHours * labourRate;
  const drift = pct(costPlanLabourTotal, expected);
  const severity = classify(drift);
  if (severity === "INFO") return null;

  const direction = drift > 0 ? "exceeds" : "is below";
  return {
    code: "wbs-hours-vs-cost-labour",
    severity,
    title: `Cost Plan labour ${direction} WBS-derived estimate by ${Math.round(Math.abs(drift) * 100)} %`,
    detail: `WBS totals ${Math.round(wbsTotalHours).toLocaleString()} h × ${fmtMoney(labourRate, currency)}/h = ${fmtMoney(expected, currency)} expected labour, but Cost Plan labour line is ${fmtMoney(costPlanLabourTotal, currency)}. Either the WBS hours, the labour rate, or the Cost Plan needs revising.`,
    artefacts: ["Work Breakdown Structure", "Cost Management Plan"],
  };
}

// ─── Check 2: Schedule date range vs Project / Charter window ─────────────────

/**
 * Schedule's earliest start and latest end must fit inside the Project /
 * Charter project window. Tasks that start before project start or end
 * after project end either mean the schedule slipped or the dates in the
 * Charter are stale.
 */
export function checkScheduleVsProjectWindow(input: {
  scheduleEarliestStart: Date | null;
  scheduleLatestEnd: Date | null;
  projectStart: Date | null;
  projectEnd: Date | null;
}): ReconciliationFinding | null {
  const { scheduleEarliestStart, scheduleLatestEnd, projectStart, projectEnd } = input;
  if (!projectStart && !projectEnd) return null; // no window to compare against
  if (!scheduleEarliestStart && !scheduleLatestEnd) return null; // no schedule data

  const issues: string[] = [];
  if (projectStart && scheduleEarliestStart && scheduleEarliestStart < projectStart) {
    const days = Math.round((projectStart.getTime() - scheduleEarliestStart.getTime()) / 86_400_000);
    issues.push(`Schedule starts ${days} day(s) before project start (${projectStart.toISOString().slice(0, 10)}).`);
  }
  if (projectEnd && scheduleLatestEnd && scheduleLatestEnd > projectEnd) {
    const days = Math.round((scheduleLatestEnd.getTime() - projectEnd.getTime()) / 86_400_000);
    issues.push(`Schedule ends ${days} day(s) after project end (${projectEnd.toISOString().slice(0, 10)}).`);
  }
  if (issues.length === 0) return null;

  return {
    code: "schedule-outside-project-window",
    severity: "WARNING",
    title: "Schedule falls outside the project / Charter window",
    detail: issues.join(" "),
    artefacts: ["Schedule with Dependencies", "Project Charter"],
  };
}

// ─── Check 3: Cost Plan total vs Project / Charter budget ─────────────────────

/**
 * Sum of Cost Plan ESTIMATE entries should match the Project / Charter
 * budget headline. The contradiction-detector catches the case where the
 * draft *states* a different budget number in prose; this catches the
 * case where the prose matches but the line items don't add up.
 */
export function checkCostPlanTotalVsBudget(input: {
  costPlanEstimateTotal: number;
  projectBudget: number | null;
  currency?: string;
}): ReconciliationFinding | null {
  const { costPlanEstimateTotal, projectBudget, currency } = input;
  if (projectBudget === null || projectBudget === 0) return null;
  if (costPlanEstimateTotal === 0) return null;

  const drift = pct(costPlanEstimateTotal, projectBudget);
  const severity = classify(drift);
  if (severity === "INFO") return null;

  const direction = drift > 0 ? "exceeds" : "is below";
  return {
    code: "cost-plan-vs-budget",
    severity,
    title: `Cost Plan total ${direction} Project budget by ${Math.round(Math.abs(drift) * 100)} %`,
    detail: `Cost Plan ESTIMATE entries sum to ${fmtMoney(costPlanEstimateTotal, currency)}, Project / Charter budget is ${fmtMoney(projectBudget, currency)}. Either reforecast or revise the budget — these should match.`,
    artefacts: ["Cost Management Plan", "Project Charter"],
  };
}

// ─── Check 4: WBS work package count vs Schedule activity count ───────────────

/**
 * Loose heuristic — Schedule should have at least one activity per WBS
 * work package (often more, since work packages decompose into activities).
 * A schedule with significantly fewer activities than WBS work packages
 * likely means the schedule was generated independently of the WBS rather
 * than as its decomposition.
 */
export function checkScheduleCoversWbs(input: {
  wbsWorkPackageCount: number;
  scheduleActivityCount: number;
}): ReconciliationFinding | null {
  const { wbsWorkPackageCount, scheduleActivityCount } = input;
  if (wbsWorkPackageCount === 0 || scheduleActivityCount === 0) return null;

  if (scheduleActivityCount < wbsWorkPackageCount * 0.75) {
    return {
      code: "schedule-undercovers-wbs",
      severity: "WARNING",
      title: "Schedule has fewer activities than WBS has work packages",
      detail: `WBS lists ${wbsWorkPackageCount} work packages but the Schedule only has ${scheduleActivityCount} activities. A schedule should typically decompose each work package into one or more activities — check that the schedule was generated from the WBS rather than independently.`,
      artefacts: ["Work Breakdown Structure", "Schedule with Dependencies"],
    };
  }
  return null;
}

// ─── Check 5: Sprint Plan commitment vs team velocity ─────────────────────────

/**
 * Sum of story points committed in the current Sprint Plan should be
 * within tolerance of the team's stated velocity. Overcommitting by more
 * than 25 % is the single most common cause of failed sprints.
 */
export function checkSprintCommitmentVsVelocity(input: {
  sprintCommittedPoints: number;
  teamVelocity: number | null;
}): ReconciliationFinding | null {
  const { sprintCommittedPoints, teamVelocity } = input;
  if (teamVelocity === null || teamVelocity === 0) return null;
  if (sprintCommittedPoints === 0) return null;

  const drift = pct(sprintCommittedPoints, teamVelocity);
  if (Math.abs(drift) < PCT_TOLERANCE_WARN) return null;

  const severity: Severity = drift > PCT_TOLERANCE_ERROR ? "ERROR" : "WARNING";
  const direction = drift > 0 ? "overcommits relative to" : "undercommits relative to";
  return {
    code: "sprint-vs-velocity",
    severity,
    title: `Sprint commitment ${direction} team velocity by ${Math.round(Math.abs(drift) * 100)} %`,
    detail: `Sprint Plan commits ${sprintCommittedPoints} story points; team velocity is ${teamVelocity}. Drop scope to fit velocity, or update velocity if the team has genuinely accelerated.`,
    artefacts: ["Sprint Plans", "Team Charter"],
  };
}
