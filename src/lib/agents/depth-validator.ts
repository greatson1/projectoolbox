/**
 * Post-generation depth validator.
 *
 * The phase-depth config tells Sonnet how detailed each phase's artefacts
 * should be ("Planning WBS must have 30-50 rows minimum"), but the model
 * sometimes ignores the instruction and produces something thinner —
 * a 12-row WBS for Planning, a 3-risk Risk Register for Initiation.
 * Without an automated check, those slip into APPROVED state and the
 * project ends up with shallow artefacts.
 *
 * This validator runs after generation, on the saved content, and flags
 * artefacts that are below the depth threshold for their phase + type.
 * It does NOT regenerate or block — it sets `metadata.depthWarning` on
 * the artefact so the UI can surface "shallower than the methodology
 * expects (12 rows; target ≥ 25)" and the reviewer can request a regen
 * before approving.
 *
 * Conservative on purpose: only flags clear shortfalls (≤ 60% of the
 * target), not borderline cases. The model writes good prose; we only
 * want to catch genuinely thin tables.
 */

import { classifyPhase, type PhaseClass } from "./phase-class";

export interface DepthCheck {
  artefactName: string;
  metric: "rows" | "wordCount" | "sections";
  observed: number;
  target: number;
  /** Soft target: warning. Hard target: would justify regeneration. */
  severity: "warning" | "shortfall";
  message: string;
}

export interface DepthAssessment {
  warnings: DepthCheck[];
  /** Overall — true if any shortfall (not just warning). */
  hasShortfall: boolean;
}

/**
 * Count CSV / markdown-table rows in a body of content. Handles both CSV
 * (comma-delimited) and markdown pipe tables; ignores headers and
 * separator rows.
 */
function countTableRows(content: string): number {
  if (!content) return 0;
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Markdown table: lines starting with `|` and containing `|` mid-line.
  const pipeRows = lines.filter(l => l.startsWith("|") && l.lastIndexOf("|") > 0);
  if (pipeRows.length >= 3) {
    // Drop the header row and the `|---|---|` separator row.
    const sepIdx = pipeRows.findIndex(l => /^\|\s*[-:|\s]+\|$/.test(l));
    if (sepIdx >= 0) return Math.max(0, pipeRows.length - sepIdx - 1);
    return Math.max(0, pipeRows.length - 1);
  }
  // CSV: lines with at least one comma, excluding the header.
  const csvRows = lines.filter(l => l.includes(","));
  if (csvRows.length >= 2) return csvRows.length - 1;
  return 0;
}

function countWords(content: string): number {
  if (!content) return 0;
  return content.trim().split(/\s+/).filter(Boolean).length;
}

