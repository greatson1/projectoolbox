/**
 * Pure banner-composition helpers for the phase-next-action resolver.
 *
 * Lives in its own file so vitest can import it without dragging in the
 * resolver's db / Prisma imports. The resolver re-exports composeReviewBanner
 * so call sites stay where they were.
 */

/**
 * Compose the banner label + reason extras for the review_artefacts step.
 *
 * Three shapes:
 *   1. `draftCount > 0` AND `missingRequired > 0` → composite:
 *        "Review N draft · M required still to generate"
 *      Surfaces both pieces of work in one banner so the user doesn't
 *      have to clear the queue first only to discover the gap.
 *   2. `draftCount === 0` AND `missingRequired > 0` → generation framing:
 *        "Generate M required {phase} artefact[s]"
 *      Edge case: every existing draft is approved but the methodology
 *      requires more that don't yet exist. (The resolver still classifies
 *      this as step "review_artefacts" because pct < 100, but the user-
 *      facing copy honestly describes generation work.)
 *   3. `missingRequired === 0` (only drafts remain) → original:
 *        "Review N draft artefact[s]"
 */
export function composeReviewBanner(input: {
  draftCount: number;
  missingRequired: number;
  phaseName: string;
}): { bannerLabel: string; reasonExtras: string } {
  const { draftCount, missingRequired, phaseName } = input;
  if (missingRequired > 0 && draftCount > 0) {
    return {
      bannerLabel: `Review ${draftCount} draft · ${missingRequired} required still to generate`,
      reasonExtras: ` · ${missingRequired} required artefact${missingRequired === 1 ? "" : "s"} not yet generated`,
    };
  }
  if (missingRequired > 0 && draftCount === 0) {
    return {
      bannerLabel: `Generate ${missingRequired} required ${phaseName} artefact${missingRequired === 1 ? "" : "s"}`,
      reasonExtras: "",
    };
  }
  return {
    bannerLabel: `Review ${draftCount} draft artefact${draftCount === 1 ? "" : "s"}`,
    reasonExtras: "",
  };
}
