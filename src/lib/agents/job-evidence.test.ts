import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { jobEvidenceError } from "./job-queue";

describe("jobEvidenceError (output-evidence contract)", () => {
  it("refuses lifecycle_init without produced artefacts", () => {
    expect(jobEvidenceError("lifecycle_init", undefined)).toMatch(/without output evidence/);
    expect(jobEvidenceError("lifecycle_init", { processedAt: "x" })).toMatch(/artefactsCreated/);
    expect(jobEvidenceError("lifecycle_init", { artefactsCreated: 0 })).toMatch(/artefactsCreated/);
  });

  it("accepts lifecycle_init with artefact evidence", () => {
    expect(jobEvidenceError("lifecycle_init", { artefactsCreated: 3 })).toBeNull();
    expect(jobEvidenceError("lifecycle_init", { artefactIds: ["a1"] })).toBeNull();
  });

  it("requires a reportId for report_generate", () => {
    expect(jobEvidenceError("report_generate", { done: true })).toMatch(/reportId/);
    expect(jobEvidenceError("report_generate", { reportId: "r1" })).toBeNull();
  });

  it("requires any non-empty result for other job types", () => {
    expect(jobEvidenceError("autonomous_cycle", undefined)).toMatch(/without output evidence/);
    expect(jobEvidenceError("autonomous_cycle", {})).toMatch(/without output evidence/);
    expect(jobEvidenceError("autonomous_cycle", { action: "no_action_needed" })).toBeNull();
    expect(jobEvidenceError("approval_resume", { action: "executed", target: "task" })).toBeNull();
  });
});
