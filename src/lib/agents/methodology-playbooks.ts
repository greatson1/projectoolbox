/**
 * Methodology Lifecycle Playbooks
 *
 * Per spec Section 3.3: When an agent is deployed, it loads the full lifecycle
 * playbook for the project's methodology and drives the project through each stage.
 * The agent doesn't wait to be told what comes next — it knows.
 *
 * Each playbook defines:
 *   - Phases in execution order
 *   - Required artefacts per phase
 *   - Gate criteria for advancing
 *   - Actions the agent should take at each stage
 */

import { db } from "@/lib/db";
import type { ActionProposal } from "./decision-classifier";
import { getMethodology, getPhaseArtefacts } from "@/lib/methodology-definitions";

// ─── Playbook Definitions ───

interface PhasePlaybook {
  name: string;
  actions: PlaybookAction[];
  gateCriteria: string[];
  artefacts: string[];
}

interface PlaybookAction {
  type: string;
  description: string;
  trigger: "on_entry" | "daily" | "weekly" | "on_completion" | "on_gate_ready";
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

const PRINCE2_PLAYBOOK: PhasePlaybook[] = [
  {
    name: "Pre-Project",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate Project Initiation Document (PID): scope, objectives, business case, delivery approach", trigger: "on_entry", riskLevel: "LOW" },
      { type: "RISK_RESPONSE", description: "Conduct initial risk assessment and create preliminary risk register", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Create initial project team assignments and RACI matrix", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["PID approved", "Business case validated", "Project Board identified"],
    artefacts: ["Problem Statement", "Options Analysis", "Outline Business Case", "Project Brief"],
  },
  {
    name: "Initiation",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate Project Charter with governance structure and stakeholder map", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce detailed Business Case with cost-benefit analysis", trigger: "on_entry", riskLevel: "LOW" },
      { type: "RISK_RESPONSE", description: "Build comprehensive risk register with P/I scoring", trigger: "on_entry", riskLevel: "LOW" },
      { type: "COMMUNICATION", description: "Create stakeholder register and communication plan", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["Charter signed", "Business Case approved", "Team resourced", "Risk register populated"],
    artefacts: ["Project Charter", "Business Case", "Stakeholder Register", "Initial Risk Register", "Communication Plan"],
  },
  {
    name: "Planning",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate Work Breakdown Structure (WBS) from project scope", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Create schedule baseline with dependencies and critical path", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce resource plan and budget breakdown", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Generate quality plan and risk management plan", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Create and assign all planning tasks from WBS", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["WBS complete", "Schedule baselined", "Budget approved", "Risk management plan defined", "Quality plan accepted"],
    artefacts: ["WBS", "Schedule Baseline", "Budget Breakdown", "Risk Management Plan", "Quality Plan", "Resource Plan"],
  },
  {
    name: "Execution",
    actions: [
      { type: "TASK_ASSIGNMENT", description: "Monitor daily task completion vs plan and flag deviations", trigger: "daily", riskLevel: "LOW" },
      { type: "RISK_RESPONSE", description: "Re-score risks weekly based on project progress data", trigger: "weekly", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Generate weekly Highlight Report for Project Board", trigger: "weekly", riskLevel: "LOW" },
      { type: "COMMUNICATION", description: "Send weekly status update to stakeholders", trigger: "weekly", riskLevel: "MEDIUM" },
      { type: "ESCALATION", description: "Escalate exceptions: tasks >24h overdue, budget >80% consumed, critical path affected", trigger: "daily", riskLevel: "MEDIUM" },
    ],
    gateCriteria: ["All deliverables complete", "Quality reviews passed", "Acceptance criteria met", "Lessons log updated"],
    artefacts: ["Status Reports", "Risk Reviews", "Exception Reports", "Quality Review Records"],
  },
  {
    name: "Closing",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate End Project Report with performance analysis", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Compile Lessons Learned report from project data", trigger: "on_entry", riskLevel: "LOW" },
      { type: "COMMUNICATION", description: "Send project closure notification to all stakeholders", trigger: "on_completion", riskLevel: "MEDIUM" },
      { type: "TASK_ASSIGNMENT", description: "Archive all project artefacts and close open items", trigger: "on_completion", riskLevel: "LOW" },
    ],
    gateCriteria: ["End Project Report approved", "Lessons Learned documented", "All artefacts archived"],
    artefacts: ["Acceptance Certificate", "End Project Report", "Lessons Learned", "Closure Report"],
  },
];

const WATERFALL_PLAYBOOK: PhasePlaybook[] = [
  {
    name: "Requirements",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Produce Project Brief: scope, objectives, success criteria, constraints, high-level timeline and budget", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Outline Business Case: justification, options analysis, expected benefits, cost-benefit summary, go/no-go recommendation", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Requirements Specification: all functional and non-functional requirements with acceptance criteria", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Feasibility Study: technical, financial, operational, and schedule feasibility assessment", trigger: "on_entry", riskLevel: "LOW" },
      { type: "RISK_RESPONSE", description: "Produce Initial Risk Register: identify top project risks with probability, impact, and initial mitigation", trigger: "on_entry", riskLevel: "LOW" },
      { type: "COMMUNICATION", description: "Produce Initial Stakeholder Register: identify all key stakeholders with role, interest, and influence", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["Project Brief approved", "Outline Business Case approved by sponsor", "Requirements reviewed", "Initial risks identified"],
    artefacts: ["Project Brief", "Outline Business Case", "Requirements Specification", "Feasibility Study", "Initial Risk Register", "Initial Stakeholder Register"],
  },
  {
    name: "Design",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Produce Project Charter: formal project authorisation with governance structure, sponsor authority, and success criteria", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce full Business Case: detailed cost-benefit analysis, options comparison, NPV/ROI, financial justification for sponsor approval", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Stakeholder Register: full analysis with power/interest grid, engagement strategy, and communication preferences", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Communication Plan: RACI for communications, cadence, channels, escalation path", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Design Document: detailed solution design, approach, specifications, and acceptance criteria", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Work Breakdown Structure: full decomposition of deliverables into work packages with ownership", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Schedule with Dependencies: activity list, durations, dependencies, critical path, milestone dates", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Cost Management Plan: budget baseline by work package, cost control thresholds, variance reporting, forecasting approach", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Resource Management Plan: roles, responsibilities, resource allocation, RACI matrix, procurement needs", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Risk Management Plan: risk appetite, response strategies, risk owner assignments, escalation thresholds, review cadence", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Quality Management Plan: quality standards, review gates, acceptance criteria, defect management", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce Change Control Plan: change request process, authority levels, impact assessment approach, change log governance", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["Project Charter signed by sponsor", "Business Case approved", "WBS and Schedule baselined", "Cost Management Plan approved", "All management plans reviewed"],
    artefacts: ["Project Charter", "Business Case", "Stakeholder Register", "Communication Plan", "Design Document", "Work Breakdown Structure", "Schedule with Dependencies", "Cost Management Plan", "Resource Management Plan", "Risk Management Plan", "Quality Management Plan", "Change Control Plan"],
  },
  {
    name: "Build",
    actions: [
      { type: "TASK_ASSIGNMENT", description: "Track daily build progress and code completion", trigger: "daily", riskLevel: "LOW" },
      { type: "ESCALATION", description: "Flag blocked tasks and dependency issues", trigger: "daily", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Generate weekly build status report", trigger: "weekly", riskLevel: "LOW" },
    ],
    gateCriteria: ["All components built", "Unit tests passing"],
    artefacts: ["Code", "Unit Tests"],
  },
  {
    name: "Test",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate test plan from requirements", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Track test execution progress and defect resolution", trigger: "daily", riskLevel: "LOW" },
      { type: "ESCALATION", description: "Escalate critical defects blocking release", trigger: "daily", riskLevel: "MEDIUM" },
    ],
    gateCriteria: ["All critical defects resolved", "UAT sign-off"],
    artefacts: ["Test Plan", "Test Results"],
  },
  {
    name: "Deploy",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate release plan and deployment checklist", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Produce handover documentation for operations", trigger: "on_entry", riskLevel: "LOW" },
      { type: "COMMUNICATION", description: "Notify stakeholders of go-live", trigger: "on_completion", riskLevel: "MEDIUM" },
    ],
    gateCriteria: ["Go-live approved by sponsor", "Operations handover accepted"],
    artefacts: ["Release Plan", "Handover Documentation"],
  },
];

