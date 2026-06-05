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
    artefactGuidance: `DEPTH: OUTLINE LEVEL. Starting Up (PRINCE2 SU) phase — formal authorisation prep.
Concise documents (1-2 pages each):
- Project Brief: outline objectives, scope, approach, customer's quality expectations
- Project Approach: chosen delivery method + justification, NOT the detailed plan
- Daily Log: initial issues / lessons / risks captured during startup
DO NOT produce detailed PIDs, full Risk Registers, or work-package plans here — those belong to Initiation.`,
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
    artefactGuidance: `DEPTH: FOUNDATION. Sprint Zero — set up the engine before any feature work.
Substantive but not overplanned (3-5 pages each):
- Product Backlog: initial epics + 15-25 user stories with rough story-point estimates, MoSCoW prioritisation
- Definition of Done: explicit checklist (review, test coverage, docs, deploy, accept)
- Team Working Agreement: working hours, ceremonies cadence, communication channels, escalation paths
- Architectural Runway: NFRs, integration points, environments, observability baseline
NOT detailed sprint plans — Sprint 1 onwards covers those.`,
    clarificationDepth: "moderate",
  },
  "sprint cadence": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: ITERATIVE. Sprint cycle — per-sprint deliverables that BUILD ON Sprint Zero.
Per sprint:
- Sprint Plan: sprint goal, committed stories with points, capacity vs commitment
- Sprint Review: stories accepted vs deferred, demo notes, stakeholder feedback
- Sprint Retrospective: what went well / didn't / will change — concrete actions with owners
- Sprint Burndown: actuals vs ideal, scope changes mid-sprint
Reference the Product Backlog and Definition of Done from Sprint Zero — do NOT redefine them.`,
    clarificationDepth: "minimal",
  },

  // ── Travel phases ──
  "plan": {
    researchQueries: 4,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: DETAILED. Travel planning — heaviest phase of a trip.
Documents must be specific to the destination(s) and dates:
- Trip Brief: purpose, traveller(s), dates, destination(s), budget, success criteria
- Travel Risk Register: destination-specific (visa, health, security, weather, transport) — 8-15 items with mitigation
- Cost Plan: flights / accommodation / transport / activities / contingency — bottom-up with REAL prices for destination + dates from research
- Itinerary Outline: day-by-day skeleton with confirmed bookings vs. tentative
- Travel Stakeholder Register: travellers, host contacts, emergency contacts
Reference REAL destination context (visa rules, exchange rates, transport options) from research — generic "check visa requirements" is not acceptable.`,
    clarificationDepth: "thorough",
  },
  "book": {
    researchQueries: 3,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Booking phase — convert the plan into confirmed reservations.
Track-as-you-go documents:
- Booking Tracker: each booking (flight / hotel / transfer / activity) with status (booked / hold / cancelled), confirmation number, cost, payment status
- Documentation Checklist: passport validity, visa applied/granted, insurance bought, vaccinations, currency obtained, driving permit
- Packing List: tailored to destination climate, activities, duration, baggage allowance
- Pre-Travel Health Plan: any required vaccinations, prescriptions, jet-lag strategy
NOT detailed itinerary changes — those go in Travel phase if real-time adjustments are needed.`,
    clarificationDepth: "moderate",
  },
  "travel": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. In-trip phase — real-time tracking, not pre-planning.
Live-updated documents:
- Travel Log: dated entries per day (where, what, who, key moments, expenses)
- Incident Tracking: anything that went wrong (lost luggage, delays, medical, security) with status + resolution
- Real-Time Expense Tracker: actuals vs. budget with category breakdown
- Stakeholder Check-ins: planned vs. completed contact (emergency contacts, host, home)
Reference the booked Itinerary from "Book" phase — do NOT redesign the trip here.`,
    clarificationDepth: "minimal",
  },
  "wrap-up": {
    researchQueries: 1,
    maxTokens: 4096,
    artefactGuidance: `DEPTH: SUMMARY. Post-trip wrap-up — close the loop in 1-2 pages each.
- Expense Reconciliation: actuals vs. planned by category, currency conversion applied, receipts collected, reimbursements requested
- Trip Closure Report: did the trip achieve its purpose? key outcomes? unresolved actions?
- Lessons Learned: what to repeat / avoid for future trips — specific to destination + trip type
Reference the Travel Log and Incident Tracking from Travel phase as the source of truth.`,
    clarificationDepth: "minimal",
  },

  // ── Hybrid phases ──
  "foundation": {
    researchQueries: 3,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: FOUNDATION. Hybrid foundation — set the rails for both plan-driven AND iterative work.
Substantive (3-5 pages each):
- Hybrid Charter: scope, objectives, success criteria, AND explicit declaration of which deliverables are plan-driven vs. iteratively delivered
- Delivery Approach: when to use waterfall (compliance, infrastructure) vs. agile (UX, features), with crossover points
- Initial Risk + Stakeholder Register: 8-12 risks, sponsor + key contacts
- Governance Cadence: which decisions go through stage gates vs. sprint reviews
NOT detailed iteration plans — those belong to "iterative delivery".`,
    clarificationDepth: "moderate",
  },
  "iterative delivery": {
    researchQueries: 3,
    maxTokens: 8192,
    artefactGuidance: `DEPTH: OPERATIONAL. Iterative delivery — execute the iterative portion of the hybrid plan.
Per iteration:
- Iteration Plan: scope for this iteration (stories / features), capacity, commitment
- Iteration Status Report: completed vs. committed, blockers, scope churn
- Working Deliverables Catalogue: what shipped this iteration, with acceptance evidence
- Cross-Stream Alignment Note: hand-offs to the plan-driven workstreams (specs done, environments needed)
Reference the Hybrid Charter from Foundation — call out when iteration findings should trigger a stage-gate review.`,
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
    artefactGuidance: `DEPTH: ITERATIVE. SAFe iteration — execute against the PI plan.
Per iteration (2-week cadence):
- Iteration Plan: stories pulled from PI features, team capacity, dependencies on other ARTs
- Iteration Goals: 3-5 concrete goals that ladder up to PI objectives
- Daily Stand-up Notes: blockers / decisions / dependencies-needing-help
- Iteration Review: demo notes, business value delivered, stakeholder feedback
- System Demo Input: working features ready for the System Demo at iteration end
Reference PI objectives explicitly — every story must trace back to a PI feature.`,
    clarificationDepth: "minimal",
  },
  "inspect and adapt": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: REFLECTIVE. SAFe Inspect & Adapt — end-of-PI improvement workshop.
Substantive (3-5 pages each):
- PI Metrics Review: predictability measure (planned vs. actual business value), velocity trend, quality indicators (escaped defects, tech debt)
- Problem-Solving Workshop Output: top 3-5 systemic problems with root-cause analysis (fishbone or 5-whys), prioritised by impact
- Improvement Backlog: concrete actions with owners, target PI, and success measure
- Quantitative Demo: aggregate of all working features delivered across the PI
Reference PI objectives + every iteration's retro inputs — the workshop synthesises the PI, not just the last iteration.`,
    clarificationDepth: "minimal",
  },
  "inspect & adapt": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: REFLECTIVE. SAFe Inspect & Adapt — end-of-PI improvement workshop.
