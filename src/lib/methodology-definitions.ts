/**
 * SINGLE SOURCE OF TRUTH — Methodology Definitions
 *
 * Every page, API, and engine reads from here. Do NOT define
 * phase names, gate criteria, or artefact lists anywhere else.
 *
 * Based on the Vite governance types + VPS methodology engine,
 * merged into one canonical set.
 */

// ─── Types ───

export type MethodologyId =
  | "prince2"
  | "waterfall"
  | "scrum"
  | "kanban"
  | "safe"
  | "hybrid";

export type GateStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED";

export type PreRequisiteCategory =
  | "document"
  | "approval"
  | "review"
  | "assessment"
  | "sign_off";

export interface GatePreRequisite {
  description: string;
  category: PreRequisiteCategory;
  isMandatory: boolean;
  requiresHumanApproval: boolean;
}

export interface PhaseGateDefinition {
  name: string;
  criteria: string;
  preRequisites: GatePreRequisite[];
}

export interface ArtefactDefinition {
  name: string;
  required: boolean;
  aiGeneratable: boolean;
}

export interface PhaseDefinition {
  name: string;
  description: string;
  color: string;
  artefacts: ArtefactDefinition[];
  gate: PhaseGateDefinition;
}

export interface MethodologyDefinition {
  id: MethodologyId;
  name: string;
  framework: "traditional" | "agile" | "hybrid";
  description: string;
  phases: PhaseDefinition[];
}

// ─── Definitions ───

