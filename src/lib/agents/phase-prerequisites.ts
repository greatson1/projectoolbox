/**
 * Pure logic for evaluating phase-gate prerequisites against project state.
 *
 * Each methodology phase declares preRequisites in methodology-definitions
 * (e.g. "Outline Business Case approved by sponsor"). This module decides
 * which of those are satisfied based on the actual project — approved
 * artefacts, identified stakeholders, completed approvals — without
 * making any DB calls of its own. The caller passes the project state in.
 *
 * The matching is heuristic on purpose: prereq text is free-form English
 * and we'd rather report "evidence found" or "manual confirmation needed"
 * than try to LLM-classify each one.
 */

import type { GatePreRequisite } from "@/lib/methodology-definitions";

export interface PrerequisiteEvalContext {
  approvedArtefactNames: string[];
  rejectedArtefactNames: string[];
  draftArtefactNames: string[];
  /** Stakeholder roles present on the project (lowercase). */
  stakeholderRoles: string[];
  /** Phase gate approvals that have been marked APPROVED. */
  approvedPhaseGateNames: string[];
  /** True if at least one risk has been logged on the project. */
  hasRisks: boolean;
}

export type PrerequisiteState = "met" | "rejected" | "draft" | "unmet" | "manual";

export interface EvaluatedPrerequisite extends GatePreRequisite {
  state: PrerequisiteState;
  evidence?: string;
}

const ARTEFACT_KEYWORDS = [
  "Project Brief",
  "Outline Business Case",
  "Business Case",
  "Project Charter",
  "Charter",
  "Requirements Specification",
  "Feasibility Study",
  "Stakeholder Register",
  "Risk Register",
  "Communication Plan",
  "Cost Management Plan",
  "Quality Management Plan",
  "Procurement Plan",
  "Work Breakdown Structure",
  "Project Initiation Document",
  "Lessons Learnt Report",
  "Closure Report",
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Best-effort: scan the prereq description for an artefact name we know
 * about. Returns the matched canonical artefact name or null.
 */
function findArtefactReferenced(description: string): string | null {
  const desc = normalize(description);
  for (const candidate of ARTEFACT_KEYWORDS) {
    if (desc.includes(normalize(candidate))) return candidate;
  }
  return null;
}

function findArtefactInList(name: string, list: string[]): string | null {
  const target = normalize(name);
  for (const item of list) {
    const itemN = normalize(item);
    if (itemN === target || itemN.includes(target) || target.includes(itemN)) return item;
  }
  return null;
}

const STAKEHOLDER_ROLE_HINTS: Record<string, string[]> = {
  sponsor: ["sponsor", "executive"],
  pm: ["project manager", "pm"],
  team: ["team", "delivery team", "developer", "engineer"],
  board: ["project board", "steering"],
  customer: ["customer", "client"],
};

function findStakeholderHint(description: string): string | null {
  const desc = normalize(description);
  for (const [hint, words] of Object.entries(STAKEHOLDER_ROLE_HINTS)) {
    if (words.some(w => desc.includes(w))) return hint;
  }
  return null;
}

function rolesMatchHint(roles: string[], hint: string): boolean {
  const words = STAKEHOLDER_ROLE_HINTS[hint] ?? [hint];
  return roles.some(r => {
    const rN = normalize(r);
    return words.some(w => rN.includes(w));
  });
}

export function evaluatePrerequisite(
  prereq: GatePreRequisite,
  ctx: PrerequisiteEvalContext,
): EvaluatedPrerequisite {
  const desc = prereq.description;
  const descN = normalize(desc);

  // 1. Artefact-driven prereq — most common pattern
  const artefactName = findArtefactReferenced(desc);
  if (artefactName) {
    const approved = findArtefactInList(artefactName, ctx.approvedArtefactNames);
    if (approved) {
      return { ...prereq, state: "met", evidence: `${approved} is APPROVED` };
    }
    const rejected = findArtefactInList(artefactName, ctx.rejectedArtefactNames);
    if (rejected) {
      return { ...prereq, state: "rejected", evidence: `${rejected} was REJECTED — fix and re-approve` };
    }
    const draft = findArtefactInList(artefactName, ctx.draftArtefactNames);
    if (draft) {
      return { ...prereq, state: "draft", evidence: `${draft} is in DRAFT — needs approval` };
    }
    return { ...prereq, state: "unmet", evidence: `${artefactName} not yet generated` };
  }

  // 2. Phase gate already passed
  if (descN.includes("gate") || descN.includes("authorise") || descN.includes("authorize")) {
    if (ctx.approvedPhaseGateNames.length > 0) {
      return { ...prereq, state: "met", evidence: `Phase gate approved` };
    }
  }

  // 3. Stakeholder presence
  const stakeholderHint = findStakeholderHint(desc);
  if (stakeholderHint && (descN.includes("identif") || descN.includes("appoint") || descN.includes("confirm"))) {
    if (rolesMatchHint(ctx.stakeholderRoles, stakeholderHint)) {
      return { ...prereq, state: "met", evidence: `${stakeholderHint} stakeholder identified` };
    }
    return { ...prereq, state: "unmet", evidence: `No ${stakeholderHint} stakeholder on the register` };
  }

  // 4. Risk register populated
  if (descN.includes("risk") && (descN.includes("identif") || descN.includes("assess") || descN.includes("logged"))) {
    return ctx.hasRisks
      ? { ...prereq, state: "met", evidence: "Risks logged in register" }
      : { ...prereq, state: "unmet", evidence: "No risks logged yet" };
  }

  // 5. Generic — needs human confirmation, can't auto-evaluate.
  // requiresHumanApproval also lands here unless one of the rules above caught it.
  return { ...prereq, state: "manual" };
}

export function evaluatePrerequisites(
  prereqs: GatePreRequisite[],
  ctx: PrerequisiteEvalContext,
): EvaluatedPrerequisite[] {
  return prereqs.map(p => evaluatePrerequisite(p, ctx));
}

/**
 * Summarise an evaluated list — used to drive the gate's overall status.
 * A phase can advance when every mandatory prereq is met. Manual prereqs
 * count as unmet for advancement purposes (the user must tick them).
 */
export function summarisePrerequisites(evaluated: EvaluatedPrerequisite[]): {
  total: number;
  met: number;
  blockers: number;
  manual: number;
  canAdvance: boolean;
} {
  let met = 0;
  let blockers = 0;
  let manual = 0;
  for (const p of evaluated) {
    if (p.state === "met") met += 1;
    else if (p.state === "manual") manual += 1;
    else if (p.isMandatory) blockers += 1;
  }
  const canAdvance = blockers === 0 && manual === 0;
  return { total: evaluated.length, met, blockers, manual, canAdvance };
}
