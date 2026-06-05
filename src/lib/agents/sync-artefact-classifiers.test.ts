/**
 * Methodology-classification predicate tests.
 *
 * These guard the structural rule: which artefact names produce tasks
 * (so the backfill should run on them) vs. which only produce other
 * structured data (stakeholders/risks/costs/charter — populated by the
 * same seeder pipeline but don't need a Tasks-page-driven lazy sync).
 *
 * The artefact-name set was extracted from the PATCH handler at
 * src/app/api/agents/artefacts/[id]/route.ts and from
 * src/lib/agents/artefact-seeders.ts so the backfill picks up every
 * artefact the live approval flow would pick up.
 */

import { describe, it, expect } from "vitest";
import {
  isScheduleOrWBS,
  isBacklogOrSprintPlan,
  producesStructuredData,
} from "./sync-artefact-classifiers";

describe("isScheduleOrWBS — Traditional / Waterfall task-producing artefacts", () => {
  it.each([
    "Schedule Baseline",
    "Schedule with Dependencies",
    "Project Schedule",
    "WBS",
    "Work Breakdown Structure",
    "Detailed WBS",
  ])("matches %s", (name) => {
    expect(isScheduleOrWBS(name)).toBe(true);
  });

  it.each([
    "Initial Product Backlog",
    "Sprint Plans",
    "Risk Register",
    "Stakeholder Register",
    "Project Charter",
  ])("does not match %s", (name) => {
    expect(isScheduleOrWBS(name)).toBe(false);
  });
});

describe("isBacklogOrSprintPlan — Scrum / Kanban / SAFe / Hybrid task-producing artefacts", () => {
  it.each([
    "Initial Product Backlog",   // Scrum, Kanban, SAFe Sprint Zero / Setup
    "Product Backlog",
    "Sprint Plans",              // Scrum Sprint Cadence — planning summary
    "Sprint Plan",
    "Sprint Backlog",            // Scrum Sprint Cadence — live working list
    "Iteration Plans",           // SAFe Iteration Cadence — planning summary
    "Iteration Plan",
    "Iteration Backlog",         // SAFe Iteration Cadence — live working list
    "Initial Backlog",           // legacy alias
    "Backlog",                   // exact match (lower-case in predicate)
    "backlog",
  ])("matches %s", (name) => {
    expect(isBacklogOrSprintPlan(name)).toBe(true);
  });

  it.each([
    "Schedule Baseline",
    "Work Breakdown Structure",
    "Risk Register",
    "Project Charter",
  ])("does not match %s", (name) => {
    expect(isBacklogOrSprintPlan(name)).toBe(false);
  });
});

describe("producesStructuredData — total methodology coverage", () => {
  // Anything that the PATCH-time seeder would write into a structured DB
  // table must be matched here, otherwise the backfill silently skips it.
  it.each([
    // task-producing (any methodology)
    "Schedule Baseline",
    "Work Breakdown Structure",
    "Initial Product Backlog",
    "Sprint Plans",
    "Iteration Plans",
    "Sprint Backlog",
    // stakeholder
    "Stakeholder Register",
    "Stakeholder List",
    "Initial Stakeholder Register",
    // risk
    "Risk Register",
    "Initial Risk Register",
    "Risk Management Plan",
    "Risk Log",
    // cost
    "Budget Breakdown",
    "Cost Management Plan",
    "Cost Baseline",
    "Cost Plan",
    "Cost Estimate",
    "Project Estimate",
    "Cost Breakdown",
    // benefits / business case
    "Business Case",
    "Benefits Register",
    "Benefits Realisation Plan",
    "Benefits Management Plan",
    // charter / scope
    "Project Charter",
    "Project Brief",
    "Scope Statement",
    "Project Initiation Document",
    "PID",
    // change control
    "Change Request Register",
    "Change Request Log",
    "Change Log",
  ])("matches %s", (name) => {
    expect(producesStructuredData(name)).toBe(true);
  });

  it.each([
    // prose artefacts that don't seed a structured table
    "Lessons Learned",
    "Communication Plan",
    "Definition of Done",
    "Sprint Review",
    "Retrospective",
    "Closure Report",
    "Status Report",
    "",
  ])("does not match %s", (name) => {
    expect(producesStructuredData(name)).toBe(false);
  });
});
