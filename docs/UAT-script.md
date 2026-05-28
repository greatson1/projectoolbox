# Projectoolbox — UAT script

A ~30-minute walk-through that exercises every promise the landing page
makes against the live app at https://projectoolbox.com. Tick each box;
note anything that doesn't match the expected behaviour in the **Found**
column so we can close gaps systematically.

Generated alongside a codebase audit — every step below maps to a real
API route + page that exists today. The map is at the bottom of this
file.

---

## A. Public surface (no auth required) — ~3 min

| # | Step | Expected | Found |
|---|---|---|---|
| A1 | Visit https://projectoolbox.com | Headline "Your Projects. Delivered with AI." renders. No PRINCE2 / PMI-Style copy anywhere. | |
| A2 | Scroll feature grid | 5 pillars: Sector-tailored agents · Governance · Meeting intelligence · Living KB · EVM. "Any Methodology" lists Traditional, Scrum, Waterfall, SAFe, Kanban, Hybrid. | |
| A3 | Click each FAQ entry | All 7 questions expand with non-empty answers. | |
| A4 | Open `/about` | Mission statement renders. No PRINCE2. PMGT Solutions Ltd named. | |
| A5 | Open `/login` | Google OAuth button + email/password form + "Sign up" link visible. | |
| A6 | Open `/signup` | Form renders; no console errors. | |

---

## B. Auth + onboarding — ~3 min

| # | Step | Expected | Found |
|---|---|---|---|
| B1 | Sign in with Google OR email | Lands on `/dashboard` (not `/login`). Org auto-attached. | |
| B2 | Check dashboard top stats | Active Projects, Completed Tasks, Pending Approvals, Open Risks all show numeric values (not "NaN" / "—"). | |
| B3 | Check Stuck Conversations panel | If any agent question is >4h old, it's listed; otherwise the panel is absent (not "0 stuck"). | |
| B4 | Sidebar nav | Every nav item routes without 500: Dashboard, Projects, Portfolio, Programmes, Approvals, Activity, Knowledge, Meetings, Calendar, Notifications, Billing. | |

---

## C. Deploy an agent — ~5 min (this is the headline flow)

| # | Step | Expected | Found |
|---|---|---|---|
| C1 | Click "Deploy Agent" | Wizard opens at step 1. | |
| C2 | Choose **Traditional** methodology | Card shows 👑 icon, "Structured stage-gate governance". NO "(PMI-Style)" suffix. | |
| C3 | Fill project name + brief description | Both fields accept input; placeholder text reads "e.g. Agile, Traditional, Construction, IT Ops" — NO PRINCE2 mention. | |
| C4 | Pick autonomy level | 3 options (L1 Advisor, L2 Co-pilot, L3 Autonomous) with descriptions. | |
| C5 | Submit | Deploy succeeds within ~15s. Lands on agent live page or chat. | |
| C6 | Check banners | Top pipeline strip says one of: **Research** / **Approve research** / **Clarification** / **Generate artefacts**. NOT "Researching" while the chat shows artefact review (regression we just fixed). | |

---

## D. Chat with the agent — ~5 min

| # | Step | Expected | Found |
|---|---|---|---|
| D1 | Open Chat with the new agent | Greeting message visible. No `[I asked the user]:` leak. No `<prior_*>` tags. | |
| D2 | Watch for research findings | Within ~30s the "Research Findings — review before approving" card appears OR the agent says it's running research. | |
| D3 | Approve a research card | Findings move to KB as `user_confirmed`/`HIGH_TRUST`. Banner advances. | |
| D4 | Answer a clarification question | "QUESTION X of Y" card renders. Confirm button works. **No** "What is the X lead?" — should be "Who is the X lead?". | |
| D5 | Skip a question | "I'll fill this in later" pill works. Banner re-renders honestly. | |
| D6 | Type "what's next?" in chat | Agent responds within ~5s. Reply does NOT contain `[I asked the user]:` or `[VERIFIED]` artefacts. | |

---

## E. Artefact generation + review — ~5 min

| # | Step | Expected | Found |
|---|---|---|---|
| E1 | Open `/projects/<id>/artefacts` | Top stats card shows TOTAL / APPROVED / IN REVIEW / DRAFTS — counts match the artefact list. | |
| E2 | Look at the Griffin-style banner | If methodology says 4 but only 3 exist, banner reads "X/4 approved · 1 not yet generated" — NOT "3/3 approved". | |
| E3 | Open a draft artefact | Editor loads, content renders. Sources & Assumptions appendix present. | |
| E4 | Approve one draft | Banner copy updates: "Once all N are approved, a phase gate appears on the Approvals page" — NOT "automatically generate the Initiation phase documents". | |
| E5 | Check artefact badges | Each draft has Methodology / Custom badge. A custom-named upload that fuzzy-matches a canonical (e.g. "Project Brief - Family Trip" matches "Project Brief") gets Methodology badge. | |

---

## F. PM Tracker + phase gates — ~3 min

