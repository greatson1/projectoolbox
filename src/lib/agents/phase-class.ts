/**
 * Phase classifier.
 *
 * Every methodology has different names for the same conceptual buckets:
 *
 *   - "front"     — phases where the project is being *defined* and *planned*.
 *                   These benefit from outward-looking research (benchmarks,
 *                   rates, governance norms) because the team is still
 *                   answering "what are we doing and how".
 *
 *   - "execution" — phases where the project is being *delivered*. By now
 *                   external best-practice research is wasted bandwidth;
 *                   what the user actually needs is a status report on
 *                   their own project — schedule drift, risk materialisation,
 *                   cost variance, open issues. So we scan the DB instead
 *                   of Perplexity.
 *
 *   - "closing"   — phases where the project is being *wrapped up*. Same
 *                   "scan your own project" pattern: lessons captured,
 *                   benefits realisation, outstanding loose ends. Web
 *                   search for "project closure best practices" is noise.
 *
 * The phase-advance flow uses this classifier to pick the right
 * context-gathering step. Unknown phase names default to "front" so the
 * existing research path is the safe fallback — it produces *something*
 * generic rather than nothing.
 */

export type PhaseClass = "front" | "execution" | "closing";

const FRONT_PHASES = new Set([
  "pre-project",
  "pre project",
  "preproject",
  "starting up",
  "starting up a project",
  "initiation",
  "initiating",
  "directing",
  "directing a project",
  "design",
  "requirements",
  "planning",
  "foundation",
  "setup",
  "sprint zero",
  "pi planning",
  "feasibility",
  "scoping",
  "discovery",
  "concept",
]);

const EXECUTION_PHASES = new Set([
  "execution",
  "executing",
  "execute",
  "build",
  "implementation",
  "implement",
  "delivery",
  "deliver",
  "managing product delivery",
  "controlling a stage",
  "controlling",
  "sprint cadence",
  "iteration cadence",
  "iterative delivery",
  "continuous delivery",
  "deploy",
  "deployment",
  "release",
  "test",
  "testing",
  "monitor",
  "monitoring and control",
  "monitoring and controlling",
  "operate",
  "operations",
]);

const CLOSING_PHASES = new Set([
  "closing",
  "closure",
  "close",
  "close out",
  "closeout",
  "managing a stage boundary",
  "stage boundary",
  "inspect and adapt",
  "inspect & adapt",
  "review",
  "post-project",
  "post project",
  "wrap up",
  "wrap-up",
  "handover",
  "hand over",
]);

/**
 * Classify a phase name into the bucket that determines its advance
 * pipeline. Case- and punctuation-insensitive.
 */
export function classifyPhase(phaseName: string | null | undefined): PhaseClass {
  if (!phaseName) return "front";
  const normalised = phaseName
    .toLowerCase()
    .replace(/[^a-z0-9\s&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (EXECUTION_PHASES.has(normalised)) return "execution";
  if (CLOSING_PHASES.has(normalised)) return "closing";
  if (FRONT_PHASES.has(normalised)) return "front";

  // Substring fallbacks for compound phase names like
  // "Execution Phase Test" or "Closing & Handover".
  for (const p of EXECUTION_PHASES) if (normalised.includes(p)) return "execution";
  for (const p of CLOSING_PHASES) if (normalised.includes(p)) return "closing";
  for (const p of FRONT_PHASES) if (normalised.includes(p)) return "front";

  return "front";
}