See "inspect and adapt" entry for the same substantive guidance — same artefacts, same depth.
Key outputs: PI Metrics Review, Problem-Solving Workshop output, Improvement Backlog with owners + target PI.`,
    clarificationDepth: "minimal",
  },

  // ── Kanban phases ──
  "setup": {
    researchQueries: 3,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: FOUNDATION. Kanban setup — design the flow before any work crosses the board.
Substantive (3-5 pages each):
- Kanban Board Design: columns (To Do / Doing / Done at minimum, plus class-of-service swimlanes if relevant), policies per column
- WIP Limits Justification: per-column limits based on team size + cycle-time data (or stated assumption if no data yet)
- Service Level Expectations: per class of service (Expedite / Standard / Fixed Date / Intangible) — target cycle times with percentiles
- Initial Backlog: ready cards with explicit acceptance criteria — replenishment cadence stated
- Cadence Policies: replenishment, delivery, review meeting schedule
NOT a sprint plan — Kanban is flow-based, not iteration-based.`,
    clarificationDepth: "moderate",
  },
  "continuous delivery": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Kanban continuous delivery — keep the flow healthy.
Living documents (updated continuously):
- Flow Metrics Dashboard: cycle time (average + 85th percentile), throughput (items per week), WIP (current vs. limit), aging WIP
- Bottleneck Analysis: where work is stuck longest, why (waiting / blocked / queue at a stage), and what's being done
- Cumulative Flow Diagram: stacked area chart of items in each column over time, surfacing widening WIP bands
- Class-of-Service Status: SLE adherence per class — what's hitting target percentile, what's slipping
- Replenishment Notes: which cards pulled in at each replenishment, why those, what was deferred
Reference SLEs from Setup phase — call out drift from those targets explicitly.`,
    clarificationDepth: "minimal",
  },
  "review": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: REFLECTIVE. Kanban review — operations review of the flow itself, not a project retrospective.
Substantive (2-4 pages each):
- Service Delivery Review: SLE adherence per class of service, with trends
- Flow Health Report: cycle time / throughput / WIP trends, regression vs. last review
- Process Change Proposals: concrete changes to WIP limits / policies / classes of service, with expected effect
- Risk Review: flow-blocking risks (dependencies, single-points-of-failure, technical debt growth)
Reference the Flow Metrics Dashboard from Continuous Delivery as the evidence base.`,
    clarificationDepth: "minimal",
  },

  // ── Scrum / shared ──
  "release": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Release — controlled go-live, not feature work.