function countMarkdownSections(content: string): number {
  if (!content) return 0;
  return (content.match(/^#{1,3}\s+\S/gm) || []).length;
}

/**
 * Depth thresholds by artefact name fragment + phase class. A target is a
 * "minimum acceptable" floor — observed values below 60% of target are
 * flagged as "shortfall" (likely needs regen); values between 60% and
 * 100% are flagged as "warning" (reviewer should look).
 *
 * Name match is case-insensitive substring. First match wins.
 */
const DEPTH_RULES: Array<{
  /** Lowercased fragment(s) — artefact name must include one. */
  match: string[];
  /** Phase classes this rule applies to (any if omitted). */
  phaseClasses?: PhaseClass[];
  metric: "rows" | "wordCount" | "sections";
  target: number;
  label: string;
}> = [
  // Planning-phase tables — these are the headline depth claims in
  // phase-depth.ts ("30-50 rows minimum", etc.) — enforce a 25-row floor.
  { match: ["wbs", "work breakdown"], phaseClasses: ["front"], metric: "rows", target: 25, label: "WBS" },
  { match: ["schedule"], phaseClasses: ["front"], metric: "rows", target: 20, label: "Schedule" },

  // Risk Register — Initiation says 10-15, Planning expects it carried
  // forward and refined. Catch the "3-risk Risk Register" case.
  { match: ["risk register", "risk log"], phaseClasses: ["front"], metric: "rows", target: 8, label: "Risk Register" },
  { match: ["risk register", "risk log"], phaseClasses: ["execution"], metric: "rows", target: 10, label: "Risk Register" },

  // Stakeholder Register — should have at least sponsor, PM, key user
  // groups, and externals. 5 is the floor.
  { match: ["stakeholder register", "stakeholder log"], metric: "rows", target: 5, label: "Stakeholder Register" },

  // Cost Plan — bottom-up estimate from WBS, so should track at least
  // half of the WBS row count. 10 line items is the floor.
  { match: ["cost plan", "cost management plan", "cost estimate"], phaseClasses: ["front"], metric: "rows", target: 10, label: "Cost Plan" },

  // RACI Matrix — every deliverable mapped. 8 row floor.
  { match: ["raci"], phaseClasses: ["front"], metric: "rows", target: 8, label: "RACI Matrix" },

  // Product Backlog — Sprint Zero says 15-25 user stories minimum.
  { match: ["product backlog", "user story backlog"], metric: "rows", target: 12, label: "Product Backlog" },

  // Non-tabular: substantive docs should have multiple sections + minimum
  // word count. Catches "Project Charter: one paragraph" sins.
  { match: ["project charter", "pid", "project initiation document"], metric: "wordCount", target: 600, label: "Charter / PID" },
  { match: ["business case"], phaseClasses: ["front"], metric: "wordCount", target: 800, label: "Business Case" },
  { match: ["status report"], metric: "sections", target: 4, label: "Status Report" },
  { match: ["lessons learned", "retrospective"], metric: "wordCount", target: 400, label: "Lessons Learned" },
];

/**
 * Inspect a single artefact's content against the depth rules for its
 * phase class. Returns `null` if nothing to flag, or a DepthCheck if the
 * artefact falls short.
 */
function checkArtefact(
  artefactName: string,
  content: string,
  phaseName: string,
): DepthCheck | null {
  const nameLower = artefactName.toLowerCase();
  const phaseClass = classifyPhase(phaseName);

  for (const rule of DEPTH_RULES) {
    const nameMatch = rule.match.some(frag => nameLower.includes(frag));
    if (!nameMatch) continue;
    if (rule.phaseClasses && !rule.phaseClasses.includes(phaseClass)) continue;

    const observed =
      rule.metric === "rows" ? countTableRows(content)
      : rule.metric === "wordCount" ? countWords(content)
      : countMarkdownSections(content);

    if (observed >= rule.target) return null; // hit the target

    const ratio = observed / rule.target;
    const severity: "warning" | "shortfall" = ratio < 0.6 ? "shortfall" : "warning";
    const unit =
      rule.metric === "rows" ? `row${observed === 1 ? "" : "s"}`
      : rule.metric === "wordCount" ? "words"
      : `section${observed === 1 ? "" : "s"}`;
    return {
      artefactName,
      metric: rule.metric,
      observed,
      target: rule.target,
      severity,
      message: `${rule.label} produced ${observed} ${unit}; methodology depth for ${phaseClass}-phase expects at least ${rule.target}. ${severity === "shortfall" ? "Likely too thin — request a regenerate before approving." : "Borderline — review carefully before approving."}`,
    };
  }

  return null;
}

/**
 * Assess every just-generated artefact against the depth rules for the
 * phase they were produced for. Returns a list of warnings/shortfalls
 * the caller can persist to artefact metadata.
 */
export function assessArtefactDepth(
  artefacts: { name: string; content: string }[],
  phaseName: string,
): DepthAssessment {
  const warnings: DepthCheck[] = [];
  for (const a of artefacts) {
    const check = checkArtefact(a.name, a.content || "", phaseName);
    if (check) warnings.push(check);
  }
  return {
    warnings,
    hasShortfall: warnings.some(w => w.severity === "shortfall"),
  };
}

/** Single-artefact version for use immediately after a create call. */
export function assessSingleArtefactDepth(
  name: string,
  content: string,
  phaseName: string,
): DepthCheck | null {
  return checkArtefact(name, content, phaseName);
}
