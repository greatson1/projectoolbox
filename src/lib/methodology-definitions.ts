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
  | "traditional"
  | "waterfall"
  | "scrum"
  | "kanban"
  | "safe"
  | "hybrid"
  | "travel"
  | "pmbok";

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

const TRADITIONAL: MethodologyDefinition = {
  id: "traditional",
  name: "Traditional",
  framework: "traditional",
  description: "Structured project management with phase gates and controlled stages",
  phases: [
    {
      name: "Pre-Project",
      description: "Validate the project idea, produce outline business case, appoint executive and project manager",
      color: "#6366F1",
      artefacts: [
        { name: "Problem Statement", required: false, aiGeneratable: true },
        { name: "Options Analysis", required: false, aiGeneratable: true },
        // required:true — gate prereq "Outline Business Case reviewed" is mandatory; the
        // artefact backing that prereq must therefore be required, not optional.
        { name: "Outline Business Case", required: true, aiGeneratable: true },
        { name: "Project Brief", required: false, aiGeneratable: true },
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
        // PRINCE2 canonical — Project Initiation Document is the framework's
        // anchor artefact. Without it the Traditional methodology cannot
        // claim PRINCE2 alignment (the `prince2` alias points here). Added
        // 2026-06 per audit.
        { name: "Project Initiation Document (PID)", required: true, aiGeneratable: true },
        // required:true — gate prereq "Project Charter approved" is a mandatory sign-off.
        { name: "Project Charter", required: true, aiGeneratable: true },
        // required:true — gate prereq "Business Case approved" is a mandatory sign-off.
        { name: "Business Case", required: true, aiGeneratable: true },
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Stakeholder Register", required: false, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
        // PRINCE2 management strategies — required by the framework, optional
        // in our spec because they're frequently merged into the PID for
        // smaller projects. Surfaced so PRINCE2 audits don't flag them as
        // absent.
        { name: "Quality Management Strategy", required: false, aiGeneratable: true },
        { name: "Configuration Management Strategy", required: false, aiGeneratable: true },
        { name: "Risk Management Strategy", required: false, aiGeneratable: true },
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
        { name: "Work Breakdown Structure", required: true, aiGeneratable: true },
        { name: "Cost Management Plan", required: true, aiGeneratable: true },
        { name: "Schedule with Dependencies", required: false, aiGeneratable: true },
        { name: "Risk Management Plan", required: false, aiGeneratable: true },
        { name: "Quality Management Plan", required: false, aiGeneratable: true },
        { name: "Resource Management Plan", required: false, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
        { name: "RACI Matrix", required: false, aiGeneratable: true },
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
        { name: "Risk Reviews", required: false, aiGeneratable: true },
        { name: "Change Request Register", required: false, aiGeneratable: true },
        { name: "Exception Reports", required: false, aiGeneratable: true },
        // required:true — gate prereq "Quality reviews passed" is a mandatory review.
        { name: "Quality Review Records", required: true, aiGeneratable: true },
        // PRINCE2 canonical — Issue Register captures issues / exceptions /
        // unplanned events through delivery. Reverse-synced from db.issue.
        // The Issues page is meaningless if no artefact owns the data. Added
        // 2026-06 per methodology audit.
        { name: "Issue Log", required: true, aiGeneratable: true },
        // PRINCE2 canonical — End Stage Reports record what happened in the
        // stage that's closing and recommend whether the next stage should
        // begin. Without one, a stage gate is decided with no documented
        // basis. Added 2026-06 per audit.
        { name: "End Stage Report", required: false, aiGeneratable: true },
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
        // required:true — gate prereq "Sponsor acceptance sign-off" requires the certificate.
        { name: "Acceptance Certificate", required: true, aiGeneratable: true },
        // required:true — gate prereq "Lessons learned documented" is a mandatory document.
        { name: "Lessons Learned", required: true, aiGeneratable: true },
        { name: "Closure Report", required: true, aiGeneratable: true },
        { name: "Handover Documentation", required: false, aiGeneratable: true },
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
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: false, aiGeneratable: true },
        { name: "Project Brief", required: false, aiGeneratable: true },
        { name: "Outline Business Case", required: false, aiGeneratable: true },
        { name: "Requirements Specification", required: false, aiGeneratable: true },
        { name: "Feasibility Study", required: false, aiGeneratable: true },
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
        { name: "Work Breakdown Structure", required: true, aiGeneratable: true },
        { name: "Cost Management Plan", required: true, aiGeneratable: true },
        // required:true — gate prereq "Stakeholder register populated and validated" mandates this.
        { name: "Stakeholder Register", required: true, aiGeneratable: true },
        // required:true — gate prereq "WBS and Schedule reviewed and baselined" mandates this.
        { name: "Schedule with Dependencies", required: true, aiGeneratable: true },
        { name: "Risk Management Plan", required: false, aiGeneratable: true },
        { name: "Resource Management Plan", required: false, aiGeneratable: true },
        { name: "RACI Matrix", required: false, aiGeneratable: true },
        // required:true — gate prereq "Project Charter signed by sponsor" is a mandatory sign-off.
        { name: "Project Charter", required: true, aiGeneratable: true },
        // required:true — gate prereq "Business Case approved" is a mandatory sign-off.
        { name: "Business Case", required: true, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
        { name: "Design Document", required: false, aiGeneratable: true },
        { name: "Quality Management Plan", required: false, aiGeneratable: true },
        { name: "Change Control Plan", required: false, aiGeneratable: true },
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
        { name: "Status Reports", required: true, aiGeneratable: true },
        { name: "Change Request Register", required: false, aiGeneratable: true },
        // PMBOK / Waterfall canonical — Issue Log captures issues discovered
        // during construction (not the same as Change Requests, which are
        // scope modifications). Reverse-synced from db.issue. Without it
        // the Issues page has no owning artefact. Added 2026-06 per audit.
        { name: "Issue Log", required: true, aiGeneratable: true },
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
        { name: "Status Reports", required: true, aiGeneratable: true },
        // required:true — gate prereq "UAT sign-off" depends on a Test Plan being agreed.
        { name: "Test Plan", required: true, aiGeneratable: true },
        // required:true + aiGeneratable:false — Test Results must exist (the gate's
        // "UAT sign-off" prereq is meaningless without them) but they're real-world
        // test execution output, so the user uploads them rather than the agent
        // generating them. The pipeline correctly skips non-aiGeneratable entries.
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
        { name: "Closure Report", required: true, aiGeneratable: true },
        { name: "Release Plan", required: false, aiGeneratable: true },
        // required:true — gate prereq "Operations handover accepted" is a mandatory sign-off.
        { name: "Handover Documentation", required: true, aiGeneratable: true },
        // Universal closing-phase artefact — Lessons Learned is the input to
        // future projects and the de-facto standard across PMBOK / PRINCE2.
        // Previously missing from Waterfall despite the gate's "Lessons
        // learned documented" prereq. Added 2026-06 per audit.
        { name: "Lessons Learned", required: true, aiGeneratable: true },
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
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Cost Management Plan", required: true, aiGeneratable: true },
        { name: "Initial Product Backlog", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: false, aiGeneratable: true },
        { name: "Product Vision", required: false, aiGeneratable: true },
        // required:true — gate prereq "Definition of Done agreed" is a mandatory approval.
        { name: "Definition of Done", required: true, aiGeneratable: true },
        // Scrum canonical — Definition of Ready is the entry criterion for
        // pulling a backlog item into a sprint (clear story, estimated, no
        // blockers). Universally expected; its absence reads as "the team
        // didn't agree what 'ready to start' means". Added 2026-06 per audit.
        { name: "Definition of Ready", required: false, aiGeneratable: true },
        { name: "Team Charter", required: false, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
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
        // Scrum Guide split: Sprint Plans is the PLANNING ceremony output
        // (the team's commitment — Sprint Goal, capacity, selected items;
        // frozen at sprint start). Sprint Backlog is the LIVE working list
        // (items currently in-flight, status evolves daily). Both are
        // required: planning without a live list loses execution truth,
        // a live list without a planning record loses commitment context.
        { name: "Sprint Plans", required: true, aiGeneratable: true },
        { name: "Sprint Backlog", required: true, aiGeneratable: true },
        // Scrum canonical — Sprint Goal is the WHY of every sprint, distinct
        // from the Sprint Plan (which is the WHAT). The Scrum Guide elevates
        // it as a first-class artefact. Marked required so every sprint has
        // an articulated objective the team can rally around. Added 2026-06
        // per audit.
        { name: "Sprint Goal", required: true, aiGeneratable: true },
        { name: "Sprint Reviews", required: false, aiGeneratable: true },
        { name: "Retrospectives", required: false, aiGeneratable: true },
        { name: "Burndown Chart", required: false, aiGeneratable: true },
        { name: "Change Request Register", required: false, aiGeneratable: true },
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
        { name: "Release Plan", required: false, aiGeneratable: true },
        { name: "Final Retrospective", required: false, aiGeneratable: true },
        { name: "Closure Report", required: false, aiGeneratable: true },
        // Universal closing-phase artefact. Sprint retrospectives capture
        // sprint-local lessons; Lessons Learned synthesises across the
        // whole project as the input to future engagements. Added 2026-06
        // per audit.
        { name: "Lessons Learned", required: true, aiGeneratable: true },
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
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Cost Management Plan", required: true, aiGeneratable: true },
        { name: "Initial Product Backlog", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: false, aiGeneratable: true },
        { name: "Board Configuration", required: false, aiGeneratable: true },
        // required:true — gate prereq "WIP limits configured" mandates this.
        { name: "WIP Policies", required: true, aiGeneratable: true },
        { name: "Service Level Agreement", required: false, aiGeneratable: true },
        // ── Canonical Kanban Method additions (2026-06 audit) ──
        // Kanban without Definition of Done is "Scrum board without
        // sprints"; without Class of Service it can't honour different
        // priority commitments; without a Replenishment Policy the
        // backlog refresh becomes ad-hoc. These are core to the method.
        { name: "Definition of Done", required: true, aiGeneratable: true },
        { name: "Class of Service Definitions", required: true, aiGeneratable: true },
        { name: "Replenishment Policy", required: false, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Board Live",
        criteria: "Board live, WIP policies agreed, Definition of Done explicit, classes of service declared",
        preRequisites: [
          { description: "WIP limits configured", category: "document", isMandatory: true, requiresHumanApproval: true },
          { description: "Workflow stages defined", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "Backlog populated", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "Definition of Done agreed", category: "approval", isMandatory: true, requiresHumanApproval: true },
          { description: "Classes of Service declared", category: "document", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Continuous Delivery",
      description: "Ongoing flow: pull items, track cycle time, resolve bottlenecks",
      color: "#10B981",
      artefacts: [
        { name: "Status Reports", required: true, aiGeneratable: true },
        { name: "Flow Metrics Reports", required: false, aiGeneratable: true },
        { name: "Change Request Register", required: false, aiGeneratable: true },
        { name: "Service Level Reports", required: false, aiGeneratable: true },
        { name: "Bottleneck Analysis", required: false, aiGeneratable: true },
        // ── Canonical Kanban Method additions (2026-06 audit) ──
        // CFD is the visual aggregate of Flow Metrics — kept separate
        // because reviewers consume it differently (trend at a glance
        // vs. table inspection). Class of Service Tracker reports per-
        // class SLE adherence so each class isn't reduced to an average.
        { name: "Cumulative Flow Diagram", required: false, aiGeneratable: true },
        { name: "Class of Service Tracker", required: false, aiGeneratable: true },
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
        { name: "Cumulative Flow Diagram", required: false, aiGeneratable: true },
        { name: "Process Improvement Report", required: false, aiGeneratable: true },
        { name: "Retrospective", required: false, aiGeneratable: true },
        // Universal closing-phase artefact. The Retrospective above captures
        // recent flow lessons; Lessons Learned synthesises across the whole
        // engagement as the input to future projects. Added 2026-06 per audit.
        { name: "Lessons Learned", required: true, aiGeneratable: true },
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
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Cost Management Plan", required: true, aiGeneratable: true },
        { name: "Initial Product Backlog", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: false, aiGeneratable: true },
        { name: "PI Objectives", required: false, aiGeneratable: true },
        { name: "Programme Board", required: false, aiGeneratable: true },
        { name: "Solution Vision", required: false, aiGeneratable: true },
        { name: "Architectural Runway", required: false, aiGeneratable: true },
        { name: "Team Topologies", required: false, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
        // ── Canonical SAFe additions (2026-06 audit) ──
        // Roadmap spans multiple PIs; without it teams can't see the
        // horizon beyond the current PI. Feature Hierarchy records the
        // Epic→Feature→Story decomposition that SAFe enforces — the
        // single "Product Backlog" entry above flattens what should be
        // a tree. Team Backlogs split the Program Backlog per-team so
        // each team's commitment is auditable. ROAM Risk Board is SAFe's
        // canonical PI-planning risk-classification artefact: each
        // identified risk is marked Resolved / Owned / Accepted /
        // Mitigated before commitment.
        { name: "Roadmap", required: true, aiGeneratable: true },
        { name: "Feature Hierarchy", required: true, aiGeneratable: true },
        { name: "Team Backlogs", required: true, aiGeneratable: true },
        { name: "ROAM Risk Board", required: true, aiGeneratable: true },
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
        // Iteration Plans = planning commitment for the iteration (capacity,
        // selected items, iteration goal). Iteration Backlog = live working
        // list during execution. Same conceptual split as Scrum Sprint Plans
        // / Sprint Backlog.
        { name: "Iteration Plans", required: true, aiGeneratable: true },
        { name: "Iteration Backlog", required: true, aiGeneratable: true },
        { name: "Status Reports", required: true, aiGeneratable: true },
        { name: "System Demos", required: false, aiGeneratable: false },
        { name: "Risk Reviews", required: false, aiGeneratable: true },
        { name: "Change Request Register", required: false, aiGeneratable: true },
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
        { name: "PI Report", required: false, aiGeneratable: true },
        { name: "Improvement Backlog", required: false, aiGeneratable: true },
        // Universal closing-phase artefact. I&A is the SAFe equivalent of
        // a project closing review — Lessons Learned captures cross-PI
        // insights that feed the Improvement Backlog. Added 2026-06.
        { name: "Lessons Learned", required: true, aiGeneratable: true },
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
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Cost Management Plan", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: false, aiGeneratable: true },
        // required:true — gate prereq "Project Charter approved" is a mandatory sign-off.
        { name: "Project Charter", required: true, aiGeneratable: true },
        // required:true — gate prereq "Hybrid plan defined" needs the Delivery Approach artefact.
        { name: "Delivery Approach", required: true, aiGeneratable: true },
        { name: "Roadmap", required: false, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
        { name: "Team Charter", required: false, aiGeneratable: true },
        { name: "Outline Business Case", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Foundation Approval",
        criteria: "Approach approved, team formed",
        preRequisites: [
          { description: "Project Charter approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
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
        { name: "Work Breakdown Structure", required: true, aiGeneratable: true },
        { name: "Risk Management Plan", required: false, aiGeneratable: true },
        { name: "Schedule with Dependencies", required: false, aiGeneratable: true },
        { name: "Resource Management Plan", required: false, aiGeneratable: true },
        { name: "Initial Product Backlog", required: false, aiGeneratable: true },
        { name: "Quality Management Plan", required: false, aiGeneratable: true },
        { name: "Change Control Plan", required: false, aiGeneratable: true },
        { name: "Definition of Done", required: false, aiGeneratable: true },
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
        // Same Scrum-Guide split as standalone Scrum: Sprint Plans = planning
        // commitment, Sprint Backlog = live working list.
        { name: "Sprint Plans", required: true, aiGeneratable: true },
        { name: "Sprint Backlog", required: true, aiGeneratable: true },
        { name: "Status Reports", required: true, aiGeneratable: true },
        { name: "Phase Progress Reports", required: false, aiGeneratable: true },
        { name: "Retrospectives", required: false, aiGeneratable: true },
        { name: "Risk Reviews", required: false, aiGeneratable: true },
        { name: "Burndown Chart", required: false, aiGeneratable: true },
        { name: "Change Request Register", required: false, aiGeneratable: true },
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
        { name: "Acceptance Certificate", required: false, aiGeneratable: true },
        // Upgraded required:false → true 2026-06 per methodology audit.
        // Universal closing-phase input; was inconsistently optional in
        // Hybrid despite being required in Traditional / PMBOK.
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

// Travel / trip methodology — used for holidays, business trips, family
// trips, and short events. The corporate methodologies (hybrid, scrum,
// kanban, traditional) forced artefacts like "Definition of Done",
// "Sprint Plans", "Business Case", "Team Charter" onto trips, which
// produced nonsense (the "What is the compliance lead?" bug on a Lagos
// trip came from a Definition of Done generated for a family holiday).
//
// Design choice: REUSE artefact names that lifecycle-init already has
// trip-aware spreadsheet prompts for ("Schedule with Dependencies",
// "Initial Risk Register", "Initial Stakeholder Register",
// "Cost Management Plan") so the existing rich content generation
// (Nigeria-specific risks, Lagos accommodation areas, yellow fever
// requirements, etc.) fires without further changes. The new names
// ("Trip Brief", "Booking Tracker", "Documentation Checklist",
// "Packing List", "Expense Tracker", "Incident Log", "Research Notes")
// fall through to the generic-document prompt path.
const TRAVEL: MethodologyDefinition = {
  id: "travel",
  name: "Travel & Trip",
  framework: "hybrid",
  description: "Trip lifecycle for holidays, business travel, and family trips: plan, book, travel, wrap-up. Trip-appropriate artefacts and gates — no sprints, no DoD, no business case.",
  phases: [
    {
      name: "Plan",
      description: "Confirm travellers, scope the trip, draft budget, identify risks, do destination research",
      color: "#6366F1",
      artefacts: [
        { name: "Trip Brief", required: true, aiGeneratable: true },
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Cost Management Plan", required: true, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: true, aiGeneratable: true },
        { name: "Research Notes", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Plan Approved",
        criteria: "Travellers confirmed, budget agreed, key risks identified",
        preRequisites: [
          { description: "Travellers confirmed", category: "approval", isMandatory: true, requiresHumanApproval: true },
          { description: "Budget agreed", category: "approval", isMandatory: true, requiresHumanApproval: true },
          { description: "Risk register populated", category: "document", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Book",
      description: "Secure transport, accommodation, travel documentation, insurance, and vaccinations",
      color: "#8B5CF6",
      artefacts: [
        { name: "Schedule with Dependencies", required: true, aiGeneratable: true },
        { name: "Booking Tracker", required: true, aiGeneratable: true },
        { name: "Documentation Checklist", required: true, aiGeneratable: true },
        { name: "Packing List", required: false, aiGeneratable: true },
        { name: "Risk Reviews", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Trip Ready",
        criteria: "All bookings confirmed, documents secured, travellers prepared",
        preRequisites: [
          { description: "Transport booked", category: "approval", isMandatory: true, requiresHumanApproval: true },
          { description: "Accommodation booked", category: "approval", isMandatory: true, requiresHumanApproval: true },
          { description: "Travel documents secured", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "Travel insurance in place", category: "approval", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Travel",
      description: "Execute the trip — daily log, expense tracking, incident management",
      color: "#10B981",
      artefacts: [
        { name: "Status Reports", required: false, aiGeneratable: true },
        { name: "Expense Tracker", required: false, aiGeneratable: true },
        { name: "Incident Log", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Trip Complete",
        criteria: "All travellers safely returned, expenses captured",
        preRequisites: [
          { description: "All travellers safely returned", category: "assessment", isMandatory: true, requiresHumanApproval: true },
          { description: "Expense tracking up to date", category: "document", isMandatory: false, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Wrap-up",
      description: "Reconcile expenses, capture lessons learned, archive memories and documents",
      color: "#F59E0B",
      artefacts: [
        // Upgraded required:false → true 2026-06 per audit. The travel
        // pipeline's whole point is "do better next trip" — Lessons Learned
        // is the load-bearing artefact for that.
        { name: "Lessons Learned", required: true, aiGeneratable: true },
        { name: "Closure Report", required: true, aiGeneratable: true },
      ],
      gate: {
        name: "Trip Closed",
        criteria: "Expenses reconciled, lessons captured, trip archived",
        preRequisites: [
          { description: "Final expenses reconciled", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "Lessons learned captured", category: "document", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
  ],
};

// PMBOK methodology — PMI's five Process Groups as phases. Differs from
// Traditional in vocabulary (PMI canonical artefact names like
// "Project Management Plan", "Issue Log", "Stakeholder Engagement Plan")
// and in giving Monitoring & Controlling its own phase rather than
// folding it into Execution. Use this when the team explicitly works
// to PMBOK Guide standards, audit requirements reference PMI, or the
// PM is certified PMP and expects PMI vocabulary throughout.
//
// Phase order matches the five Process Groups:
//   1. Initiating  — authorise the project, identify stakeholders.
//   2. Planning    — produce the integrated Project Management Plan and
//                    all subsidiary plans (one per knowledge area).
//   3. Executing   — direct and manage project work, deliver scope.
//   4. Monitoring & Controlling — track performance, manage changes,
//                    forecast completion; runs in parallel with Executing
//                    in real life but represented here as a distinct
//                    review-and-control phase so the agent can produce
//                    a clean set of performance artefacts.
//   5. Closing     — formal acceptance, lessons, archive.
const PMBOK: MethodologyDefinition = {
  id: "pmbok",
  name: "PMBOK",
  framework: "traditional",
  description: "PMI's PMBOK Guide — five Process Groups: Initiating, Planning, Executing, Monitoring & Controlling, Closing. Knowledge-area subsidiary plans.",
  phases: [
    {
      name: "Initiating",
      description: "Authorise the project, identify stakeholders, document high-level requirements",
      color: "#6366F1",
      artefacts: [
        { name: "Project Charter", required: true, aiGeneratable: true },
        { name: "Business Case", required: false, aiGeneratable: true },
        { name: "Initial Stakeholder Register", required: true, aiGeneratable: true },
        { name: "Assumption Log", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Initiation Approval",
        criteria: "Charter signed, stakeholders identified, project authorised",
        preRequisites: [
          { description: "Project Charter approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Sponsor identified and confirmed", category: "approval", isMandatory: true, requiresHumanApproval: true },
          { description: "Stakeholder register populated", category: "document", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Planning",
      description: "Produce the integrated Project Management Plan and all subsidiary plans across the 10 knowledge areas",
      color: "#8B5CF6",
      artefacts: [
        { name: "Project Management Plan", required: true, aiGeneratable: true },
        // PMI canonical — Scope Statement is the PMBOK input to WBS / Activity
        // List and the basis for change-control. PMBOK Guide explicitly
        // separates it from the WBS itself; without it the PMBOK methodology
        // is just Traditional with renamed phases. Added 2026-06 per audit.
        { name: "Scope Statement", required: true, aiGeneratable: true },
        { name: "Work Breakdown Structure", required: true, aiGeneratable: true },
        // PMI canonical — Activity List + Attributes is the Schedule's input
        // (Define Activities process). Without it the Schedule baseline has
        // no PMI-traceable decomposition.
        { name: "Activity List", required: true, aiGeneratable: true },
        { name: "Schedule with Dependencies", required: true, aiGeneratable: true },
        { name: "Cost Management Plan", required: true, aiGeneratable: true },
        { name: "Risk Management Plan", required: true, aiGeneratable: true },
        { name: "Initial Risk Register", required: true, aiGeneratable: true },
        { name: "Quality Management Plan", required: false, aiGeneratable: true },
        { name: "Resource Management Plan", required: false, aiGeneratable: true },
        { name: "Communication Plan", required: false, aiGeneratable: true },
        { name: "Procurement Management Plan", required: false, aiGeneratable: true },
        { name: "Stakeholder Engagement Plan", required: false, aiGeneratable: true },
        { name: "Change Control Plan", required: false, aiGeneratable: true },
        { name: "RACI Matrix", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Planning Baseline Approval",
        criteria: "Project Management Plan approved, all baselines set, ready to execute",
        preRequisites: [
          { description: "Project Management Plan approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Schedule baselined", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Budget approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "WBS complete and reviewed", category: "review", isMandatory: true, requiresHumanApproval: false },
          { description: "Risk register populated", category: "document", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Executing",
      description: "Direct and manage project work; produce deliverables; manage stakeholder engagement and team",
      color: "#22D3EE",
      artefacts: [
        { name: "Status Reports", required: true, aiGeneratable: true },
        { name: "Issue Log", required: true, aiGeneratable: true },
        { name: "Change Request Register", required: false, aiGeneratable: true },
        { name: "Quality Review Records", required: false, aiGeneratable: true },
        { name: "Risk Reviews", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Execution Review",
        criteria: "Deliverables in progress, change control active, no critical open issues",
        preRequisites: [
          { description: "Status reports current", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "Issue log up to date", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "No critical open risks", category: "assessment", isMandatory: true, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Monitoring & Controlling",
      description: "Track performance, manage changes, forecast variance, control scope/schedule/cost baselines",
      color: "#10B981",
      artefacts: [
        { name: "Performance Report", required: true, aiGeneratable: true },
        { name: "Earned Value Report", required: false, aiGeneratable: true },
        { name: "Variance Analysis", required: false, aiGeneratable: true },
        { name: "Forecast Report", required: false, aiGeneratable: true },
        { name: "Change Request Register", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Performance Review",
        criteria: "Performance against baselines reviewed, exceptions actioned, forecast confirmed",
        preRequisites: [
          { description: "Performance Report approved", category: "review", isMandatory: true, requiresHumanApproval: true },
          { description: "Variance analysis reviewed", category: "review", isMandatory: true, requiresHumanApproval: false },
          { description: "Forecast confirmed", category: "approval", isMandatory: false, requiresHumanApproval: false },
        ],
      },
    },
    {
      name: "Closing",
      description: "Formal acceptance, procurement closure, lessons learned, project archive",
      color: "#F59E0B",
      artefacts: [
        { name: "Final Project Report", required: true, aiGeneratable: true },
        { name: "Lessons Learned", required: true, aiGeneratable: true },
        // required:true — gate prereq "Sponsor acceptance sign-off" requires this certificate.
        { name: "Acceptance Certificate", required: true, aiGeneratable: true },
        { name: "Procurement Closure", required: false, aiGeneratable: true },
        { name: "Closure Report", required: false, aiGeneratable: true },
      ],
      gate: {
        name: "Project Closure",
        criteria: "All deliverables accepted, lessons captured, procurements closed, project archived",
        preRequisites: [
          { description: "Final Project Report approved", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Sponsor acceptance sign-off", category: "sign_off", isMandatory: true, requiresHumanApproval: true },
          { description: "Lessons learned captured", category: "document", isMandatory: true, requiresHumanApproval: false },
          { description: "All procurements closed", category: "approval", isMandatory: false, requiresHumanApproval: false },
        ],
      },
    },
  ],
};

// ─── Registry ───

export const METHODOLOGIES: Record<MethodologyId, MethodologyDefinition> = {
  traditional: TRADITIONAL,
  waterfall: WATERFALL,
  scrum: SCRUM,
  kanban: KANBAN,
  safe: SAFE,
  hybrid: HYBRID,
  travel: TRAVEL,
  pmbok: PMBOK,
};

/**
 * Methodologies that are CURRENTLY ACTIVE in the deploy wizard.
 * SAFe and Kanban are intentionally hidden — keep their definitions in
 * the registry so legacy projects still render correctly, but stop
 * surfacing them to new users until they're explicitly reactivated.
 *
 * To reactivate one: remove it from this set. To retire one: also
 * delete its METHODOLOGIES entry + Prisma enum value (irreversible —
 * legacy projects with that methodology will break).
 *
 * Display code should read from METHODOLOGY_LIST (which respects this
 * filter) rather than iterating METHODOLOGIES directly.
 */
const DISABLED_METHODOLOGY_IDS: Set<MethodologyId> = new Set(["safe", "kanban"]);

export function isMethodologyActive(id: string): boolean {
  const raw = String(id).toLowerCase().replace(/[^a-z0-9]/g, "");
  // Don't disable based on raw match for legacy aliases like prince2
  // — those resolve to traditional, which IS active.
  if (raw === "prince2") return true;
  return !DISABLED_METHODOLOGY_IDS.has(raw as MethodologyId);
}

// ─── Per-methodology feature flags ──────────────────────────────────────
/**
 * Capability map per methodology. Controls which project sub-pages and
 * agent behaviours are surfaced.
 *
 *   sprints       — Sprint Planning + Sprint Tracker pages are useful
 *                   (and the agent's prompts about sprints make sense)
 *   agileBoard    — the Agile Board page is shown labelled as such (vs
 *                   `Task Board` when sprints aren't a concept here)
 *   evm           — Earned Value pages / EVM Dashboard are surfaced
 *                   (PMBOK has its own EVM cadence; Traditional / Hybrid
 *                   commonly do EVM; Travel / Scrum don't)
 *   procurement   — Procurement page is surfaced
 *   wbs           — WBS / structured schedule pages are useful (vs a
 *                   simpler trip itinerary view for Travel)
 *
 * Each consumer pulls just the keys it cares about. A new flag should
 * always default to `true` for backwards compat unless the caller
 * specifies otherwise.
 */
export interface MethodologyFeatures {
  sprints: boolean;
  agileBoard: boolean;
  evm: boolean;
  procurement: boolean;
  wbs: boolean;
}

const FEATURE_MAP: Record<MethodologyId, MethodologyFeatures> = {
  traditional: { sprints: false, agileBoard: false, evm: true,  procurement: true,  wbs: true  },
  waterfall:   { sprints: false, agileBoard: false, evm: true,  procurement: true,  wbs: true  },
  scrum:       { sprints: true,  agileBoard: true,  evm: false, procurement: false, wbs: false },
  kanban:      { sprints: false, agileBoard: true,  evm: false, procurement: false, wbs: false }, // legacy
  safe:        { sprints: true,  agileBoard: true,  evm: false, procurement: false, wbs: false }, // legacy
  hybrid:      { sprints: true,  agileBoard: true,  evm: true,  procurement: true,  wbs: true  },
  travel:      { sprints: false, agileBoard: false, evm: false, procurement: false, wbs: false }, // itinerary, not WBS
  pmbok:       { sprints: false, agileBoard: false, evm: true,  procurement: true,  wbs: true  },
};

/**
 * Returns the feature flags for a methodology id, resolving legacy
 * aliases (prince2 → traditional, agile_scrum → scrum, etc.) the same
 * way getMethodology() does. Falls back to Traditional's flags for any
 * id that doesn't resolve — keeps unknown methodologies in a safe,
 * feature-full default.
 */
export function methodologyFeatures(id: string | null | undefined): MethodologyFeatures {
  if (!id) return FEATURE_MAP.traditional;
  const def = getMethodology(id);
  return FEATURE_MAP[def.id] ?? FEATURE_MAP.traditional;
}

/**
 * UI label for the board page. Each methodology calls it something
 * different — "Agile Board" / "Kanban Board" for agile-flavoured work;
 * "Task Board" elsewhere (the page itself works regardless; only the
 * label changes so a Traditional PM doesn't see "Agile Board" in
 * their sidebar).
 */
export function boardPageLabel(id: string | null | undefined): string {
  const def = id ? getMethodology(id) : getMethodology("traditional");
  if (def.id === "kanban") return "Kanban Board";
  if (FEATURE_MAP[def.id]?.agileBoard) return "Agile Board";
  return "Task Board";
}

// Active methodologies only — what the deploy wizard shows. SAFe and
// Kanban are hidden via DISABLED_METHODOLOGY_IDS (see above) without
// removing their definitions, so legacy projects still load correctly.
export const METHODOLOGY_LIST: MethodologyDefinition[] = Object.values(METHODOLOGIES).filter(
  m => isMethodologyActive(m.id),
);

// Full list including disabled — for places that need to render legacy
// projects (e.g. agents list, project detail). Display still uses the
// proper label via getMethodologyLabel; only the picker filters.
export const METHODOLOGY_LIST_INCLUDING_DISABLED: MethodologyDefinition[] = Object.values(METHODOLOGIES);

/**
 * Get a methodology definition by ID (case-insensitive).
 * Falls back to Traditional if not found.
 *
 * Backward-compat: legacy projects with methodology="prince2" stored
 * in the DB still resolve to the Traditional definition. Once a future
 * PRINCE2 methodology is added back, change the alias to point at it.
 */
export function getMethodology(id: string): MethodologyDefinition {
  const raw = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Handle aliases before casting to MethodologyId
  if (raw === "agile" || raw === "agilescrum") return METHODOLOGIES.scrum;
  if (raw === "agilekanban") return METHODOLOGIES.kanban;
  if (raw === "prince2") return METHODOLOGIES.traditional; // legacy alias
  const key = raw as MethodologyId;
  return METHODOLOGIES[key] || METHODOLOGIES.traditional;
}

/**
 * Single-source-of-truth UI label for a methodology id.
 *
 * The DB stores raw enum values like "PRINCE2", "AGILE_SCRUM",
 * "AGILE_KANBAN" (legacy Prisma enum names). When those leak to the UI
 * the user sees confusing internal names — picking "Traditional" then
 * seeing "PRINCE2" on the agents list was the original report that
 * triggered this audit.
 *
 * Previously this lookup was duplicated as a `METHOD_LABEL` Record across
 * 7+ pages (dashboard, portfolio, projects list, project detail, agents
 * list, agent detail, chat). They drifted: none of them knew about the
 * new "travel" id, so a Travel project would render as the raw "travel"
 * lowercase. Use this helper everywhere instead — and DO NOT redefine
 * a local METHOD_LABEL anywhere.
 *
 * Handles every alias the codebase produces:
 *   - DB enum values: PRINCE2, AGILE_SCRUM, AGILE_KANBAN, WATERFALL, HYBRID, SAFE
 *   - canonical ids: traditional, waterfall, scrum, kanban, hybrid, safe, travel
 *   - any case variation (lowercase / uppercase / mixed)
 *   - unknown / empty values → returns "Unknown" so callers don't paint blanks.
 */
export function getMethodologyLabel(id: string | null | undefined): string {
  if (!id) return "Unknown";
  const raw = String(id).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (raw === "prince2" || raw === "traditional") return "Traditional";
  if (raw === "waterfall") return "Waterfall";
  if (raw === "agilescrum" || raw === "scrum" || raw === "agile") return "Scrum";
  if (raw === "agilekanban" || raw === "kanban") return "Kanban";
  if (raw === "safe") return "SAFe";
  if (raw === "hybrid") return "Hybrid";
  if (raw === "travel") return "Travel & Trip";
  if (raw === "pmbok") return "PMBOK";
  return String(id); // fall back to raw so a brand-new id at least shows something
}

/**
 * Map any user-supplied methodology string to a valid Prisma enum value.
 *
 * Single source of truth for the write path. Previously this map was
 * duplicated in `api/projects/route.ts` (used "PRINCE2" for new
 * Traditional rows) and `api/projects/[projectId]/reset-lifecycle/route.ts`
 * (would happily write invalid "SCRUM" / "KANBAN" / "TRAVEL" values for
 * methodologies whose enum names are AGILE_SCRUM / AGILE_KANBAN / TRAVEL —
 * Travel especially broke because the enum had no TRAVEL value at all
 * before this commit).
 *
 * Returns null when the input doesn't match anything — callers should
 * decide what to do (default to WATERFALL, error, etc.).
 *
 * Aliases handled:
 *   - canonical ids → enum names: traditional → TRADITIONAL, travel → TRAVEL, etc.
 *   - legacy aliases: prince2 → TRADITIONAL, agile → AGILE_SCRUM
 *   - Prisma enum names passed back through: TRADITIONAL → TRADITIONAL (idempotent)
 *   - any casing.
 */
export function toMethodologyEnum(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (raw === "traditional" || raw === "prince2") return "TRADITIONAL";
  if (raw === "waterfall") return "WATERFALL";
  if (raw === "scrum" || raw === "agile" || raw === "agilescrum") return "AGILE_SCRUM";
  if (raw === "kanban" || raw === "agilekanban") return "AGILE_KANBAN";
  if (raw === "safe") return "SAFE";
  if (raw === "hybrid") return "HYBRID";
  if (raw === "travel") return "TRAVEL";
  if (raw === "pmbok") return "PMBOK";
  return null;
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