Action-shaped documents (2-4 pages each):
- Release Plan: scope (which features / fixes), target date, environments path (dev → staging → prod), responsible teams
- Release Notes: user-facing changes per scope item, migration steps, known issues
- Rollback Strategy: trigger conditions, decision authority, rollback steps, data implications, comms plan if invoked
- Go/No-Go Checklist: explicit gates (test sign-off / change approval / capacity / on-call coverage) with current status
- Stakeholder Communication Plan: pre-release notice, go-live notice, post-release confirmation — recipients + timing
Reference the Build / Test phase outputs as the evidence trail for the Go/No-Go gates.`,
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
    artefactGuidance: `DEPTH: OPERATIONAL. Build phase — construct against the design, NOT redesign.
Tracking documents (2-4 pages each):
- Build Status Report: % complete per WBS work package, actual hours vs. estimated, scope churn
- Defect Log: defects found in build (NOT test — those are caught in Test phase), severity, owner, status
- Code/Asset Inventory: artefacts produced this phase (modules / docs / configs), with version + location
- Build Quality Gates: explicit checks (peer review / static analysis / unit tests) — pass rate per work package
Reference the Design phase artefacts as the spec to build against — call out any deviations as change requests.`,
    clarificationDepth: "minimal",
  },
  "test": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Test phase — execute against acceptance criteria from Design.
Evidence-shaped documents (2-4 pages each):
- Test Execution Report: tests run / passed / failed / blocked per test suite, with pass rate trend
- Defect Triage Log: each test defect with severity (S1-S4), owner, status, fix-version target
- UAT Sign-off Pack: acceptance criteria from Design vs. test evidence, sponsor-ready summary
- Regression Pass Summary: existing functionality re-verified, exception list (regressions blocking go-live)
- Performance / Non-Functional Test Results: load / soak / security against NFR targets from Design
Reference Design phase acceptance criteria explicitly — any criterion without a test is a gap to flag.`,
    clarificationDepth: "minimal",
  },
  "deploy": {
    researchQueries: 2,
    maxTokens: 6144,
    artefactGuidance: `DEPTH: OPERATIONAL. Deploy phase — go-live execution, NOT planning.
Cutover-shaped documents (2-4 pages each):
- Cutover Runbook: minute-by-minute steps for go-live day with owner + duration + rollback decision points
- Rollback Strategy: trigger conditions, decision tree, data implications, comms plan if invoked
- Go-Live Checklist: explicit gates (infra ready / data migrated / user accounts provisioned / on-call coverage / monitoring armed) with status
- Training Delivery Log: who trained, when, attendance, knowledge check pass rate
- Hypercare Plan: post-go-live support window, escalation paths, success metrics for declaring stable
Reference Test phase sign-off as the entry gate — Deploy must not start without it.`,
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