const SAFE_PLAYBOOK: PhasePlaybook[] = [
  {
    name: "PI Planning",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Facilitate PI objectives creation from programme backlog", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Build programme board with team dependencies and milestones", trigger: "on_entry", riskLevel: "LOW" },
      { type: "RISK_RESPONSE", description: "Identify programme-level risks and cross-team dependencies", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["PI objectives agreed", "Team capacity confirmed"],
    artefacts: ["PI Objectives", "Programme Board"],
  },
  {
    name: "Iteration Cadence",
    actions: [
      { type: "TASK_ASSIGNMENT", description: "Track iteration goals and team velocity", trigger: "daily", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Generate system demo readiness report", trigger: "on_gate_ready", riskLevel: "LOW" },
      { type: "ESCALATION", description: "Flag cross-team blockers and dependency issues", trigger: "daily", riskLevel: "MEDIUM" },
    ],
    gateCriteria: ["Iteration goals met", "System demo delivered"],
    artefacts: ["Iteration Plans", "System Demos"],
  },
  {
    name: "Inspect & Adapt",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate PI metrics report: velocity, predictability, quality", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Compile improvement backlog from retrospective data", trigger: "on_entry", riskLevel: "LOW" },
      { type: "COMMUNICATION", description: "Distribute PI summary to programme stakeholders", trigger: "on_completion", riskLevel: "MEDIUM" },
    ],
    gateCriteria: ["PI metrics reviewed", "Improvements prioritised"],
    artefacts: ["PI Report", "Improvement Backlog"],
  },
];

