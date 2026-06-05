/**
 * Phase Depth Configuration
 *
 * Controls the depth of research and artefact generation per phase.
 * Earlier phases (Pre-Project) are lightweight — quick feasibility scans
 * and outline documents. Later phases (Planning, Execution) are deep —
 * extensive research, detailed artefacts with full data.
 *
 * Each phase type gets:
 *   - researchQueries: how many Perplexity queries to run
 *   - maxTokens: Claude generation budget (more tokens = more detail)
 *   - artefactGuidance: depth instruction injected into the generation prompt
 *   - clarificationDepth: how many clarification questions to ask
 */

export interface PhaseDepthConfig {
  researchQueries: number;
  maxTokens: number;
  artefactGuidance: string;
  clarificationDepth: "minimal" | "moderate" | "thorough";
}

const PHASE_DEPTH: Record<string, PhaseDepthConfig> = {
  // ── Pre-Project / Feasibility ──
  "pre-project": {
    researchQueries: 2,
    maxTokens: 4096,
    artefactGuidance: `DEPTH: OUTLINE LEVEL. This is the Pre-Project/feasibility phase.
Documents should be concise overviews (1-3 pages equivalent):
- Problem Statement: clear problem definition, impact, and urgency
- Options Analysis: 2-4 options with pros/cons, no deep financial modelling
- Outline Business Case: high-level justification, rough cost/benefit, go/no-go recommendation
Do NOT produce detailed plans, schedules, or budgets at this stage.`,
    clarificationDepth: "minimal",
  },
  "starting up": {
    researchQueries: 2,
    maxTokens: 4096,
    artefactGuidance: `DEPTH: OUTLINE LEVEL. Startup phase — concise documents only.`,
    clarificationDepth: "minimal",
  },

  // ── Initiation ──
  "initiation": {
    researchQueries: 4,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: DETAILED. This is the Initiation phase.
Documents should be substantive (3-8 pages equivalent):
- Project Charter: full objectives (SMART), scope, milestones, governance structure, roles
- Business Case: detailed financial analysis, cost-benefit, NPV/payback where relevant, risks to benefits
- Initial Risk Register: 10-15 identified risks with full scoring and mitigation strategies
- Stakeholder Register: all identified stakeholders with power/interest analysis and engagement strategy
- Communication Plan: channels, frequency, audience, templates
Build on the APPROVED Pre-Project artefacts — reference the chosen option and outline business case.`,
    clarificationDepth: "moderate",
  },

  // ── Planning ──
  "planning": {
    researchQueries: 6,
    maxTokens: 16384,
    artefactGuidance: `DEPTH: COMPREHENSIVE. This is the Planning phase — the most detailed phase.
Documents must be thorough, production-ready, and internally consistent:
- WBS: 3-level hierarchy (deliverables → work packages → tasks), 30-50 rows minimum
- Schedule: every task dated with predecessors, critical path identified, float calculated
- Cost Management Plan: bottom-up estimate from WBS work packages, contingency, management reserve
- Resource Management Plan: named roles per task, allocation %, cost rates
- Risk Management Plan: updated register with quantified impacts, response strategies, residual scores
- RACI Matrix: every deliverable mapped to Responsible/Accountable/Consulted/Informed
- Quality Management Plan: acceptance criteria per deliverable, QA checkpoints
ALL Planning artefacts must cross-reference each other:
- Cost Plan line items must match WBS work packages
- Schedule task names must match WBS entries
- Resource Plan roles must match task owners in WBS/Schedule
- Risk impacts must reference specific WBS items or milestones`,
    clarificationDepth: "thorough",
  },

  // ── Execution / Delivery ──
  "execution": {
    researchQueries: 3,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: OPERATIONAL. This is the Execution phase.
Documents should track actual progress against the approved plan:
- Status Reports: RAG status, milestones achieved, risks materialised, budget burn
- Change Requests: formal change control with impact assessment
- Quality Reviews: acceptance testing against criteria from Planning
Reference the APPROVED Planning artefacts as the baseline.`,
    clarificationDepth: "moderate",
  },

  // ── Closing ──
  "closing": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: SUMMARY. This is the Closing phase.
Documents should summarise outcomes and capture lessons:
- Lessons Learned: structured review of what went well, what didn't, root causes
- Closure Report: final deliverables, acceptance sign-offs, outstanding items
- Handover Documentation: operational handover checklist, support contacts
Reference ALL prior phase artefacts to compile the closure summary.`,
    clarificationDepth: "minimal",
  },

  // ── Agile phases ──
  "sprint zero": {
    researchQueries: 3,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: FOUNDATION. Sprint Zero — setup and initial backlog.`,
    clarificationDepth: "moderate",
  },
  "sprint cadence": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: ITERATIVE. Sprint cycle — sprint plans, reviews, retrospectives.`,
    clarificationDepth: "minimal",
  },

  // ── Travel phases ──
  "plan": {
    researchQueries: 4,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: DETAILED. Travel planning — trip brief, risk register, cost plan, stakeholder register, schedule.`,
    clarificationDepth: "thorough",
  },
  "book": {
    researchQueries: 3,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Booking phase — booking tracker, documentation checklist, packing list.`,
    clarificationDepth: "moderate",
  },
  "travel": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Active travel phase — status reports, incident tracking, daily updates.`,
    clarificationDepth: "minimal",
  },
  "wrap-up": {
    researchQueries: 1,
    maxTokens: 4096,
    artefactGuidance: `DEPTH: SUMMARY. Post-trip wrap-up — expense reconciliation, closure report, lessons learned.`,
    clarificationDepth: "minimal",
  },

  // ── Hybrid phases ──
  "foundation": {
    researchQueries: 3,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: FOUNDATION. Hybrid foundation — charter, delivery approach, initial registers. Concise but complete.`,
    clarificationDepth: "moderate",
  },
  "iterative delivery": {
    researchQueries: 3,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: OPERATIONAL. Iterative delivery — sprint plans, status reports, working deliverables. Track against the approved plan.`,
    clarificationDepth: "moderate",
  },

  // ── SAFe phases ──
  "pi planning": {
    researchQueries: 4,
    maxTokens: 10240,
    artefactGuidance: `DEPTH: COMPREHENSIVE. PI Planning — program increment objectives, feature decomposition, team capacity, risk ROAMing. This is the heaviest planning ceremony in SAFe.`,
    clarificationDepth: "thorough",
  },
  "iteration cadence": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: ITERATIVE. Iteration cycle — iteration plans, team sync, continuous delivery. Build on PI objectives.`,
    clarificationDepth: "minimal",
  },
  "inspect and adapt": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: REFLECTIVE. Inspect & Adapt — quantitative metrics review, problem-solving workshop, improvement backlog.`,
    clarificationDepth: "minimal",
  },
  "inspect & adapt": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: REFLECTIVE. Inspect & Adapt — quantitative metrics review, problem-solving workshop, improvement backlog.`,
    clarificationDepth: "minimal",
  },

  // ── Kanban phases ──
  "setup": {
    researchQueries: 3,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: FOUNDATION. Kanban setup — board design, WIP limits, service level expectations, initial backlog.`,
    clarificationDepth: "moderate",
  },
  "continuous delivery": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Continuous delivery — flow metrics, WIP tracking, bottleneck analysis, status reports.`,
    clarificationDepth: "minimal",
  },
  "review": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: REFLECTIVE. Review phase — retrospective, metrics analysis, process improvements, lessons learned.`,
    clarificationDepth: "minimal",
  },

  // ── Scrum / shared ──
  "release": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Release — deployment plans, release notes, rollback strategy, stakeholder communication.`,
    clarificationDepth: "minimal",
  },

  // ── PMBOK-specific phases ──
  "initiating": {
    researchQueries: 4,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: DETAILED. PMBOK Initiating — project charter, initial stakeholder register. Formal authorisation of the project.`,
    clarificationDepth: "moderate",
  },
  "monitoring and controlling": {
    researchQueries: 3,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: ANALYTICAL. Monitoring & Controlling — performance reports, earned value analysis, variance analysis, change control. Track against the approved baselines from Planning.`,
    clarificationDepth: "moderate",
  },
  "monitoring & controlling": {
    researchQueries: 3,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: ANALYTICAL. Monitoring & Controlling — performance reports, earned value analysis, variance analysis, change control.`,
    clarificationDepth: "moderate",
  },

  // ── Waterfall-specific phases ──
  "requirements": {
    researchQueries: 3,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: DETAILED. Requirements phase — elicitation, documentation, traceability. Foundation for all downstream work.`,
    clarificationDepth: "thorough",
  },
  "design": {
    researchQueries: 4,
    maxTokens: 10240,
    artefactGuidance: `DEPTH: COMPREHENSIVE. Design phase — detailed technical/functional design, WBS, schedule, cost estimates. Second heaviest phase after Planning.`,
    clarificationDepth: "thorough",
  },
  "build": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Build phase — construction/development tracking, quality assurance, progress against schedule.`,
    clarificationDepth: "minimal",
  },
  "test": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Test phase — test execution, defect tracking, acceptance testing against criteria from Design.`,
    clarificationDepth: "minimal",
  },
  "deploy": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Deploy phase — cutover planning, rollback strategy, go-live checklist, training delivery.`,
    clarificationDepth: "minimal",
  },
};

/** Get depth config for a phase. Falls back to moderate defaults for unknown phases. */
export function getPhaseDepth(phaseName: string): PhaseDepthConfig {
  const key = phaseName.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  return PHASE_DEPTH[key] || {
    researchQueries: 3,
    maxTokens: 8192,
    artefactGuidance: `Generate complete, project-specific artefacts appropriate to the "${phaseName}" phase.`,
    clarificationDepth: "moderate" as const,
  };
}
