# Per-Artefact Data-Source Map

**Purpose**: For every artefact the agent can generate, this document lists exactly where the agent pulls its information from. Use it to:

- Answer "where did the agent get that fact from?"
- Plan clarification depth — artefacts heavy in source **B** suffer most when clarification is sparse.
- Decide which artefacts are worth approving first — later artefacts depend on **D** (earlier approved artefacts).
- Audit data-flow when an artefact contains an incorrect or missing field.

The agent's prompt is assembled by `getProjectKnowledgeContext` ([src/lib/agents/artefact-learning.ts](../src/lib/agents/artefact-learning.ts)) plus the per-artefact template in `buildArtefactPrompt` / `buildSpreadsheetPrompt` ([src/lib/agents/lifecycle-init.ts](../src/lib/agents/lifecycle-init.ts)).

---

## The 10 data sources

Every artefact draws a subset of these. Each row in the tables below cites the codes used.

| Code | Source | Where it comes from | When it's available |
|---|---|---|---|
| **A** | Project baseline | `Project` record (name, description, category, budget, dates, methodology) | Always |
| **B** | User-confirmed facts | `KnowledgeBaseItem` rows tagged `user_confirmed` / `user_answer` | After clarification |
| **C** | Stakeholder roster | `Stakeholder` table (sponsor, PM, contacts with role + organisation + email + power/interest) | After Stakeholder Register approved |
| **D** | Approved earlier artefacts | Last 12 APPROVED `AgentArtefact` rows (first 600 chars each) | Phase ≥ 2 |
| **E** | Feasibility research | Perplexity at deploy — KB items tagged `feasibility` | After deploy |
| **F** | Phase research | Perplexity per phase — KB items tagged `phase_research` + phase name | After phase advance |
| **G** | Workspace KB | Org-level templates / policies / standards (`KnowledgeBaseItem` with `layer: "WORKSPACE"`) | If org has uploaded any |
| **H** | Cross-project priors | HIGH_TRUST KB from top-3 most similar past projects in the org (cosine sim ≥ 0.55) | If similar past projects exist |
| **I** | Live DB state | `Task` / `Risk` / `CostEntry` / `Issue` / `Sprint` / `Approval` tables | Always (for ops/closure artefacts) |
| **J** | Per-artefact template | Column / section structure baked into `lifecycle-init.ts` (`buildArtefactPrompt`) | Always |

---

## Pre-Project / Requirements (foundational)

| Artefact | Sources | Notes |
|---|---|---|
| Problem Statement | A · B · E | Frames why-now; minimal priors exist |
| Options Analysis | A · B · E · H | Cross-project priors help if similar projects exist |
| Project Brief | A · B · E · C | Cites top 5 stakeholders explicitly |
| Outline Business Case | A · B · E | Lightweight 2-pager — go/no-go |
| Requirements Specification | A · B (heaviest) · E | Clarification answers feed straight in |
| Feasibility Study | A · B · E (heaviest) · F | Mandatory current-year RAG sections per category |
| Initial Stakeholder Register | A · B · E + role-title heuristic | Anti-fabrication filter on names ([fabricated-names.ts](../src/lib/agents/fabricated-names.ts)) |
| Initial Risk Register | A · B · E · I + category catalogue | Standard risks per category template |

## Initiation / Design (planning)

| Artefact | Sources | Notes |
|---|---|---|
| Project Charter | A · B · C · D (Brief + OBC) | Authorisation; sponsor named from C |
| Business Case (full) | A · B · D (OBC) + benefit projections | NPV/ROI calc baked in J |
| Stakeholder Register (mature) | A · B · D (Initial) · E | Refined version of Initial |
| Communication Plan | C · B + RACI hints | Driven by stakeholder roles |
| Design Document | A · B · E · F | Technical research |
| Work Breakdown Structure | A · B · D · G + category decomposition | Outputs CSV → seeds `Task` table via [schedule-parser.ts](../src/lib/agents/schedule-parser.ts) |
| Schedule with Dependencies | WBS rows · A.dates · category lead-times | Outputs CSV → schedule-parser → tasks |
| Cost Management Plan | A.budget · B · D · category cost templates | Outputs CSV → seeds `CostEntry` |
| Resource Management Plan | C · role inference · B | |
| Risk Management Plan | D (Initial RR) · B · category catalogue | |
| Quality Management Plan | A.category · B · standards research | |
| Change Control Plan | methodology boilerplate · A | |
| RACI Matrix | C · WBS task list (D) · role inference | |

## Build / Execution / Sprint Cadence (operational — heaviest on live state)

