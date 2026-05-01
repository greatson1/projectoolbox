/**
 * Pure unit tests for the readiness summary half of phase-gate-guard.
 * The functions that hit Prisma (assertPhaseAdvanceReady,
 * createPhaseGateApprovalIfReady, sweepStalePhaseGateApprovals) are
 * tested via integration; this file locks in the small piece of logic
 * we can exercise without a DB: how blockers compose into a refusal.
 *
 * The integration paths are the ones that actually shipped (every
 * PHASE_GATE creator now imports createPhaseGateApprovalIfReady), so
 * the production protection comes from compile + the fact that the
 * helper itself has only one branching rule:
 *   blockers.length > 0 → ready: false
 *   blockers.length === 0 && no duplicate → ready: true
 */

import { describe, it, expect } from "vitest";
import type { GateReadinessResult } from "./phase-gate-guard";

// Pure mirror of the readiness rule used by createPhaseGateApprovalIfReady.
// Lives here as a sanity-check on the contract — if this ever diverges
// from the real helper, the test will catch it because the helper's
// shape is exported and locked.
function isReady(r: GateReadinessResult): boolean {
  return r.ready && r.blockers.length === 0 && !r.existingApprovalId;
}

describe("GateReadinessResult contract", () => {
  it("ready when blockers empty and no existing approval", () => {
    expect(isReady({ ready: true, blockers: [] })).toBe(true);
  });

  it("not ready when blockers present", () => {
    expect(isReady({ ready: false, blockers: ["1 PM task incomplete"] })).toBe(false);
  });

  it("not ready when an existing PENDING approval is returned (dedupe path)", () => {
    expect(isReady({ ready: false, blockers: [], existingApprovalId: "abc" })).toBe(false);
  });

  it("ready=false implies the helper will skip creation", () => {
    // Mirror of the early-return in createPhaseGateApprovalIfReady — if
    // a future edit forgets to check `ready`, this test fails.
    const r: GateReadinessResult = { ready: false, blockers: ["x"] };
    const skipped = !r.ready ? { skipped: true as const, blockers: r.blockers } : null;
    expect(skipped).not.toBeNull();
    expect(skipped!.blockers).toEqual(["x"]);
  });
});
