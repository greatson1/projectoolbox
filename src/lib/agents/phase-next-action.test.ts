/**
 * Pure unit tests for the pieces of the phase-next-action resolver that
 * don't touch the DB. The full resolver hits Prisma in several branches —
 * those are covered by integration. This file locks in the banner
 * composition contract used by the chat banner, Process Pipeline, PM
 * Tracker and the bottom status bar.
 *
 * Regression target: user on a Scrum/Sprint Zero project reported the
 * banner said "Review 1 draft artefact" while a methodology-required
 * artefact had never been generated. The user had no way to see both
 * pieces of work without first clearing the review queue. composeReviewBanner
 * now folds both into one banner.
 */

import { describe, it, expect } from "vitest";
import { composeReviewBanner } from "./phase-next-action-banner";

describe("composeReviewBanner", () => {
  it("composite — both drafts to review AND required to generate", () => {
    const out = composeReviewBanner({ draftCount: 1, missingRequired: 1, phaseName: "Sprint Zero" });
    expect(out.bannerLabel).toBe("Review 1 draft · 1 required still to generate");
    expect(out.reasonExtras).toBe(" · 1 required artefact not yet generated");
  });

  it("composite — pluralises required count > 1", () => {
    const out = composeReviewBanner({ draftCount: 2, missingRequired: 3, phaseName: "Planning" });
    expect(out.bannerLabel).toBe("Review 2 draft · 3 required still to generate");
    expect(out.reasonExtras).toBe(" · 3 required artefacts not yet generated");
  });

  it("generation framing when every existing draft is approved but requireds missing", () => {
    const out = composeReviewBanner({ draftCount: 0, missingRequired: 2, phaseName: "Sprint Zero" });
    expect(out.bannerLabel).toBe("Generate 2 required Sprint Zero artefacts");
    expect(out.reasonExtras).toBe("");
  });

  it("generation framing — single required artefact (no plural)", () => {
    const out = composeReviewBanner({ draftCount: 0, missingRequired: 1, phaseName: "Planning" });
    expect(out.bannerLabel).toBe("Generate 1 required Planning artefact");
  });

  it("plain review when methodology is satisfied, only review work remains", () => {
    const out = composeReviewBanner({ draftCount: 3, missingRequired: 0, phaseName: "Planning" });
    expect(out.bannerLabel).toBe("Review 3 draft artefacts");
    expect(out.reasonExtras).toBe("");
  });

  it("plain review — pluralises draft count correctly", () => {
    expect(composeReviewBanner({ draftCount: 1, missingRequired: 0, phaseName: "X" }).bannerLabel)
      .toBe("Review 1 draft artefact");
    expect(composeReviewBanner({ draftCount: 4, missingRequired: 0, phaseName: "X" }).bannerLabel)
      .toBe("Review 4 draft artefacts");
  });

  it("no work — still returns a coherent label (caller decides whether to use it)", () => {
    const out = composeReviewBanner({ draftCount: 0, missingRequired: 0, phaseName: "X" });
    expect(out.bannerLabel).toBe("Review 0 draft artefacts");
  });
});
