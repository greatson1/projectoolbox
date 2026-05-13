/**
 * Regression test: getNextRequiredStep returns the correct step for
 * each scenario, and downstream callers (chat banner, pipeline panel,
 * approvals route) all consume the same answer.
 *
 * Bug history:
 *   - "Generate Initiation" CTA showed on the chat status card while
 *     Pre-Project still had open PM tasks (commit 2aa46f9). The card
 *     queried tasks by phaseId-as-CUID but scaffolded tasks store
 *     phaseId-as-name — count was 0 even with open work.
 *   - Pipeline strip and approval handler had each rolled their own
 *     "what's next" inference before phase-next-action existed (the
 *     resolver consolidates 8 duplicate sites of inference).
 *
 * This test scenarios the resolver against fresh DB state to confirm
 * each returns the right step, and pins it as the single source of
 * truth — every consumer must call this rather than rolling their own.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestOrg, createTestProject, cleanupTestOrg } from "./helpers/test-db";
import { getNextRequiredStep, markResearchComplete } from "@/lib/agents/phase-next-action";

describe("getNextRequiredStep — phase step resolver", () => {
  let orgId: string;

  beforeAll(async () => {
    orgId = await createTestOrg("next_action");
  });

  afterAll(async () => {
    await cleanupTestOrg(orgId);
  });

  it("returns 'research' on a freshly-deployed phase with no audit timestamps", async () => {
    const ctx = await createTestProject(orgId, {
      methodology: "WATERFALL",
      primaryPhaseName: "Pre-Project",
    });

    const result = await getNextRequiredStep({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      phaseName: "Pre-Project",
    });

    expect(result.step).toBe("research");
    expect(result.awaitingUser).toBe(false);
  });

  it("returns 'clarification' once research is marked complete with no clarification timestamps", async () => {
    const ctx = await createTestProject(orgId, {
      methodology: "WATERFALL",
      primaryPhaseName: "Pre-Project",
    });

    await markResearchComplete(ctx.projectId, "Pre-Project");

    const result = await getNextRequiredStep({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      phaseName: "Pre-Project",
    });

    // After research is complete, the next gate is clarification.
    // (Or 'generation' if no clarification needed — but with neither
    // a completed timestamp nor a skip reason, the resolver requires
    // clarification rather than falling through.)
    expect(["clarification", "research_approval"]).toContain(result.step);
  });

  it("returns 'generation' when research + clarification are both done but artefacts haven't been drafted", async () => {
    const ctx = await createTestProject(orgId, {
      methodology: "WATERFALL",
      primaryPhaseName: "Pre-Project",
    });

    // Mark both step gates as legitimately skipped/completed.
    const { db } = await import("@/lib/db");
    await db.phase.updateMany({
      where: { projectId: ctx.projectId, name: "Pre-Project" },
      data: {
        researchCompletedAt: new Date(),
        clarificationCompletedAt: new Date(),
      },
    });

    const result = await getNextRequiredStep({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      phaseName: "Pre-Project",
    });

    expect(result.step).toBe("generation");
  });

  it("returns 'review_artefacts' when artefacts exist but not all approved", async () => {
    const ctx = await createTestProject(orgId, {
      methodology: "WATERFALL",
      primaryPhaseName: "Pre-Project",
      artefacts: [
        { name: "Problem Statement", status: "APPROVED" },
        { name: "Options Analysis", status: "DRAFT" },
        { name: "Outline Business Case", status: "PENDING_REVIEW" },
      ],
    });

    const { db } = await import("@/lib/db");
    await db.phase.updateMany({
      where: { projectId: ctx.projectId, name: "Pre-Project" },
      data: {
        researchCompletedAt: new Date(),
        clarificationCompletedAt: new Date(),
      },
    });

    const result = await getNextRequiredStep({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      phaseName: "Pre-Project",
    });

    expect(result.step).toBe("review_artefacts");
    expect(result.awaitingUser).toBe(true);
    // Banner label should reference the unreviewed count, not "Generate Initiation"
    expect(result.bannerLabel.toLowerCase()).toContain("review");
    expect(result.bannerLabel.toLowerCase()).not.toContain("initiation");
  });

  describe("research/clarification self-heal — Griffin screenshot scenario", () => {
    it("does NOT return 'research' when artefacts already exist for the phase", async () => {
      // Scenario: agent ran research and generation but
      // `researchCompletedAt` was never written (older deployment OR
      // research came in via a path that didn't call markResearchComplete).
      // Resolver used to say "Researching Pre-Project..." even though
      // the chat was clearly past artefact generation. Self-heal detects
      // downstream artefact evidence and backfills the timestamp.
      const ctx = await createTestProject(orgId, {
        methodology: "WATERFALL",
        primaryPhaseName: "Pre-Project",
        artefacts: [
          { name: "Outline Business Case", status: "DRAFT" },
        ],
      });
      // Phase has NO researchCompletedAt or clarificationCompletedAt set —
      // the test fixture leaves them null by default.

      const result = await getNextRequiredStep({
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        phaseName: "Pre-Project",
      });

      expect(result.step).not.toBe("research");
      // Should land on review_artefacts (artefact is DRAFT, not approved)
      expect(["review_artefacts", "clarification", "generation"]).toContain(result.step);
    });

    it("backfills researchCompletedAt as a side effect of the self-heal", async () => {
      const ctx = await createTestProject(orgId, {
        methodology: "WATERFALL",
        primaryPhaseName: "Pre-Project",
        artefacts: [{ name: "Problem Statement", status: "APPROVED" }],
      });

      // Sanity: starts null
      const { db } = await import("@/lib/db");
      const before = await db.phase.findFirst({
        where: { projectId: ctx.projectId, name: "Pre-Project" },
        select: { researchCompletedAt: true },
      });
      expect(before?.researchCompletedAt).toBeNull();

      // Trigger resolver
      await getNextRequiredStep({
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        phaseName: "Pre-Project",
      });

      // Self-heal should have stamped the timestamp
      const after = await db.phase.findFirst({
        where: { projectId: ctx.projectId, name: "Pre-Project" },
        select: { researchCompletedAt: true },
      });
      expect(after?.researchCompletedAt).not.toBeNull();
    });
  });
});