const SCRUM_PLAYBOOK: PhasePlaybook[] = [
  {
    name: "Sprint Zero",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Create initial product backlog from project brief with business value ranking", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Prioritise backlog by business value and dependency", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Define Definition of Done and acceptance criteria framework", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Suggest first sprint scope based on team capacity and velocity baseline", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["Product backlog created", "DoD defined", "Team capacity established", "First sprint planned"],
    artefacts: ["Product Backlog", "Definition of Done", "Sprint 1 Plan"],
  },
  {
    name: "Sprint Cadence",
    actions: [
      { type: "TASK_ASSIGNMENT", description: "Auto-populate sprint backlog from prioritised product backlog based on velocity", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Assign sprint tasks based on team capacity and skill match", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Track daily task completion and update burndown chart", trigger: "daily", riskLevel: "LOW" },
      { type: "RISK_RESPONSE", description: "Identify blocked items and flag velocity drift >15%", trigger: "daily", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Proactively reassign blocked tasks if alternate capacity available", trigger: "daily", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Generate Sprint Review report: velocity, completed vs committed, demo readiness", trigger: "on_gate_ready", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Generate Sprint Retrospective: what went well, what didn't, process improvements", trigger: "on_gate_ready", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Re-prioritise and groom product backlog based on completed work and new inputs", trigger: "weekly", riskLevel: "LOW" },
    ],
    gateCriteria: ["Sprint backlog items complete or carried over", "Sprint Review conducted", "Retrospective complete"],
    artefacts: ["Sprint Backlog", "Burndown Chart", "Sprint Review Report", "Retrospective Summary"],
  },
  {
    name: "Release",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate release notes and deployment checklist", trigger: "on_entry", riskLevel: "LOW" },
      { type: "COMMUNICATION", description: "Notify stakeholders of upcoming release with summary of delivered features", trigger: "on_entry", riskLevel: "MEDIUM" },
      { type: "DOCUMENT_GENERATION", description: "Compile project closure report with velocity analysis and lessons learned", trigger: "on_completion", riskLevel: "LOW" },
    ],
    gateCriteria: ["All release items tested", "Deployment checklist verified", "Stakeholders notified"],
    artefacts: ["Release Notes", "Deployment Checklist", "Closure Report"],
  },
];