| Artefact | Sources | Notes |
|---|---|---|
| Status Reports | I (tasks/risks/costs/issues) · A.dates · recent activity | RAG calc from elapsed-vs-progress |
| Risk Reviews | I (Risk table changes since last review) | |
| Change Request Register | I (`ChangeRequest`) · B · D | Outputs CSV → seeds `ChangeRequest` |
| Exception Reports | I (overdue tasks, budget overrun) · B | Tolerance thresholds |
| Quality Review Records | I · D (Requirements Spec acceptance criteria) | |
| Sprint Plans | I (`Sprint` + `Task`) · D (Initial Product Backlog) | Outputs CSV → seeds `Sprint` |
| Iteration Plans | Same as Sprint Plans (SAFe naming) | |
| Sprint Reviews | I (window-scoped tasks) | |
| Retrospectives | chat history (sprint window) · I · B | |
| Burndown Chart | I (task completion over sprint dates) | |
| System Demos | (manual — not aiGeneratable) | User uploads |

## Closure

| Artefact | Sources | Notes |
|---|---|---|
| Closure Report | D (all approved) · I (final state) · B | |
| Lessons Learned | D · I · chat history · B | |
| Acceptance Certificate | A · D · sign-off names (B/C) | |
| Handover Documentation | D (plans) · I (ops state) · ops contacts | |

## Scrum-specific

| Artefact | Sources | Notes |
|---|---|---|
| Product Vision | A · B · E | Clarification asks vision questions |
| Definition of Done | methodology default · B (quality gates) · D | |
| Team Charter | C · B (team norms) | |
| Initial Product Backlog | A · B · D (Reqs/Brief) · F | Outputs CSV → seeds `Sprint` + `Task` |
| Final Retrospective | All sprint Retrospectives summarised | |

## SAFe-specific

| Artefact | Sources | Notes |
|---|---|---|
| PI Objectives | A · B · D (Initial Product Backlog) | |
| Programme Board | D (PI Objectives) · dependencies | |
| Solution Vision | A · B · F | |
| Architectural Runway | D · technical research · B | |
| Team Topologies | C · B (team structure) | |
| PI Report | I (PI metrics) · chat | |
| Improvement Backlog | Retrospectives · I | |

## Kanban-specific

| Artefact | Sources | Notes |
|---|---|---|
| Board Configuration | methodology defaults · B (workflow stages) | |
| WIP Policies | methodology defaults · B (capacity) | |
| Service Level Agreement | B (cycle time targets) · F | |
| Cumulative Flow Diagram | I (task state changes over time) | |
| Process Improvement Report | I · Retrospectives | |
| Bottleneck Analysis | I (tasks-in-state durations) | |
| Service Level Reports | I · SLA from D | |
| Flow Metrics Reports | I (lead time, throughput) | |

## Hybrid-specific

| Artefact | Sources | Notes |
|---|---|---|
| Delivery Approach | A.methodology · B (delivery questions) | |
| Roadmap | A.dates · D (WBS + Backlog) | |
| Phase Progress Reports | I · phase artefacts | |

## Test / Release

| Artefact | Sources | Notes |
|---|---|---|
| Test Plan | D (Requirements Spec) · B · standards | |
| Test Results | (manual — not aiGeneratable) | User uploads |
| Release Plan | D · I | |

---

## Bespoke artefacts (chat-created)

When the user asks the agent in chat to create a custom document via the `create_artefact` tool:

- **Sources used**: A · B · D · whatever the user supplies in the chat message · the agent's general reasoning.
- **Not used by default**: E / F / H — the bespoke prompt doesn't go through `generatePhaseArtefacts` so it doesn't auto-inject research. If the user wants research-backed content, they can ask the agent to call `run_phase_research` first.
- **Source badge**: `Custom` (amber) on the Artefacts page — does not gate phase advancement.

---

## Two key behaviours that fall out of this

1. **Phase order matters** — phase N has access to D (approved artefacts from 1..N-1). Skip approving an early-phase artefact and downstream artefacts have less context to draw on. That's why phase advancement is gated.

2. **Clarification quality dominates output quality** — every plan/register/charter leans heavily on **B** (user-confirmed facts). Sparse clarification → assumptions recorded as `[TBC — …]` markers + `record_assumption` calls. Spending 5 mins on clarification produces dramatically better artefacts than fixing afterwards.

---

## When debugging "where did the agent get this fact from?"

1. Check the artefact name → look up the row above.
2. The source codes tell you where to look in the DB:
   - **B / C** → `KnowledgeBaseItem` and `Stakeholder` for the project.
   - **D** → `AgentArtefact` rows with `status: "APPROVED"`.
   - **E / F** → `KnowledgeBaseItem` with `tags: { has: "feasibility" }` or `phase_research`.
   - **I** → live tables (`Task`, `Risk`, `CostEntry`, etc.) at the moment generation ran.
3. The artefact's full version history is in `AgentArtefact.version` + the activity feed (`Learnt from "<artefact>"` entries) shows when knowledge was extracted from each save/approve.