const PRINCE2: MethodologyDefinition = {
  id: "prince2",
  name: "Traditional (PMI-Style)",
  framework: "traditional",
  description: "Structured project management with phase gates and controlled stages",
  phases: [
    {
      name: "Pre-Project",
      description: "Validate the project idea, produce outline business case, appoint executive and project manager",
      color: "#6366F1",
      artefacts: [
        { name: "Problem Statement", required: true, aiGeneratable: true },
        { name: "Options Analysis", required: true, aiGeneratable: true },
        { name: "Outline Business Case", required: true, aiGeneratable: true },
        { name: "Project Brief", required: true, aiGeneratable: true },
      ],
      gate: {
        name: "Authorise Initiation",
        criteria: "Business case approved by sponsor, Project Board identified",
        preRequisites: [
          { description: "Sponsor identified and confirmed", category: "approval", isMandatory: true, requiresHumanApproval: true },
          { description: "Outline Business Case reviewed", category: "review", isMandatory: true, requiresHumanApproval: true },
          { description: "Funding availability confirmed", category: "approval", isMandatory: true, requiresHumanApproval: true },
        ],
      },
    },
    {
      name: "Initiation",
      description: "Detailed planning: charter, business case, governance, stakeholders, risk register, schedule, budget",
      color: "#8B5CF6",
      artefacts: [
        { name: "Project Charter", required: true, aiGeneratable: true },
        { name: "Business Case", required: true, aiGeneratable: true },
        { name: "Stakeholder Register", required: true, aiGeneratable: true },
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Initiation Approval",
        criteria: "Charter signed, team resourced, governance structure agreed",
        preRequisites: [
          { description: "Project Charter approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Business Case approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Team assignments confirmed", category: "approval", isMandatory: true, requiresHumanApproval: false },
          { description: "Risk Register reviewed", category: "review", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Planning",
      description: "Produce baselines: WBS, schedule, cost, quality, resource, and risk management plans",
      color: "#22D3EE",
      artefacts: [
        { name: "WBS", required: true, aiGeneratable: true },
        { name: "Schedule Baseline", required: true, aiGeneratable: true },
        { name: "Budget Breakdown", required: true, aiGeneratable: true },
        { name: "Risk Management Plan", required: true, aiGeneratable: true },
        { name: "Quality Plan", required: false, aiGeneratable: true },
        { name: "Resource Plan", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Planning Approval",
        criteria: "All baselines approved, delivery approach confirmed",
        preRequisites: [
          { description: "WBS complete and reviewed", category: "review", isMandatory: true, requiresHumanApproval: true },
          { description: "Schedule baselined", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Budget approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Quality plan accepted", category: "review", isMandatory: false, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Execution",
      description: "Deliver the project: monitor progress, manage risks, produce highlight reports, handle exceptions",
      color: "#10B981",
      artefacts: [
        { name: "Status Reports", required: true, aiGeneratable: true },
        { name: "Risk Reviews", required: true, aiGeneratable: true },
        { name: "Change Request Register", required: true, aiGeneratable: true },
        { name: "Exception Reports", required: false, aiGeneratable: true },
        { name: "Quality Review Records", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Stage/Execution Review",
        criteria: "All deliverables complete, quality reviews passed, acceptance criteria met",
        preRequisites: [
          { description: "All deliverables completed", category: "assessment", isMandatory: true, requiresHumanApproval: false },
          { description: "Quality reviews passed", category: "review", isMandatory: true, requiresHumanApproval: true },
          { description: "No critical open risks", category: "assessment", isMandatory: true, requiresHumanApproval: false },
          { description: "Lessons log updated", category: "document", isMandatory: false, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Closing",
      description: "Formal acceptance, handover, lessons learned, archive",
      color: "#F59E0B",
      artefacts: [
        { name: "Acceptance Certificate", required: true, aiGeneratable: true },
        { name: "End Project Report", required: true, aiGeneratable: true },
        { name: "Lessons Learned", required: true, aiGeneratable: true },
        { name: "Closure Report", required: true, aiGeneratable: true },
      ],
      gate: {
        name: "Closure Approval",
        criteria: "All deliverables accepted, lessons captured, project archived",
        preRequisites: [
          { description: "Sponsor acceptance sign-off", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Lessons learned documented", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "All artefacts archived", category: "document", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
  ],
};

const WATERFALL: MethodologyDefinition = {
  id: "waterfall",
  name: "Waterfall",
  framework: "traditional",
  description: "Sequential linear phases, each must complete before the next begins",
  phases: [
    {
      name: "Requirements",
      description: "Establish feasibility: define scope, justify the project, identify stakeholders and risks, produce the Project Brief and Outline Business Case",
      color: "#6366F1",
      artefacts: [
        { name: "Project Brief", required: true, aiGeneratable: true },
        { name: "Outline Business Case", required: true, aiGeneratable: true },
        { name: "Requirements Specification", required: true, aiGeneratable: true },
        { name: "Feasibility Study", required: true, aiGeneratable: true },
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: true, aiGeneratable: true },
      ],
      gate: {
        name: "Feasibility Gate",
        criteria: "Outline Business Case approved and project authorised to proceed",
        preRequisites: [
          { description: "Project Brief reviewed and accepted", category: "review", isMandatory: true, requiresHumanApproval: true },
          { description: "Outline Business Case approved by sponsor", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Requirements reviewed by stakeholders", category: "review", isMandatory: true, requiresHumanApproval: false },
          { description: "Initial risks identified and assessed", category: "assessment", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Design",
      description: "Formally initiate and plan the project: authorise via Charter and Business Case, then produce all management plans required to govern the next phase",
      color: "#8B5CF6",
      artefacts: [
        { name: "Project Charter", required: true, aiGeneratable: true },
        { name: "Business Case", required: true, aiGeneratable: true },
        { name: "Stakeholder Register", required: true, aiGeneratable: true },
        { name: "Communication Plan", required: true, aiGeneratable: true },
        { name: "Design Document", required: true, aiGeneratable: true },
        { name: "Work Breakdown Structure", required: true, aiGeneratable: true },
        { name: "Schedule with Dependencies", required: true, aiGeneratable: true },
        { name: "Cost Management Plan", required: true, aiGeneratable: true },
        { name: "Resource Management Plan", required: false, aiGeneratable: true },
        { name: "Risk Management Plan", required: true, aiGeneratable: true },
        { name: "Quality Management Plan", required: false, aiGeneratable: true },
        { name: "Change Control Plan", required: true, aiGeneratable: true },
        { name: "RACI Matrix", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Project Baseline Approval",
        criteria: "Project Charter signed, Business Case approved, all management plans baselined and approved",
        preRequisites: [
          { description: "Project Charter signed by sponsor", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Business Case approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "WBS and Schedule reviewed and baselined", category: "review", isMandatory: true, requiresHumanApproval: true },
          { description: "Cost Management Plan approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "All management plans reviewed", category: "review", isMandatory: true, requiresHumanApproval: false },
          { description: "Stakeholder register populated and validated", category: "assessment", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Build",
      description: "Implementation, coding, unit testing",
      color: "#22D3EE",
      artefacts: [
        { name: "Change Request Register", required: true, aiGeneratable: true },
        { name: "Code", required: true, aiGeneratable: false },
        { name: "Unit Tests", required: true, aiGeneratable: false },
      ],
      gate: {
        name: "Build Complete",
        criteria: "Build complete, unit tests passing",
        preRequisites: [
          { description: "All components built", category: "assessment", isMandatory: true, requiresHumanApproval: false },
          { description: "Unit tests passing", category: "assessment", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Test",
      description: "Integration testing, system testing, UAT",
      color: "#10B981",
      artefacts: [
        { name: "Test Plan", required: true, aiGeneratable: true },
        { name: "Test Results", required: true, aiGeneratable: false },
      ],
      gate: {
        name: "Testing Approval",
        criteria: "All critical defects resolved, UAT passed",
        preRequisites: [
          { description: "All critical defects resolved", category: "assessment", isMandatory: true, requiresHumanApproval: false },
          { description: "UAT sign-off", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
        ],
      },
    },
    {
      name: "Deploy",
      description: "Release to production, handover to operations",
      color: "#F59E0B",
      artefacts: [
        { name: "Release Plan", required: true, aiGeneratable: true },
        { name: "Handover Documentation", required: true, aiGeneratable: true },
      ],
      gate: {
        name: "Go-Live Approval",
        criteria: "Go-live approved, handover complete",
        preRequisites: [
          { description: "Go-live approved by sponsor", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Operations handover accepted", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
        ],
      },
    },
  ],
};

const SCRUM: MethodologyDefinition = {
  id: "scrum",
  name: "Scrum",
  framework: "agile",
  description: "Iterative sprints with ceremonies: planning, daily standup, review, retrospective",
  phases: [
    {
      name: "Sprint Zero",
      description: "Set up the team, create product vision, build initial backlog, define DoD",
      color: "#6366F1",
      artefacts: [
        { name: "Product Vision", required: true, aiGeneratable: true },
        { name: "Initial Backlog", required: true, aiGeneratable: true },
        { name: "Definition of Done", required: true, aiGeneratable: true },
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: true, aiGeneratable: true },
        { name: "Budget Breakdown", required: true, aiGeneratable: true },
        { name: "Team Charter", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Sprint Zero Complete",
        criteria: "Vision agreed, backlog prioritised, DoD defined",
        preRequisites: [
          { description: "Product backlog created and prioritised", category: "document", isMandatory: true, requiresHumanApproval: true },
          { description: "Definition of Done agreed", category: "approval", isMandatory: true, requiresHumanApproval: true },
          { description: "Team capacity established", category: "assessment", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Sprint Cadence",
      description: "Recurring sprints: plan, execute, review, retrospect. Backlog grooming between sprints.",
      color: "#10B981",
      artefacts: [
        { name: "Sprint Plans", required: true, aiGeneratable: true },
        { name: "Sprint Reviews", required: true, aiGeneratable: true },
        { name: "Retrospectives", required: true, aiGeneratable: true },
        { name: "Burndown Chart", required: true, aiGeneratable: true },
        { name: "Change Request Register", required: true, aiGeneratable: true },
      ],
      gate: {
        name: "Sprint Review",
        criteria: "Definition of Done met for sprint items, review and retro conducted",
        preRequisites: [
          { description: "Sprint backlog items complete or carried over", category: "assessment", isMandatory: true, requiresHumanApproval: false },
          { description: "Sprint Review conducted", category: "review", isMandatory: true, requiresHumanApproval: false },
          { description: "Retrospective complete", category: "review", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Release",
      description: "Final release preparation, deployment, closure",
      color: "#F59E0B",
      artefacts: [
        { name: "Release Plan", required: true, aiGeneratable: true },
        { name: "Final Retrospective", required: true, aiGeneratable: true },
        { name: "Closure Report", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Release Approval",
        criteria: "Acceptance criteria met, deployment verified",
        preRequisites: [
          { description: "All release items tested", category: "assessment", isMandatory: true, requiresHumanApproval: false },
          { description: "Deployment checklist verified", category: "review", isMandatory: true, requiresHumanApproval: true },
          { description: "Stakeholders notified", category: "approval", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
  ],
};

const KANBAN: MethodologyDefinition = {
  id: "kanban",
  name: "Kanban",
  framework: "agile",
  description: "Continuous flow with WIP limits, no fixed iterations",
  phases: [
    {
      name: "Setup",
      description: "Configure board, define WIP limits, establish service level expectations",
      color: "#6366F1",
      artefacts: [
        { name: "Board Configuration", required: true, aiGeneratable: true },
        { name: "WIP Policies", required: true, aiGeneratable: true },
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: true, aiGeneratable: true },
        { name: "Budget Breakdown", required: true, aiGeneratable: true },
        { name: "Service Level Agreement", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Board Live",
        criteria: "Board live, WIP policies agreed",
        preRequisites: [
          { description: "WIP limits configured", category: "document", isMandatory: true, requiresHumanApproval: true },
          { description: "Workflow stages defined", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "Backlog populated", category: "document", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Continuous Delivery",
      description: "Ongoing flow: pull items, track cycle time, resolve bottlenecks",
      color: "#10B981",
      artefacts: [
        { name: "Flow Metrics Reports", required: true, aiGeneratable: true },
        { name: "Change Request Register", required: true, aiGeneratable: true },
        { name: "Service Level Reports", required: false, aiGeneratable: true },
        { name: "Bottleneck Analysis", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Continuous Review",
        criteria: "Continuous — lead time within SLA",
        preRequisites: [
          { description: "Lead time within agreed SLA", category: "assessment", isMandatory: false, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Review",
      description: "Periodic flow analysis, process improvement, stakeholder updates",
      color: "#F59E0B",
      artefacts: [
        { name: "Cumulative Flow Diagram", required: true, aiGeneratable: true },
        { name: "Process Improvement Report", required: true, aiGeneratable: true },
        { name: "Retrospective", required: true, aiGeneratable: true },
      ],
      gate: {
        name: "Review Complete",
        criteria: "All committed items delivered, improvements identified",
        preRequisites: [
          { description: "All items delivered", category: "assessment", isMandatory: true, requiresHumanApproval: false },
          { description: "Metrics reviewed", category: "review", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
  ],
};

const SAFE: MethodologyDefinition = {
  id: "safe",
  name: "SAFe",
  framework: "agile",
  description: "Scaled Agile Framework — PI Planning cadence at team level",
  phases: [
    {
      name: "PI Planning",
      description: "Programme Increment planning: set objectives, build programme board",
      color: "#6366F1",
      artefacts: [
        { name: "PI Objectives", required: true, aiGeneratable: true },
        { name: "Programme Board", required: true, aiGeneratable: true },
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: true, aiGeneratable: true },
        { name: "Budget Breakdown", required: true, aiGeneratable: true },
        { name: "Solution Vision", required: false, aiGeneratable: true },
        { name: "Architectural Runway", required: false, aiGeneratable: true },
        { name: "Team Topologies", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "PI Commitment",
        criteria: "PI objectives committed by teams",
        preRequisites: [
          { description: "PI objectives agreed", category: "approval", isMandatory: true, requiresHumanApproval: true },
          { description: "Team capacity confirmed", category: "assessment", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Iteration Cadence",
      description: "Execute iterations within the PI, produce system demos",
      color: "#10B981",
      artefacts: [
        { name: "Iteration Plans", required: true, aiGeneratable: true },
        { name: "Change Request Register", required: true, aiGeneratable: true },
        { name: "System Demos", required: true, aiGeneratable: false },
        { name: "Risk Reviews", required: false, aiGeneratable: true },
        { name: "Status Reports", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "System Demo",
        criteria: "System increment delivered and demonstrated",
        preRequisites: [
          { description: "Iteration goals met", category: "assessment", isMandatory: true, requiresHumanApproval: false },
          { description: "System demo delivered", category: "review", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Inspect & Adapt",
      description: "PI retrospective, quantitative analysis, improvement backlog",
      color: "#F59E0B",
      artefacts: [
        { name: "PI Report", required: true, aiGeneratable: true },
        { name: "Improvement Backlog", required: true, aiGeneratable: true },
      ],
      gate: {
        name: "I&A Complete",
        criteria: "Improvements prioritised, next PI planned",
        preRequisites: [
          { description: "PI metrics reviewed", category: "review", isMandatory: true, requiresHumanApproval: false },
          { description: "Improvements prioritised", category: "approval", isMandatory: true, requiresHumanApproval: true },
        ],
      },
    },
  ],
};

const HYBRID: MethodologyDefinition = {
  id: "hybrid",
  name: "Hybrid",
  framework: "hybrid",
  description: "Phase-gated governance + iterative delivery sprints within execution phases",
  phases: [
    {
      name: "Foundation",
      description: "Project charter, hybrid delivery approach, WBS for governance, backlog for delivery",
      color: "#6366F1",
      artefacts: [
        { name: "Charter", required: true, aiGeneratable: true },
        { name: "Delivery Approach", required: true, aiGeneratable: true },
        { name: "Roadmap", required: true, aiGeneratable: true },
        { name: "Risk Register", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: true, aiGeneratable: true },
        { name: "Budget Breakdown", required: true, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
        { name: "Team Charter", required: false, aiGeneratable: true },
        { name: "Outline Business Case", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Foundation Approval",
        criteria: "Approach approved, team formed",
        preRequisites: [
          { description: "Charter approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Hybrid plan defined", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "Risk register populated", category: "document", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Planning",
      description: "Governance schedule (waterfall), sprint framework (agile), gate criteria",
      color: "#8B5CF6",
      artefacts: [
        { name: "WBS", required: true, aiGeneratable: true },
        { name: "Backlog", required: true, aiGeneratable: true },
        { name: "Risk Plan", required: true, aiGeneratable: true },
        { name: "Schedule Baseline", required: false, aiGeneratable: true },
        { name: "Resource Plan", required: false, aiGeneratable: true },
        { name: "Quality Plan", required: false, aiGeneratable: true },
        { name: "Change Control Plan", required: false, aiGeneratable: true },
        { name: "Gate Criteria", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Planning Approval",
        criteria: "Plan and backlog baselined",
        preRequisites: [
          { description: "Planning complete", category: "review", isMandatory: true, requiresHumanApproval: true },
          { description: "Sprint framework ready", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "Gate criteria defined", category: "document", isMandatory: false, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Iterative Delivery",
      description: "Sprint cycles within governance phases, dual reporting: sprint metrics + milestone RAG",
      color: "#10B981",
      artefacts: [
        { name: "Sprint Plans", required: true, aiGeneratable: true },
        { name: "Change Request Register", required: true, aiGeneratable: true },
        { name: "Status Reports", required: true, aiGeneratable: true },
        { name: "Phase Progress Reports", required: false, aiGeneratable: true },
        { name: "Retrospectives", required: false, aiGeneratable: true },
        { name: "Risk Reviews", required: false, aiGeneratable: true },
        { name: "Burndown Chart", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Delivery Review",
        criteria: "Sprint deliverables complete, governance milestones met",
        preRequisites: [
          { description: "Sprint deliverables accepted", category: "assessment", isMandatory: true, requiresHumanApproval: false },
          { description: "Governance milestones met", category: "review", isMandatory: true, requiresHumanApproval: true },
        ],
      },
    },
    {
      name: "Closure",
      description: "Formal closure covering governance outcomes and iterative delivery metrics",
      color: "#F59E0B",
      artefacts: [
        { name: "Acceptance", required: true, aiGeneratable: true },
        { name: "Lessons Learned", required: true, aiGeneratable: true },
        { name: "Closure Report", required: true, aiGeneratable: true },
      ],
      gate: {
        name: "Closure Approval",
        criteria: "All deliverables accepted, closure report approved",
        preRequisites: [
          { description: "Sponsor sign-off", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Lessons learned documented", category: "document", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
  ],
};

// ─── Registry ───

export const METHODOLOGIES: Record<MethodologyId, MethodologyDefinition> = {
  prince2: PRINCE2,
  waterfall: WATERFALL,
  scrum: SCRUM,
  kanban: KANBAN,
  safe: SAFE,
  hybrid: HYBRID,
};

export const METHODOLOGY_LIST: MethodologyDefinition[] = Object.values(METHODOLOGIES);

/**
 * Get a methodology definition by ID (case-insensitive).
 * Falls back to PRINCE2 if not found.
 */
export function getMethodology(id: string): MethodologyDefinition {
  const key = id.toLowerCase().replace(/[^a-z0-9]/g, "") as MethodologyId;
  // Handle aliases
  if (key === "agile" || key === "agilescrum") return METHODOLOGIES.scrum;
  if (key === "agilekanban") return METHODOLOGIES.kanban;
  return METHODOLOGIES[key] || METHODOLOGIES.prince2;
}

/**
 * Get phase names for a methodology (for display and matching).
 */
export function getPhaseNames(methodologyId: string): string[] {
  return getMethodology(methodologyId).phases.map(p => p.name);
}

/**
 * Get a specific phase definition by name.
 */
export function getPhase(methodologyId: string, phaseName: string): PhaseDefinition | undefined {
  return getMethodology(methodologyId).phases.find(
    p => p.name.toLowerCase() === phaseName.toLowerCase()
  );
}

/**
 * Get required artefact names for a phase.
 */
export function getPhaseArtefacts(methodologyId: string, phaseName: string): string[] {
  const phase = getPhase(methodologyId, phaseName);
  return phase ? phase.artefacts.filter(a => a.required).map(a => a.name) : [];
}