const KANBAN_PLAYBOOK: PhasePlaybook[] = [
  {
    name: "Setup",
    actions: [
      { type: "TASK_ASSIGNMENT", description: "Configure WIP limits per workflow column based on team capacity", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Define workflow stages and service level expectations", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Populate initial backlog with prioritised work items", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["WIP limits configured", "Workflow defined", "Backlog populated"],
    artefacts: ["Board Configuration", "Service Level Agreement"],
  },
  {
    name: "Continuous Delivery",
    actions: [
      { type: "TASK_ASSIGNMENT", description: "Monitor WIP limits — block new pulls when limit reached and alert team", trigger: "daily", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Calculate Cycle Time and Lead Time daily — alert if >20% above baseline", trigger: "daily", riskLevel: "LOW" },
      { type: "RISK_RESPONSE", description: "Detect bottleneck columns (highest WIP, lowest throughput) and propose redistribution", trigger: "daily", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Auto-pull ready items from backlog when WIP below limit", trigger: "daily", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Generate weekly flow metrics report: throughput, cycle time, lead time, blockers", trigger: "weekly", riskLevel: "LOW" },
    ],
    gateCriteria: ["Continuous — no formal gate"],
    artefacts: ["Flow Metrics Reports", "Bottleneck Analysis"],
  },
  {
    name: "Review",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate cumulative flow analysis and process improvement recommendations", trigger: "on_entry", riskLevel: "LOW" },
      { type: "COMMUNICATION", description: "Distribute delivery summary to stakeholders", trigger: "on_completion", riskLevel: "MEDIUM" },
    ],
    gateCriteria: ["All committed items delivered", "Metrics reviewed"],
    artefacts: ["Cumulative Flow Diagram", "Process Improvement Report"],
  },
];

const HYBRID_PLAYBOOK: PhasePlaybook[] = [
  {
    name: "Foundation",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate project charter with hybrid delivery approach (phase-gated + iterative)", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Create WBS for governance phases and product backlog for delivery phases", trigger: "on_entry", riskLevel: "LOW" },
      { type: "RISK_RESPONSE", description: "Conduct initial risk assessment spanning both governance and delivery risks", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["Charter approved", "Hybrid plan defined", "Risk register populated"],
    artefacts: ["Project Charter", "Hybrid Delivery Plan", "Risk Register"],
  },
  {
    name: "Planning",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate detailed schedule for governance phases (Waterfall)", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Set up sprint framework for delivery phases (Agile)", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Define phase gate criteria that bridge governance and iterative milestones", trigger: "on_entry", riskLevel: "LOW" },
    ],
    gateCriteria: ["Planning complete", "Sprint framework ready", "Gate criteria defined"],
    artefacts: ["Governance Schedule", "Sprint Framework", "Gate Criteria"],
  },
  {
    name: "Iterative Delivery",
    actions: [
      { type: "TASK_ASSIGNMENT", description: "Run sprint cycles within the delivery phase (auto-populate backlog, assign tasks)", trigger: "on_entry", riskLevel: "LOW" },
      { type: "TASK_ASSIGNMENT", description: "Track daily progress with burndown + Gantt overlay", trigger: "daily", riskLevel: "LOW" },
      { type: "RISK_RESPONSE", description: "Monitor governance milestones alongside sprint progress", trigger: "weekly", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Generate weekly hybrid status report (sprint metrics + phase progress)", trigger: "weekly", riskLevel: "LOW" },
    ],
    gateCriteria: ["Sprint deliverables complete", "Governance milestones met"],
    artefacts: ["Sprint Reports", "Phase Progress Reports"],
  },
  {
    name: "Closure",
    actions: [
      { type: "DOCUMENT_GENERATION", description: "Generate closure report covering both governance outcomes and iterative delivery metrics", trigger: "on_entry", riskLevel: "LOW" },
      { type: "DOCUMENT_GENERATION", description: "Compile lessons learned: what worked in hybrid, what didn't", trigger: "on_entry", riskLevel: "LOW" },
      { type: "COMMUNICATION", description: "Send final project summary to all stakeholders", trigger: "on_completion", riskLevel: "MEDIUM" },
    ],
    gateCriteria: ["All deliverables accepted", "Closure report approved"],
    artefacts: ["Closure Report", "Lessons Learned"],
  },
];

// ─── Playbook Registry ───

const PLAYBOOKS: Record<string, PhasePlaybook[]> = {
  // Canonical keys (lowercase — match MethodologyId)
  prince2: PRINCE2_PLAYBOOK,
  waterfall: WATERFALL_PLAYBOOK,
  scrum: SCRUM_PLAYBOOK,
  kanban: KANBAN_PLAYBOOK,
  safe: SAFE_PLAYBOOK,
  hybrid: HYBRID_PLAYBOOK,
  // Legacy uppercase aliases (for VPS agent compatibility)
  WATERFALL: WATERFALL_PLAYBOOK,
  PRINCE2: PRINCE2_PLAYBOOK,
  AGILE_SCRUM: SCRUM_PLAYBOOK,
  AGILE_KANBAN: KANBAN_PLAYBOOK,
  SAFE: SAFE_PLAYBOOK,
  HYBRID: HYBRID_PLAYBOOK,
};

/**
 * Get the playbook for a given methodology.
 */
export function getPlaybook(methodology: string): PhasePlaybook[] {
  // Try exact match first, then lowercase, then uppercase
  return PLAYBOOKS[methodology] || PLAYBOOKS[methodology.toLowerCase()] || PLAYBOOKS[methodology.toUpperCase()] || PRINCE2_PLAYBOOK;
}

/**
 * Get actions for the current phase based on the trigger cadence.
 * Called from the autonomous cycle.
 */
export function getPhaseActions(
  methodology: string,
  currentPhaseName: string | null,
  trigger: "on_entry" | "daily" | "weekly" | "on_gate_ready",
): PlaybookAction[] {
  const playbook = getPlaybook(methodology);

  // Find current phase
  const phase = currentPhaseName
    ? playbook.find(p => p.name.toLowerCase() === currentPhaseName.toLowerCase())
    : playbook[0]; // Start with first phase if none set

  if (!phase) return [];

  return phase.actions.filter(a => a.trigger === trigger);
}

/**
 * Check if all gate criteria for the current phase are met.
 * Returns { ready, criteria } where each criterion has a met/unmet status.
 */
export async function checkGateCriteria(
  projectId: string,
  methodology: string,
  currentPhaseName: string,
): Promise<{ ready: boolean; criteria: { text: string; met: boolean }[] }> {
  const playbook = getPlaybook(methodology);
  const phase = playbook.find(p => p.name.toLowerCase() === currentPhaseName.toLowerCase());

  if (!phase) return { ready: false, criteria: [] };

  // Get project data to evaluate criteria
  const [tasks, artefacts, risks] = await Promise.all([
    db.task.findMany({ where: { projectId } }),
    db.agentArtefact.findMany({ where: { projectId } }),
    db.risk.findMany({ where: { projectId } }),
  ]);

  const phaseTasks = tasks; // In a real implementation, filter by phaseId
  const allTasksDone = phaseTasks.length > 0 && phaseTasks.every(t => t.status === "DONE");
  const artefactNames = artefacts.map(a => a.name.toLowerCase());
  const criticalRisks = risks.filter(r => (r.score || 0) >= 12 && r.status === "OPEN");

  const criteria = phase.gateCriteria.map(text => {
    const lower = text.toLowerCase();

    // Heuristic: check if the criterion is likely met
    if (lower.includes("complete") || lower.includes("done")) {
      return { text, met: allTasksDone };
    }
    if (lower.includes("approved") || lower.includes("reviewed")) {
      // Check if a matching artefact exists with APPROVED status
      const matching = artefacts.find(a =>
        phase.artefacts.some(pa => a.name.toLowerCase().includes(pa.toLowerCase())) &&
        a.status === "APPROVED"
      );
      return { text, met: !!matching };
    }
    if (lower.includes("risk")) {
      return { text, met: criticalRisks.length === 0 };
    }

    // Default: check if related artefact exists
    const hasArtefact = phase.artefacts.some(pa => artefactNames.some(an => an.includes(pa.toLowerCase())));
    return { text, met: hasArtefact || allTasksDone };
  });

  return {
    ready: criteria.every(c => c.met),
    criteria,
  };
}

/**
 * Build a human-readable executive summary for an action proposal.
 * Answers "What will the agent actually do?" in plain language.
 */
function buildExecutiveSummary(action: PlaybookAction, methodology: string, phaseName: string | null): string {
  const phase = phaseName || "initial";
  switch (action.type) {
    case "DOCUMENT_GENERATION": {
      // Extract the document names from the description (everything before any colon)
      const docPart = action.description.split(":")[0].replace(/^Generate |^Produce |^Create |^Draft /i, "").trim();
      return `The agent will generate the following document(s) for the ${phase} phase:\n\n• ${docPart}\n\nOnce generated, the document(s) will appear in your Documents tab as DRAFT. You can review, edit, and approve them before they are used to drive further project decisions.`;
    }
    case "RISK_RESPONSE":
      return `The agent will perform a risk assessment for the ${phase} phase and create or update risk register entries. It will identify threats, assess probability and impact, and propose mitigation strategies based on the project context and sector benchmarks.`;
    case "TASK_ASSIGNMENT":
      return `The agent will create or update tasks in the ${phase} phase, assigning priorities and owners based on the project plan and available team resources. New tasks will appear in the Tasks tab awaiting your review.`;
    case "STAKEHOLDER_COMMUNICATION":
      return `The agent will draft a stakeholder communication relevant to the ${phase} phase. The draft will be presented for your review before any message is sent — no communication goes out without your explicit approval.`;
    case "BUDGET_ACTION":
      return `The agent is proposing a budget-related action for the ${phase} phase: ${action.description.split(":")[0]}. No financial commitments are made without your explicit sign-off.`;
    case "PHASE_ADVANCEMENT":
      return `The agent has determined that all gate criteria for the ${phase} phase have been met and is requesting approval to advance the project to the next phase. Approving this will mark ${phase} as complete and activate the next phase.`;
    default:
      return `The agent is proposing the following action as part of the ${phase} phase (${methodology} methodology):\n\n${action.description}`;
  }
}

/**
 * Build a specific business rationale for an action — WHY this action is needed now.
 */
function buildRationale(action: PlaybookAction, methodology: string, phaseName: string | null, trigger: string): string {
  const phase = phaseName || "initial";
  const triggerLabel = trigger === "on_entry" ? `entry into the ${phase} phase`
    : trigger === "on_gate_ready" ? `completion of the ${phase} gate criteria`
    : trigger === "daily" ? "the daily autonomous cycle"
    : "the weekly project review";

  const riskNote = action.riskLevel === "LOW"
    ? "This is a low-risk action that is standard practice at this stage."
    : action.riskLevel === "MEDIUM"
    ? "This action has moderate complexity — human review is required before proceeding."
    : "This action carries elevated risk and requires explicit human approval.";

  switch (action.type) {
    case "DOCUMENT_GENERATION":
      return `Triggered by: ${triggerLabel}.\n\n${methodology} methodology requires this document at the ${phase} phase. Without it, the project lacks a formal record of decisions and deliverables for this stage, which blocks gate progression and leaves the team without a shared reference point.\n\n${riskNote}`;
    case "RISK_RESPONSE":
      return `Triggered by: ${triggerLabel}.\n\nProactive risk identification at the ${phase} phase is a core ${methodology} discipline. Early identification of threats allows mitigation strategies to be put in place before they impact schedule, cost, or quality. Unlogged risks cannot be tracked or escalated.\n\n${riskNote}`;
    case "TASK_ASSIGNMENT":
      return `Triggered by: ${triggerLabel}.\n\nThe ${phase} phase requires a structured task breakdown to make work visible and assignable. Without tasks, the team has no actionable to-do list and project progress cannot be measured or reported.\n\n${riskNote}`;
    case "STAKEHOLDER_COMMUNICATION":
      return `Triggered by: ${triggerLabel}.\n\nRegular stakeholder communication at the ${phase} phase maintains trust and ensures decision-makers have the information they need. Missed communications increase the risk of scope creep, misaligned expectations, and delayed approvals.\n\n${riskNote}`;
    case "BUDGET_ACTION":
      return `Triggered by: ${triggerLabel}.\n\nBudget management at the ${phase} phase ensures financial health is tracked from the outset. Early budget actions establish baselines and flag variances before they compound.\n\n${riskNote}`;
    default:
      return `Triggered by: ${triggerLabel}.\n\n${action.description} is a standard ${methodology} action for the ${phase} phase.\n\n${riskNote}`;
  }
}

/**
 * Generate action proposals from the playbook for the current phase and trigger.
 * These proposals feed into the standard classify → execute pipeline.
 */
export function generatePlaybookProposals(
  methodology: string,
  currentPhaseName: string | null,
  trigger: "on_entry" | "daily" | "weekly" | "on_gate_ready",
  projectId: string,
): ActionProposal[] {
  const actions = getPhaseActions(methodology, currentPhaseName, trigger);

  return actions.map(action => ({
    type: action.type as any,
    description: action.description,
    summary: buildExecutiveSummary(action, methodology, currentPhaseName),
    reasoning: buildRationale(action, methodology, currentPhaseName, trigger),
    confidence: 0.9,
    scheduleImpact: 1,
    costImpact: 1,
    scopeImpact: 1,
    stakeholderImpact: action.riskLevel === "MEDIUM" ? 2 : 1,
  }));
}

/**
 * Determine the next phase when current phase gate is passed.
 */
export function getNextPhase(methodology: string, currentPhaseName: string): string | null {
  const playbook = getPlaybook(methodology);
  const idx = playbook.findIndex(p => p.name.toLowerCase() === currentPhaseName.toLowerCase());
  if (idx < 0 || idx >= playbook.length - 1) return null;
  return playbook[idx + 1].name;
}