| # | Step | Expected | Found |
|---|---|---|---|
| F1 | Open `/projects/<id>/pm-tracker` | Phase blocks render with status pill (Pending / Active / Done). Current phase highlighted. | |
| F2 | Look at PM Tasks list | Each task has hint text — "auto — ticks when X is generated" or "auto — ticks when you add a stakeholder · or click ○ to mark done". | |
| F3 | Click ○ on a soft task | Marks done immediately. Reopening works. | |
| F4 | Look at gate prerequisites | List of prereqs with met/unmet badges. Mandatory ones can't be ticked manually unless `requiresHumanApproval` is true. | |

---

## G. Risk Register — ~3 min

| # | Step | Expected | Found |
|---|---|---|---|
| G1 | Open `/projects/<id>/risk` | If new project: empty state with "Your AI agent will identify and flag risks automatically" — NOT a placeholder "Risk of exceeding the £0 budget" row. | |
| G2 | Add a risk manually | Save succeeds. "Review and update Risk Register" PM task auto-ticks on next refresh. | |
| G3 | Stats card | TOTAL · CRITICAL · MITIGATING · AVG SCORE all show numeric values. Critical threshold = score ≥ 15 (standard 5×5). | |

---

## H. Cost / EVM / Schedule — ~3 min

| # | Step | Expected | Found |
|---|---|---|---|
| H1 | Open `/projects/<id>/evm` | If budget unset: card shows "Awaiting cost data" / null — NOT fake SPI/CPI. | |
| H2 | Set budget on project | Refresh EVM. Real numbers appear. | |
| H3 | Open `/projects/<id>/schedule` | Gantt renders. Scaffolded PM-overhead tasks NOT shown (only delivery + WBS-derived). | |
| H4 | Open `/projects/<id>/cost` | Estimate + actuals tables. | |

---

## I. Meetings — ~3 min (only if you have a real Google Meet / Zoom call)

| # | Step | Expected | Found |
|---|---|---|---|
| I1 | Open `/meetings` | List of past + upcoming meetings. | |
| I2 | Schedule an agent to a real meeting | Recall.ai bot joins within ~1m of meeting start. | |
| I3 | After meeting ends | Transcript appears, action items extracted, decisions logged. Plan updated automatically. | |

---

## J. Billing — ~2 min

| # | Step | Expected | Found |
|---|---|---|---|
| J1 | Open `/billing/credits` | Credit balance + recent transactions. | |
| J2 | Click upgrade plan | Stripe Checkout opens (LIVE keys — be careful) with correct GBP price. | |
| J3 | Back to billing | Stripe portal link works for managing subscription. | |

---

## K. Approvals queue — ~2 min

| # | Step | Expected | Found |
|---|---|---|---|
| K1 | Open `/approvals` | Pending approvals grouped (research findings, phase gates, change requests). | |
| K2 | Approve one | Status updates immediately. Activity log records the approval. | |

---

## Codebase ↔ feature pillar map (audit)

Every promise on the landing page has a real implementation:

| Landing-page pillar | Page(s) | API route(s) | Library |
|---|---|---|---|
| Sector-tailored AI Project Managers | `/agents/deploy`, `/agents/[id]` | `/api/agents/*` | `src/lib/agents/lifecycle-init.ts` |
| Governance / approvals + phase gates | `/approvals`, `/projects/[id]/pm-tracker` | `/api/approvals/*`, `/api/admin/hitl-policy` | `src/lib/agents/phase-next-action.ts`, `phase-completion.ts` |
| Meeting Intelligence (Recall.ai) | `/meetings`, `/calendar` | `/api/meetings/*`, `/api/webhooks/meeting-transcript` | `src/lib/recall-client.ts` |
| Living Knowledge Base | `/knowledge`, `/projects/[id]/audit` | `/api/projects/[id]/kb-by-ids` | `src/lib/agents/confirmed-facts.ts` |
| Earned Value Management | `/projects/[id]/evm` | `/api/projects/[id]/evm` | `src/lib/agents/evm-engine.ts` |
| Methodology flexibility (6 frameworks) | deploy wizard | `getMethodology()` | `src/lib/methodology-definitions.ts` + `methodology-playbooks.ts` |
| 3-step flow (brief → clarify → generate) | `/agents/deploy` → chat | `/api/agents/[id]/deploy`, `/api/agents/[id]/clarification/*`, `/api/projects/[id]/artefacts/generate` | `lifecycle-init.ts`, `clarification-session.ts` |
| Credits + plans | `/billing/credits` | `/api/billing/checkout`, `/api/billing/portal` | `src/lib/credits/service.ts` |
| Autonomy levels (L1/L2/L3) | deploy wizard, agent config | `/api/agents/[id]/config` | `src/lib/agents/decision-classifier.ts` |
| Sources & Assumptions (every artefact) | each artefact body | n/a | enforced in `lifecycle-init.ts:1302` |

**151 API routes**, **27 per-project sub-pages**, **6 methodologies**, **9 artefact-purpose rules**, **193 unit tests + 4 integration tests** all wired and passing CI on `master`.

---

## What I cannot remotely verify (you must)

- Authenticated UI rendering — colours, layout, mobile responsiveness
- Real Stripe checkout flow (live keys; only you can complete a purchase safely)
- Recall.ai bot joining a real call
- Google Meet OAuth + calendar sync against your account
- LLM cost-per-cycle in practice
- Visual regression vs prior versions

The UAT above is the closest a one-person walk-through can get.
