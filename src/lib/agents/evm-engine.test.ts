/**
 * Unit tests for EVM engine — pure function tests for computeCompletionFraction
 * and EVM threshold checking that don't require a real database.
 *
 * Note: The evm-engine module imports the db client at top-level. We mock it
 * before importing so the pure function logic can be tested without a DB connection.
 */
import { describe, it, expect, vi } from "vitest";

// Mock the db module to prevent connection errors during unit test
vi.mock("@/lib/db", () => ({
  db: {},
}));

// Now import - the function itself never touches DB in these tests
import { computeCompletionFraction } from "./evm-engine";

describe("computeCompletionFraction", () => {
  it("returns 0 for empty task list", () => {
    expect(computeCompletionFraction([])).toBe(0);
  });

  it("returns 1 when all tasks are DONE", () => {
    const tasks = [
      { status: "DONE" },
      { status: "DONE" },
      { status: "DONE" },
    ];
    expect(computeCompletionFraction(tasks)).toBe(1);
  });

  it("returns 0.5 when DONE + COMPLETE (COMPLETE treated as non-DONE)", async () => {
    // computeCompletionFraction only treats DONE as 100% - COMPLETE is NOT a terminal state
    // This matches EVM semantics where only DONE tasks earn the full weight.
    const tasks = [
      { status: "DONE" },
      { status: "COMPLETE", progress: 0 },
    ];
    expect(computeCompletionFraction(tasks)).toBe(0.5);
  });

  it("returns 0 when all tasks are open", () => {
    const tasks = [
      { status: "OPEN", progress: 0 },
      { status: "TODO", progress: 0 },
    ];
    expect(computeCompletionFraction(tasks)).toBe(0);
  });

  it("weights by estimatedHours when present", () => {
    const tasks = [
      { status: "IN_PROGRESS", progress: 50, estimatedHours: 100 }, // 50% of 100
      { status: "DONE", estimatedHours: 100 },                    // 100% of 100
    ];
    // (50 + 100) / 200 = 0.75
    expect(computeCompletionFraction(tasks)).toBe(0.75);
  });

  it("weights by storyPoints when estimatedHours absent", () => {
    const tasks = [
      { status: "IN_PROGRESS", progress: 50, storyPoints: 8 },
      { status: "DONE", storyPoints: 8 },
    ];
    // (4 + 8) / 16 = 0.75
    expect(computeCompletionFraction(tasks)).toBe(0.75);
  });

  it("uses weight=1 when both effort fields absent", () => {
    const tasks = [
      { status: "IN_PROGRESS", progress: 50 },
      { status: "DONE" },
    ];
    // (0.5 + 1) / 2 = 0.75
    expect(computeCompletionFraction(tasks)).toBe(0.75);
  });

  it("clamps progress to 0-100 range", () => {
    const tasks = [
      { status: "IN_PROGRESS", progress: -50 },
      { status: "IN_PROGRESS", progress: 150 },
    ];
    // (-50 -> 0, 150 -> 100) = (0 + 1) / 2 = 0.5
    expect(computeCompletionFraction(tasks)).toBe(0.5);
  });

  it("ignores task weight when status is DONE (uses 100%)", () => {
    const tasks = [
      { status: "DONE", progress: 0, estimatedHours: 1000 },
    ];
    expect(computeCompletionFraction(tasks)).toBe(1);
  });

  it("handles null/undefined progress gracefully", () => {
    const tasks = [
      { status: "IN_PROGRESS" },
      { status: "DONE" },
    ];
    expect(computeCompletionFraction(tasks)).toBe(0.5);
  });

  it("ignores negative weights (uses 1 instead)", () => {
    const tasks = [
      { status: "IN_PROGRESS", progress: 50, estimatedHours: -10 },
      { status: "DONE" },
    ];
    expect(computeCompletionFraction(tasks)).toBe(0.75);
  });
});