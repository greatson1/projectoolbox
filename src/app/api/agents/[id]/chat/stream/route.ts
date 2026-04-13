import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CreditService } from "@/lib/credits/service";
import { resolveApiCaller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/agents/[id]/chat/stream — Streaming chat via SSE
 * Returns tokens as they arrive from Anthropic's streaming API.
 * Accepts: browser session cookie OR Authorization: Bearer ptx_live_<key>
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = caller.orgId;
  const body = await req.json();
  const { message, conversationId } = body;

  if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 });

  // Credit check
  const hasCredits = await CreditService.checkBalance(orgId, 1);
  if (!hasCredits) {
    return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
  }

  // Save user message
  await db.chatMessage.create({
    data: { agentId, conversationId, role: "user", content: message },
  });

  // ── Clarification session guard ───────────────────────────────────────────────
  // If an active clarification session exists, messages in the chat stream are
  // treated as free typed answers — route through the answer endpoint instead of
  // burning AI credits here.  The dedicated widget in the UI already calls
  // /clarification/answer directly; this is a fallback for users who type manually.
  let isClarificationAnswer = false;
  try {
    const deployment0 = await db.agentDeployment.findFirst({
      where: { agentId, isActive: true },
      select: { projectId: true },
    });
    if (deployment0?.projectId) {
      const { getActiveSession } = await import("@/lib/agents/clarification-session");
      const activeSession = await getActiveSession(agentId, deployment0.projectId);
      if (activeSession) {
        isClarificationAnswer = true;
        // Route to dedicated zero-cost clarification answer handler
        const currentQuestion = activeSession.questions[activeSession.currentQuestionIndex];
        if (currentQuestion) {
          const { answerQuestionInSession } = await import("@/lib/agents/clarification-session");
          answerQuestionInSession(agentId, deployment0.projectId, orgId, currentQuestion.id, message).catch(() => {});
        }
      }
    }
  } catch {}

  // If this is a clarification answer, record it but still send to Claude
  // so the agent responds intelligently (not just "Got it")
  // The clarification answer has already been processed above — now let the
  // message flow through to the normal Claude stream so the agent can
  // acknowledge, provide context, and ask the next question naturally.

  // Get agent config + full project context
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: {
      deployments: {
        where: { isActive: true },
        include: { project: true },
      },
    },
  });

  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const deployment = agent.deployments[0];
  const project = deployment?.project;
  const personality = (agent.personality as any) || {};
  const formalLevel = personality.formalityLevel ?? personality.formal ?? 50;
  const conciseness = personality.conciseness ?? 50;

  // Load lifecycle context from DB
  let phases: any[] = [];
  let pendingApprovals: any[] = [];
  let recentArtefacts: any[] = [];
  let openRisks: any[] = [];
  let recentActivity: any[] = [];
  let knowledgeItems: any[] = [];

  if (project?.id) {
    [phases, pendingApprovals, recentArtefacts, openRisks, recentActivity, knowledgeItems] = await Promise.all([
      db.phase.findMany({ where: { projectId: project.id }, orderBy: { order: "asc" } }),
      db.approval.findMany({ where: { projectId: project.id, status: "PENDING" }, take: 5 }),
      db.agentArtefact.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 8 }),
      db.risk.findMany({ where: { projectId: project.id, status: "OPEN" }, orderBy: { score: "desc" }, take: 5 }),
      db.agentActivity.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: 5 }),
      // Knowledge base: user-confirmed answers + artefact knowledge + workspace items
      // Exclude internal session metadata; prioritise HIGH_TRUST (user answers)
      db.knowledgeBaseItem.findMany({
        where: {
          OR: [{ agentId }, { projectId: project.id }, { layer: "WORKSPACE", orgId: caller.orgId }],
          NOT: { title: { startsWith: "__" } }, // exclude internal session metadata
        },
        orderBy: [{ trustLevel: "desc" }, { createdAt: "desc" }],
        take: 25,
        select: { title: true, content: true, type: true, trustLevel: true, tags: true, createdAt: true },
      }),
    ]);
  } else {
    // No project — still load workspace-level knowledge
    knowledgeItems = await db.knowledgeBaseItem.findMany({
      where: { layer: "WORKSPACE", orgId: caller.orgId },
      orderBy: [{ trustLevel: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: { title: true, content: true, type: true, trustLevel: true, tags: true, createdAt: true },
    });
  }

  const currentPhase = phases.find(p => p.status === "ACTIVE") ?? phases[0];
  const completedPhases = phases.filter(p => p.status === "COMPLETED");
  const nextPhase = phases.find(p => p.status === "PENDING");

  const toneDesc = formalLevel < 30
    ? "formal, structured, precise — like a senior PM consultant"
    : formalLevel < 70
    ? "professional yet approachable — clear and direct"
    : "friendly and conversational — like a trusted colleague";

  const detailDesc = conciseness < 40
    ? "concise, bullet-point focused"
    : conciseness < 70
    ? "balanced — structured headings with key details"
    : "thorough and detailed — comprehensive coverage";

  const autonomyDesc = [
    "Advisor — everything goes to approval queue, no autonomous actions",
    "Co-pilot — handle routine tasks and risks autonomously, documents and schedule need approval",
    "Autonomous — run the project day-to-day including documents, HITL only for scope and high-risk items",
    "Strategic — full autonomy within governance bounds, minimal check-ins",
  ][Math.min((agent.autonomyLevel ?? 2) - 1, 3)];

  const hitlConfig = (deployment as any)?.config ?? {};
  const budgetThreshold = hitlConfig.hitleBudgetThreshold || hitlConfig.budgetThreshold || "500";
  const riskThreshold = hitlConfig.hitleRiskThreshold || "high";
  const phaseGatesHITL = hitlConfig.hitlePhaseGates !== false;

  const domainTags = (agent.domainTags as string[] || []).filter(Boolean);
  const greeting = (agent as any).greeting || "";
  const teamMembers = await db.projectMember.findMany({
    where: { projectId: project?.id },
    include: { user: { select: { name: true, email: true } } },
  }).catch(() => []);

  const systemPrompt = `You are Agent ${agent.name}, an AI Project Manager deployed through Projectoolbox.
${agent.title ? `Your role: ${agent.title}.` : ""}
${domainTags.length > 0 ? `Your domain specialisations: ${domainTags.join(", ")}. Apply this expertise to all your recommendations, risk assessments, and artefact content.` : ""}

## YOUR IDENTITY & BEHAVIOUR
- You are a proactive, expert PM agent — not a passive chatbot
- You DRIVE the project forward: you propose actions, create documents, identify risks, and manage stakeholders
- At each phase you know exactly what needs to be done and you do it without waiting to be asked
- You always use British English (colour, organisation, prioritise, etc.)
- Communication tone: ${toneDesc}
- Response style: ${detailDesc}
- Autonomy level: L${agent.autonomyLevel ?? 2} — ${autonomyDesc}
${domainTags.length > 0 ? `- Domain expertise: ${domainTags.join(", ")} — use this to provide specialist advice and industry-specific terminology` : ""}
${teamMembers.length > 0 ? `- Team members: ${teamMembers.map((m: any) => `${m.user?.name || "Member"} (${m.role || "Team"})`).join(", ")}` : ""}

## PROJECT CONTEXT
${project ? `
- **Name:** ${project.name}
- **Category:** ${(project as any).category || "general"}
- **Methodology:** ${project.methodology}
- **Status:** ${project.status}
- **Budget:** £${((project.budget || 0)).toLocaleString()}
- **Timeline:** ${project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : "TBD"} → ${project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : "TBD"}
- **Description:** ${project.description || "No description provided"}
` : "No project assigned yet."}

## LIFECYCLE STATE
${phases.length > 0 ? `
**Current Phase:** ${currentPhase?.name ?? "Not started"} (${currentPhase?.status ?? "unknown"})
**Completed Phases:** ${completedPhases.map(p => p.name).join(", ") || "None yet"}
**Next Phase:** ${nextPhase?.name ?? "None"}
**All Phases:** ${phases.map(p => `${p.name} [${p.status}]`).join(" → ")}
` : "Lifecycle not yet initialised — phases will be created on first interaction."}

## PENDING APPROVALS (HITL GATES)
${pendingApprovals.length > 0
  ? pendingApprovals.map(a => `- **${a.title}** — ${a.description} [${a.type}]`).join("\n")
  : "No pending approvals."}

## GENERATED ARTEFACTS
${recentArtefacts.length > 0
  ? recentArtefacts.map(a => `- ${a.name} [${a.status}]`).join("\n")
  : "No artefacts generated yet."}

## OPEN RISKS (Top ${openRisks.length})
${openRisks.length > 0
  ? openRisks.map(r => `- **${r.title}** — Score: ${r.score}/25 — ${r.description}`).join("\n")
  : "No risks logged yet."}

## YOUR IMMEDIATE PRIORITY RIGHT NOW
${(() => {
  const draftArts = recentArtefacts.filter(a => a.status === "DRAFT" || a.status === "PENDING_REVIEW");
  const approvedArts = recentArtefacts.filter(a => a.status === "APPROVED");
  const hasPendingGate = pendingApprovals.some(a => a.type === "PHASE_GATE");

  if (recentArtefacts.length === 0 && phases.length > 0) {
    return `🎯 ARTEFACTS NOT YET GENERATED. You are in the ${currentPhase?.name || "first"} phase. Your job is to generate the phase artefacts. If the user hasn't answered your clarification questions yet, ask them ONE question at a time. Once you have enough context, generate the artefacts. Tell the user exactly what you need from them to proceed.`;
  }
  if (draftArts.length > 0) {
    return `🎯 ${draftArts.length} ARTEFACT(S) AWAITING REVIEW: ${draftArts.map(a => a.name).join(", ")}. Direct the user to [Review Artefacts](/agents/${agentId}?tab=artefacts) to approve them. Summarise what each document contains and why it matters. Once all are approved, you can advance to the next phase.`;
  }
  if (hasPendingGate) {
    return `🎯 PHASE GATE AWAITING APPROVAL. The ${currentPhase?.name} phase is complete. Direct the user to [Pending Approvals](/approvals) to approve the phase gate and advance to ${nextPhase?.name || "the next phase"}.`;
  }
  if (approvedArts.length > 0 && !nextPhase) {
    return `🎯 ALL PHASES COMPLETE. All artefacts approved, all phases done. Help the user with any remaining questions, generate reports, or close out the project.`;
  }
  if (openRisks.length > 0) {
    return `🎯 ${openRisks.length} OPEN RISK(S) need attention. Proactively discuss the highest-scored risks and recommend mitigation strategies. Link to [Risk Register](/projects/${project?.id || ""}/risk).`;
  }
  return `🎯 Monitor the project. Check if tasks are progressing, risks are mitigated, and stakeholders are informed. Be proactive — don't wait to be asked.`;
})()}

## GOVERNANCE RULES (HITL)
You must PAUSE and request human approval when:
${phaseGatesHITL ? "- ✅ Moving between phases (phase gate sign-off required)" : "- Phase gates: no approval required"}
- ✅ Any spend or commitment above £${Number(budgetThreshold).toLocaleString()}
- ✅ Risk level escalates above ${riskThreshold === "critical" ? "critical" : "high"}
- ✅ Communicating externally with stakeholders outside the team
When you hit a gate or need user action:
- Say clearly: **"⏸ AWAITING YOUR APPROVAL"**
- List exactly what needs sign-off
- ALWAYS include direct links to the relevant pages where the user can take action:

**Link Reference — use these exact paths in your responses:**
| Action needed | Link to include |
|---|---|
| Review/approve artefacts | [Review Artefacts](/agents/${agentId}?tab=artefacts) |
| Phase gate approval | [Pending Approvals](/approvals) |
| Review risks | [Risk Register](/projects/${project?.id || ""}/risk) |
| View/edit tasks | [Task Board](/projects/${project?.id || ""}/agile) |
| View schedule | [Schedule](/projects/${project?.id || ""}/schedule) |
| View budget/cost | [Cost Management](/projects/${project?.id || ""}/cost) |
| Stakeholder info | [Stakeholders](/projects/${project?.id || ""}/stakeholders) |
| Agent overview | [Agent Dashboard](/agents/${agentId}) |

- NEVER ask the user to approve, review, or manage anything inside the chat — always link to the appropriate page
- When mentioning artefacts, risks, tasks, approvals, or budget — ALWAYS include the relevant link so the user can click through directly

## EVIDENCE-BASED OUTPUT — CRITICAL
- NEVER claim you have done something unless it appears in the GENERATED ARTEFACTS or LIFECYCLE STATE above. If you haven't done it, say you WILL do it or PLAN to do it.
- NEVER fabricate progress, bookings, requests, confirmations, contacts, or vendor names. You are a planner — describe what NEEDS to happen, not what supposedly already happened.
- When producing documents or boards, ALL items start as "Not Started" or "Planned" unless the project description or artefact data explicitly confirms otherwise.
- Use [TBC] for any specific fact not provided in the project context above. An honest [TBC] is better than a plausible-sounding invention.

## PM LIFECYCLE RESPONSIBILITIES
You drive the project through every phase. You know exactly what must be produced at each stage — you do not wait to be asked.

**PHASE 1 — REQUIREMENTS / FEASIBILITY**
Purpose: Establish whether the project is viable and worth initiating.
Artefacts you must produce:
- **Project Brief** — scope, objectives, constraints, assumptions, success criteria
- **Outline Business Case** — why this project, options considered, expected benefits, high-level cost-benefit, go/no-go recommendation (this is lightweight — NOT the full Business Case)
- **Requirements Specification** — all requirements with acceptance criteria
- **Feasibility Study** — technical, financial, operational, schedule feasibility; conclusion on viability
- **Initial Risk Register** — top risks identified with probability, impact, and initial mitigation
- **Initial Stakeholder Register** — key stakeholders identified with role and initial interest/influence assessment
Gate: Outline Business Case approved → project authorised to proceed

**PHASE 2 — DESIGN / INITIATION & PLANNING**
Purpose: Formally authorise the project AND produce every management plan needed to govern execution.
Artefacts you must produce:
- **Project Charter** — formal project authorisation document signed by sponsor
- **Business Case** — full cost-benefit analysis, NPV/ROI, options comparison, financial justification
- **Stakeholder Register** — complete analysis with power/interest grid and engagement strategy per stakeholder
- **Communication Plan** — who receives what, when, via which channel, escalation path
- **Design Document** — detailed solution/approach design with specifications
- **Work Breakdown Structure** — full decomposition of all deliverables into work packages with ownership
- **Schedule with Dependencies** — activity list, durations, dependencies, critical path, milestone dates, float
- **Cost Management Plan** — budget baseline by work package, cost control thresholds, variance reporting, EVM approach, forecasting method
- **Resource Management Plan** — roles, responsibilities, resource allocation, RACI matrix, procurement needs
- **Risk Management Plan** — risk appetite statement, response strategies, risk owner assignments, escalation thresholds, review cadence
- **Quality Management Plan** — quality standards, review gates, acceptance criteria, defect management process
- **Change Control Plan** — change request process, authority levels, impact assessment approach, change log governance
Gate: Charter signed, Business Case approved, Schedule and Cost baseline approved, all management plans accepted

**PHASE 3 — BUILD / EXECUTION**
Purpose: Deliver the project against the approved baseline.
Artefacts you produce on a running basis:
- Weekly Status Reports, Risk Reviews, Change Requests, Exception Reports, Issue Log updates
Gate: All deliverables complete, acceptance criteria met, quality reviews passed

**PHASE 4 — CLOSING**
Purpose: Formally close the project and capture learning.
Artefacts you must produce:
- **Acceptance Certificate** — formal sign-off that deliverables meet acceptance criteria
- **End Project Report** — performance against baseline (time, cost, quality, scope)
- **Lessons Learned** — what went well, what to improve, recommendations for future projects
- **Closure Report** — formal project closure, resource release, benefit realisation handover
Gate: Sponsor sign-off, all artefacts archived

## KEY PM PRINCIPLES YOU ALWAYS APPLY
- The Outline Business Case (Phase 1) is a go/no-go document only — never inflate it into a full Business Case
- The full Business Case (Phase 2) is produced AFTER feasibility is confirmed — it requires detailed analysis
- You never proceed to the next phase without HITL approval at the gate
- The Schedule must always include dependencies and identify the critical path — a list of dates is not a schedule
- The Cost Management Plan must state HOW costs will be controlled, not just what they are — include thresholds, variance triggers, and EVM method
- Every management plan must be specific to THIS project — no generic templates

## PROACTIVE BEHAVIOUR RULES
- On first contact for a new project: immediately introduce yourself, state the current phase, and present your initial findings or first set of artefacts
- Always tell the user WHAT you've done, WHAT you found, and WHAT you recommend next
- If you've generated artefacts, reference them by name, summarise key points, and include: [Review Artefacts](/agents/${agentId}?tab=artefacts)
- If risks exist, mention the top 2-3 with mitigations and link: [View Risk Register](/projects/${project?.id || ""}/risk)
- If approvals are pending, link directly: [Pending Approvals](/approvals)
- After presenting artefacts, direct the user to review on the Artefacts tab — do NOT ask for approval inside the chat
- When discussing tasks/schedule, link: [Schedule](/projects/${project?.id || ""}/schedule) or [Task Board](/projects/${project?.id || ""}/agile)
- EVERY actionable item you mention must have a clickable link to the page where the user can act on it
- Format documents clearly with ## headings, bullet points, and tables where appropriate
- Be specific — use the actual project name, budget figures, dates, and locations in all documents

## INTERACTIVE QUESTIONS
When you need information from the user, ask exactly ONE question per response using this XML format:

<ASK type="text" id="field_name">Your question here?</ASK>
<ASK type="choice" options="Option A|Option B|Option C" id="field_name">Which of these?</ASK>
<ASK type="yesno" id="field_name">Is this correct?</ASK>
<ASK type="number" id="field_name">How many / how much?</ASK>
<ASK type="date" id="field_name">When is / what date?</ASK>

STRICT RULES:
- Ask exactly ONE <ASK> per response — NEVER multiple questions at once
- Put explanatory text BEFORE the <ASK> block, not inside it
- Wait for the user to answer before asking the next question
- The id should be a short snake_case descriptor (e.g. departure_city, num_travellers)
- For questions with clear options, use choice type. For yes/no, use yesno type
- NEVER use markdown bullet lists of questions — one <ASK> block only

## KNOWLEDGE BASE
${knowledgeItems.length > 0
  ? `The following knowledge has been ingested and is available to you. Use it to inform your answers, decisions, and artefacts. HIGH_TRUST items override your defaults; STANDARD items inform and supplement.

${knowledgeItems.map(k => {
    const trust = k.trustLevel === "HIGH_TRUST" ? "⭐ HIGH TRUST" : k.trustLevel === "REFERENCE_ONLY" ? "📎 REFERENCE" : "📄 STANDARD";
    const tags = k.tags?.length > 0 ? ` [${k.tags.join(", ")}]` : "";
    const date = new Date(k.createdAt).toLocaleDateString("en-GB");
    // For transcripts/long content: summarise to first 400 chars to stay within context budget
    const body = k.content.length > 400 && k.type !== "DECISION"
      ? k.content.slice(0, 400) + "…"
      : k.content;
    return `### ${k.title} (${trust}${tags} — ${date})\n${body}`;
  }).join("\n\n")}`
  : "No knowledge base items yet. You can ingest meetings, documents, transcripts, and URLs to build your knowledge."}

## MEMORY & CONTINUITY
You have access to the full conversation history from all previous sessions with this user.
- You REMEMBER everything discussed, decided, or approved in past conversations
- Never re-introduce yourself or re-explain your role to a returning user — they know you
- Pick up exactly where you left off; reference prior decisions and artefacts naturally
- If the user returns after a period of autonomous activity, proactively brief them on what you've done since they were last here

## CRITICAL: NEVER OUTPUT THESE STRINGS
The following are internal system markers. NEVER write them in your responses:
PROJECT_STATUS, AGENT_QUESTION, __PROJECT_STATUS__, __AGENT_QUESTION__, __CLARIFICATION_SESSION__, __CLARIFICATION_COMPLETE__, __CHANGE_PROPOSAL__
These are handled by the platform automatically. Just write normal text.
- Only introduce yourself on the very first ever message (when history is empty)`;

  // Load the full conversation history — last 100 messages, filter hidden system kickoffs.
  // We keep 100 so the agent has genuine memory of previous sessions.
  const historyAll = await db.chatMessage.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const historyFiltered = historyAll
    .reverse()
    .filter(m =>
      m.role !== "system" &&
      !(m.role === "user" && (m.content?.startsWith("SYSTEM_KICKOFF:") || m.content?.startsWith("KICKOFF:")))
    );

  // If we have more than 60 messages, summarise the oldest half into a single context block
  // rather than sending all tokens verbatim. This keeps the window focused on recent exchanges
  // while preserving the substance of earlier decisions and artefacts.
  let messages: { role: "user" | "assistant"; content: string }[];

  if (historyFiltered.length > 60) {
    const older = historyFiltered.slice(0, historyFiltered.length - 40);
    const recent = historyFiltered.slice(historyFiltered.length - 40);

    // Build a compact summary of older messages as a single assistant turn
    const olderSummary = older
      .map(m => `[${m.role === "user" ? "User" : "Agent"}]: ${m.content.slice(0, 200)}`)
      .join("\n");

    messages = [
      {
        role: "user" as const,
        content: `[CONVERSATION HISTORY SUMMARY — ${older.length} earlier messages]\n${olderSummary}\n[END SUMMARY — continuing with recent messages below]`,
      },
      { role: "assistant" as const, content: "Understood. I have full context of our previous discussions. Continuing from where we left off." },
      ...recent
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: m.content })),
    ];
  } else {
    messages = historyFiltered.map(m => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.content,
    }));
  }

  // Inject greeting context for first-ever interaction
  const isFirstContact = historyFiltered.length === 0;
  if (isFirstContact && greeting) {
    // Prepend a system-level context so the agent knows its custom greeting
    messages.unshift({
      role: "user" as const,
      content: `[SYSTEM: This is our first interaction. Your custom greeting is: "${greeting}". Use this as inspiration for your opening, but be natural — don't just repeat it verbatim. Introduce yourself, explain what you can do for the project, and be proactive.]`,
    });
    messages.push({ role: "assistant" as const, content: "Understood — I'll greet them naturally with this context." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "No AI API key configured" }, { status: 500 });
  }

  // ── Tool definitions available to the agent ──────────────────────────────
  const agentTools = [
    {
      name: "schedule_meeting",
      description:
        "Schedule a Zoom or Google Meet meeting, send invites to attendees, and automatically join to record and transcribe. Use when the user asks to book, schedule, or set up a meeting.",
      input_schema: {
        type: "object" as const,
        properties: {
          platform: {
            type: "string",
            enum: ["zoom", "meet"],
            description: "The meeting platform to use: 'zoom' for Zoom or 'meet' for Google Meet.",
          },
          title: {
            type: "string",
            description: "The title or subject of the meeting.",
          },
          scheduledAt: {
            type: "string",
            description: "ISO 8601 datetime string for when the meeting should start (e.g. '2026-04-10T14:00:00Z'). Omit to start immediately.",
          },
          durationMins: {
            type: "number",
            description: "Duration of the meeting in minutes. Defaults to 60.",
          },
          invitees: {
            type: "array",
            items: { type: "string" },
            description: "Array of email addresses of attendees to invite.",
          },
          agenda: {
            type: "string",
            description: "Optional agenda or description for the meeting.",
          },
        },
        required: ["platform", "title"],
      },
    },
    {
      name: "create_task",
      description: "Create a new task in the project. Use when the user asks to add a task, action item, or work item.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Task title" },
          description: { type: "string", description: "Task description" },
          priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"], description: "Task priority" },
          storyPoints: { type: "number", description: "Story points estimate (1-13)" },
          assigneeName: { type: "string", description: "Name of the person to assign to" },
        },
        required: ["title"],
      },
    },
    {
      name: "update_risk",
      description: "Create or update a risk in the project risk register. Use when the user mentions a risk, concern, or issue.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Risk title" },
          description: { type: "string", description: "Risk description" },
          probability: { type: "number", description: "Probability 1-5" },
          impact: { type: "number", description: "Impact 1-5" },
          category: { type: "string", description: "Risk category" },
          mitigation: { type: "string", description: "Mitigation strategy" },
        },
        required: ["title"],
      },
    },
    {
      name: "search_knowledge",
      description: "Search the project knowledge base for information. Use when you need to look up facts, decisions, or context from meetings, documents, or previous conversations.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
    {
      name: "generate_report",
      description: "Generate a project status report. Use when the user asks for a report, update, or summary.",
      input_schema: {
        type: "object" as const,
        properties: {
          type: { type: "string", enum: ["status", "risk", "budget", "stakeholder"], description: "Report type" },
        },
        required: ["type"],
      },
    },
  ];

  /**
   * Execute the schedule_meeting tool by calling the meetings/create service layer directly.
   * Avoids an internal HTTP round-trip by importing and running the same logic inline.
   */
  async function executeScheduleMeeting(
    toolInput: Record<string, any>,
    execAgentId: string,
    execOrgId: string,
  ): Promise<Record<string, any>> {
    const {
      platform = "zoom",
      title = "Team Meeting",
      scheduledAt,
      durationMins = 60,
      invitees = [] as string[],
      agenda = "",
    } = toolInput;

    const startTime = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 2 * 60 * 1000);

    // ── Create the meeting on the provider ─────────────────────────────────
    let joinUrl: string;

    if (platform === "zoom") {
      const { createZoomMeeting, isZoomConnected } = await import("@/lib/zoom");
      const connected = await isZoomConnected(execOrgId);
      if (!connected) {
        const { getZoomAuthUrl } = await import("@/lib/zoom");
        return {
          error: "Zoom not connected",
          code: "ZOOM_NOT_CONNECTED",
          authUrl: getZoomAuthUrl(execOrgId),
        };
      }
      const zoom = await createZoomMeeting(execOrgId, {
        topic: title,
        startTime: startTime.toISOString(),
        duration: durationMins,
        agenda,
        invitees: invitees.map((e: string) => ({ email: e })),
      });
      if (!zoom) return { error: "Zoom meeting creation failed" };
      joinUrl = zoom.joinUrl;
    } else if (platform === "meet") {
      const { createGoogleMeet, isGoogleCalendarConnected } = await import("@/lib/google-calendar");
      const connected = await isGoogleCalendarConnected(execOrgId);
      if (!connected) {
        return {
          error: "Google Calendar not connected",
          code: "GOOGLE_NOT_CONNECTED",
          authUrl: `/api/integrations/google-calendar/connect?orgId=${execOrgId}`,
        };
      }
      const meet = await createGoogleMeet(execOrgId, {
        summary: title,
        startTime: startTime.toISOString(),
        endTime: new Date(startTime.getTime() + durationMins * 60000).toISOString(),
        attendees: invitees.map((e: string) => ({ email: e })),
        description: agenda,
      });
      if (!meet) return { error: "Google Meet creation failed" };
      joinUrl = meet.joinUrl;
    } else {
      return { error: "Invalid platform. Use 'zoom' or 'meet'" };
    }

    // ── Save CalendarEvent + Meeting records ────────────────────────────────
    const execDeployment = await db.agentDeployment.findFirst({
      where: { agentId: execAgentId, isActive: true },
      select: { projectId: true },
    });

    const execAgent = await db.agent.findUnique({
      where: { id: execAgentId },
      select: { name: true },
    });

    const calEvent = await db.calendarEvent.create({
      data: {
        orgId: execOrgId,
        agentId: execAgentId,
        projectId: execDeployment?.projectId || null,
        title,
        startTime,
        endTime: new Date(startTime.getTime() + durationMins * 60000),
        meetingUrl: joinUrl,
        attendees: invitees.map((email: string) => ({ email })),
        source: "MANUAL",
        description: agenda || null,
      },
    });

    const { detectPlatform } = await import("@/lib/recall-client");

    const meeting = await db.meeting.create({
      data: {
        title,
        orgId: execOrgId,
        agentId: execAgentId,
        projectId: execDeployment?.projectId || null,
        platform: detectPlatform(joinUrl),
        meetingUrl: joinUrl,
        calendarEventId: calEvent.id,
        scheduledAt: startTime,
        status: "SCHEDULED",
        recallBotStatus: "idle",
        botProvider: "recall",
      },
    });

    // ── Send invite emails via agent email ────────────────────────────────
    if (invitees.length > 0) {
      try {
        const agentWithEmail = await db.agent.findUnique({
          where: { id: execAgentId },
          include: { agentEmail: true },
        });
        if (agentWithEmail?.agentEmail?.isActive) {
          const { EmailService } = await import("@/lib/email");
          const platformLabel = platform === "zoom" ? "Zoom" : "Google Meet";
          const platformColor = platform === "zoom" ? "#2D8CFF" : "#1A73E8";
          await EmailService.sendAgentEmail(execAgentId, {
            to: invitees,
            subject: `Meeting Invitation: ${title}`,
            html: `
              <div style="background:linear-gradient(135deg,#6366F1,#8B5CF6);padding:20px 24px;border-radius:12px 12px 0 0">
                <h1 style="color:white;margin:0;font-size:18px">Meeting Invitation</h1>
              </div>
              <div style="padding:24px;background:#fff;border:1px solid #E2E8F0;border-top:0;border-radius:0 0 12px 12px">
                <h2 style="margin:0 0 12px;font-size:16px;color:#0F172A">${title}</h2>
                <table style="font-size:14px;color:#475569">
                  <tr><td style="padding:4px 12px 4px 0;font-weight:600">When:</td>
                      <td>${startTime.toLocaleString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"})}</td></tr>
                  <tr><td style="padding:4px 12px 4px 0;font-weight:600">Duration:</td><td>${durationMins} minutes</td></tr>
                  ${agenda ? `<tr><td style="padding:4px 12px 4px 0;font-weight:600">Agenda:</td><td>${agenda}</td></tr>` : ""}
                </table>
                <a href="${joinUrl}" style="display:inline-block;margin-top:20px;background:${platformColor};color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
                  Join ${platformLabel} Meeting
                </a>
                <p style="margin-top:16px;color:#94A3B8;font-size:12px">Organised by ${execAgent?.name ?? "AI Project Manager"}</p>
              </div>
            `,
          });
        }
      } catch (e) {
        console.error("[schedule_meeting tool] invite email failed:", e);
      }
    }

    // ── Log agent activity ────────────────────────────────────────────────
    await db.agentActivity.create({
      data: {
        agentId: execAgentId,
        type: "meeting",
        summary: `Scheduled ${platform === "zoom" ? "Zoom" : "Google Meet"}: "${title}" · ${invitees.length} invitee(s)`,
        metadata: { meetingId: meeting.id, joinUrl, invitees, platform },
      },
    });

    return {
      success: true,
      meetingId: meeting.id,
      calendarEventId: calEvent.id,
      joinUrl,
      platform,
      title,
      scheduledAt: startTime.toISOString(),
      durationMins,
      invitesSent: invitees.length,
      message: `${title} scheduled successfully. ${invitees.length > 0 ? `Invites sent to ${invitees.length} attendee(s).` : ""} The agent will join automatically to record and transcribe.`,
    };
  }

  // ── Helper: drain a streaming Anthropic response into text + tool calls ──
  async function drainStream(
    streamResponse: Response,
  ): Promise<{ textContent: string; toolUseBlocks: Array<{ id: string; name: string; input: Record<string, any> }>; stopReason: string }> {
    const reader = streamResponse.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let textContent = "";
    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, any> }> = [];
    let stopReason = "end_turn";

    // We accumulate tool_use input as a JSON string built from input_json_delta events
    const pendingToolInputs: Record<number, string> = {};
    const pendingToolMeta: Record<number, { id: string; name: string }> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6);
        if (raw === "[DONE]") continue;
        try {
          const event = JSON.parse(raw);
          if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            const idx: number = event.index;
            pendingToolMeta[idx] = { id: event.content_block.id, name: event.content_block.name };
            pendingToolInputs[idx] = "";
          }
          if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta") {
              textContent += event.delta.text ?? "";
            }
            if (event.delta?.type === "input_json_delta") {
              const idx: number = event.index;
              pendingToolInputs[idx] = (pendingToolInputs[idx] ?? "") + (event.delta.partial_json ?? "");
            }
          }
          if (event.type === "content_block_stop") {
            const idx: number = event.index;
            if (pendingToolMeta[idx]) {
              let parsedInput: Record<string, any> = {};
              try { parsedInput = JSON.parse(pendingToolInputs[idx] || "{}"); } catch {}
              toolUseBlocks.push({ ...pendingToolMeta[idx], input: parsedInput });
              delete pendingToolMeta[idx];
              delete pendingToolInputs[idx];
            }
          }
          if (event.type === "message_delta" && event.delta?.stop_reason) {
            stopReason = event.delta.stop_reason;
          }
        } catch {}
      }
    }
    return { textContent, toolUseBlocks, stopReason };
  }

  // ── First Anthropic call (streaming for text tokens, non-streaming for tool calls) ──
  // We use a two-phase approach:
  //   Phase 1 — stream the response to the client token-by-token (text only)
  //   Phase 2 — if a tool_use stop occurs, execute the tool and make a follow-up call
  //
  // Because we need to inspect stop_reason before deciding whether to do Phase 2,
  // we stream Phase 1 normally and buffer tool-related SSE events. If stop_reason
  // is "tool_use" we execute the tool and send a follow-up non-streaming response.

  const encoder = new TextEncoder();
  let fullContent = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── Phase 1: initial streaming call ───────────────────────────────
        const phase1Response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemPrompt,
            messages,
            tools: agentTools,
            stream: true,
          }),
        });

        if (!phase1Response.ok || !phase1Response.body) {
          const errBody = await phase1Response.text().catch(() => "no body");
          console.error(`[chat/stream] Anthropic API error: ${phase1Response.status} — ${errBody}`);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "LLM stream failed" })}\n\n`));
          controller.close();
          return;
        }

        // Drain the Phase 1 stream, forwarding text tokens to the client as we go
        const p1Reader = phase1Response.body.getReader();
        const p1Decoder = new TextDecoder();
        let p1Buf = "";
        let p1StopReason = "end_turn";
        const p1ToolBlocks: Array<{ id: string; name: string; input: Record<string, any> }> = [];
        const p1PendingInputs: Record<number, string> = {};
        const p1PendingMeta: Record<number, { id: string; name: string }> = {};
        let p1AssistantTextContent = "";

        while (true) {
          const { done, value } = await p1Reader.read();
          if (done) break;
          p1Buf += p1Decoder.decode(value, { stream: true });
          const lines = p1Buf.split("\n");
          p1Buf = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6);
            if (raw === "[DONE]") continue;
            try {
              const event = JSON.parse(raw);

              // Track tool_use content block starts
              if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
                const idx: number = event.index;
                p1PendingMeta[idx] = { id: event.content_block.id, name: event.content_block.name };
                p1PendingInputs[idx] = "";
              }

              // Stream text tokens to client; accumulate tool input JSON
              if (event.type === "content_block_delta") {
                if (event.delta?.type === "text_delta" && event.delta.text) {
                  p1AssistantTextContent += event.delta.text;
                  fullContent += event.delta.text;
                  // Strip sentinel strings from live stream (they're post-processed into cards)
                  const cleanToken = event.delta.text
                    .replace(/\b(PROJECT_STATUS|AGENT_QUESTION|__PROJECT_STATUS__|__AGENT_QUESTION__|__CLARIFICATION_SESSION__|__CLARIFICATION_COMPLETE__|__CHANGE_PROPOSAL__)\b/g, "");
                  if (cleanToken.trim()) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: cleanToken })}\n\n`));
                  }
                }
                if (event.delta?.type === "input_json_delta") {
                  const idx: number = event.index;
                  p1PendingInputs[idx] = (p1PendingInputs[idx] ?? "") + (event.delta.partial_json ?? "");
                }
              }

              // Finalise completed tool_use blocks
              if (event.type === "content_block_stop") {
                const idx: number = event.index;
                if (p1PendingMeta[idx]) {
                  let parsedInput: Record<string, any> = {};
                  try { parsedInput = JSON.parse(p1PendingInputs[idx] || "{}"); } catch {}
                  p1ToolBlocks.push({ ...p1PendingMeta[idx], input: parsedInput });
                  delete p1PendingMeta[idx];
                  delete p1PendingInputs[idx];
                }
              }

              if (event.type === "message_delta" && event.delta?.stop_reason) {
                p1StopReason = event.delta.stop_reason;
              }
            } catch {}
          }
        }

        // ── Phase 2: tool execution + follow-up if needed ─────────────────
        if (p1StopReason === "tool_use" && p1ToolBlocks.length > 0) {
          // Execute each tool call and collect results
          const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

          for (const toolBlock of p1ToolBlocks) {
            if (toolBlock.name === "schedule_meeting") {
              // Notify client that the agent is scheduling
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n*Scheduling meeting…*\n\n" })}\n\n`));
              fullContent += "\n\n*Scheduling meeting…*\n\n";

              let toolResult: Record<string, any>;
              try {
                toolResult = await executeScheduleMeeting(toolBlock.input, agentId, orgId);
              } catch (err: any) {
                toolResult = { error: err.message || "Meeting scheduling failed" };
              }

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolBlock.id,
                content: JSON.stringify(toolResult),
              });
            } else if (toolBlock.name === "create_task") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n*Creating task…*\n\n" })}\n\n`));
              fullContent += "\n\n*Creating task…*\n\n";
              try {
                const depForTask = await db.agentDeployment.findFirst({ where: { agentId, isActive: true }, select: { projectId: true } });
                const task = await db.task.create({
                  data: {
                    projectId: depForTask?.projectId || "",
                    title: toolBlock.input.title,
                    description: toolBlock.input.description || null,
                    priority: toolBlock.input.priority || "MEDIUM",
                    storyPoints: toolBlock.input.storyPoints || null,
                    assigneeName: toolBlock.input.assigneeName || null,
                    status: "TODO",
                    createdBy: `agent:${agentId}`,
                  },
                });
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ success: true, taskId: task.id, title: task.title }) });
              } catch (err: any) {
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ error: err.message }) });
              }

            } else if (toolBlock.name === "update_risk") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n*Updating risk register…*\n\n" })}\n\n`));
              fullContent += "\n\n*Updating risk register…*\n\n";
              try {
                const depForRisk = await db.agentDeployment.findFirst({ where: { agentId, isActive: true }, select: { projectId: true } });
                const prob = Math.max(1, Math.min(5, toolBlock.input.probability || 3));
                const imp = Math.max(1, Math.min(5, toolBlock.input.impact || 3));
                const risk = await db.risk.create({
                  data: {
                    projectId: depForRisk?.projectId || "",
                    title: toolBlock.input.title,
                    description: toolBlock.input.description || null,
                    probability: prob,
                    impact: imp,
                    score: prob * imp,
                    category: toolBlock.input.category || null,
                    status: "OPEN",
                    mitigation: toolBlock.input.mitigation || null,
                  },
                });
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ success: true, riskId: risk.id, title: risk.title, score: risk.score }) });
              } catch (err: any) {
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ error: err.message }) });
              }

            } else if (toolBlock.name === "search_knowledge") {
              try {
                const depForKB = await db.agentDeployment.findFirst({ where: { agentId, isActive: true }, select: { projectId: true } });
                const kbItems = await db.knowledgeBaseItem.findMany({
                  where: {
                    OR: [
                      { agentId },
                      { projectId: depForKB?.projectId },
                    ],
                    content: { contains: toolBlock.input.query, mode: "insensitive" as any },
                  },
                  select: { title: true, content: true, type: true, trustLevel: true },
                  take: 5,
                  orderBy: { updatedAt: "desc" },
                });
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({
                  results: kbItems.map(k => ({ title: k.title, content: k.content.slice(0, 500), type: k.type, trust: k.trustLevel })),
                  count: kbItems.length,
                }) });
              } catch (err: any) {
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ error: err.message }) });
              }

            } else if (toolBlock.name === "generate_report") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n*Generating report…*\n\n" })}\n\n`));
              fullContent += "\n\n*Generating report…*\n\n";
              try {
                const depForReport = await db.agentDeployment.findFirst({ where: { agentId, isActive: true }, select: { projectId: true } });
                const projId = depForReport?.projectId || "";
                const [taskStats, riskStats] = await Promise.all([
                  db.task.groupBy({ by: ["status"], where: { projectId: projId }, _count: true }),
                  db.risk.groupBy({ by: ["status"], where: { projectId: projId }, _count: true }),
                ]);
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({
                  reportType: toolBlock.input.type,
                  projectName: project?.name,
                  tasks: taskStats,
                  risks: riskStats,
                  phase: deployment?.currentPhase,
                  budget: project?.budget,
                  generatedAt: new Date().toISOString(),
                }) });
              } catch (err: any) {
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ error: err.message }) });
              }

            } else {
              // Unknown tool — return error
              toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ error: `Unknown tool: ${toolBlock.name}` }) });
            }
          }

          if (toolResults.length > 0) {
            // Build the messages array for the follow-up call:
            // existing messages + assistant turn (with tool_use blocks) + tool_result turn
            const assistantContentBlocks: any[] = [];
            if (p1AssistantTextContent) {
              assistantContentBlocks.push({ type: "text", text: p1AssistantTextContent });
            }
            for (const tb of p1ToolBlocks) {
              assistantContentBlocks.push({ type: "tool_use", id: tb.id, name: tb.name, input: tb.input });
            }

            const followUpMessages = [
              ...messages,
              { role: "assistant" as const, content: assistantContentBlocks },
              { role: "user" as const, content: toolResults },
            ];

            // Follow-up streaming call to get the final response
            const phase2Response = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY!,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
                max_tokens: 2048,
                system: systemPrompt,
                messages: followUpMessages,
                tools: agentTools,
                stream: true,
              }),
            });

            if (phase2Response.ok && phase2Response.body) {
              const { textContent: p2Text } = await drainStream(phase2Response);
              if (p2Text) {
                fullContent += p2Text;
                // Stream the follow-up tokens to the client
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: p2Text })}\n\n`));
              }
            }
          }
        }

        // ── Post-process: extract <ASK> interactive question blocks ──────
        // Each <ASK> becomes a separate chat message rendered as an interactive card.
        // The main response text has the <ASK> blocks stripped out.
        const askRegex = /<ASK\s+([^>]+)>([\s\S]*?)<\/ASK>/gi;
        const extractedQuestions: Array<{ id: string; type: string; options?: string[]; question: string }> = [];
        let askMatch: RegExpExecArray | null;

        while ((askMatch = askRegex.exec(fullContent)) !== null) {
          const attrs = askMatch[1];
          const questionText = askMatch[2].trim();
          const getAttr = (name: string) => attrs.match(new RegExp(`${name}="([^"]+)"`))?.[1];
          extractedQuestions.push({
            id: getAttr("id") || `aq_${Date.now()}_${extractedQuestions.length}`,
            type: getAttr("type") || "text",
            options: getAttr("options")?.split("|").map(o => o.trim()),
            question: questionText,
          });
        }

        // Clean <ASK> blocks from the persisted text
        const cleanedContent = fullContent
          .replace(/<ASK[\s\S]*?<\/ASK>/gi, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        // ── Persist + finalise ────────────────────────────────────────────
        await db.chatMessage.create({
          data: { agentId, conversationId, role: "agent", content: cleanedContent || fullContent },
        });

        // Save only the FIRST question as an interactive card.
        // If Claude sent multiple despite the "one at a time" rule, queue the
        // rest into a clarification session so they are asked sequentially
        // without burning credits on each answer.
        if (extractedQuestions.length > 0) {
          const firstQ = extractedQuestions[0];
          await db.chatMessage.create({
            data: {
              agentId,
              conversationId,
              role: "agent",
              content: "__AGENT_QUESTION__",
              metadata: {
                type: "agent_question",
                question: { id: firstQ.id, question: firstQ.question, type: firstQ.type, options: firstQ.options },
                questionIndex: 0,
                totalQuestions: extractedQuestions.length,
              } as any,
            },
          }).catch(() => {});

          // Queue remaining questions as a clarification session (zero-credit sequential flow)
          if (extractedQuestions.length > 1 && deployment?.projectId) {
            try {
              const { getActiveSession } = await import("@/lib/agents/clarification-session");
              const existingSession = await getActiveSession(agentId, deployment.projectId);
              if (!existingSession) {
                const sessionQuestions = extractedQuestions.slice(1).map((q, i) => ({
                  id: q.id,
                  artefact: "General",
                  field: q.id,
                  question: q.question,
                  type: (q.type || "text") as any,
                  options: q.options,
                  answered: false,
                }));
                const session = {
                  sessionId: `cs_${Date.now()}`,
                  agentId,
                  projectId: deployment.projectId,
                  artefactNames: [],
                  questions: sessionQuestions,
                  startedAt: new Date().toISOString(),
                  status: "active" as const,
                  currentQuestionIndex: 0,
                };
                await db.knowledgeBaseItem.create({
                  data: {
                    orgId, agentId, projectId: deployment.projectId,
                    layer: "PROJECT", type: "TEXT",
                    title: "__clarification_session__",
                    content: JSON.stringify(session),
                    trustLevel: "STANDARD",
                    tags: ["clarification_session", "active"],
                  },
                }).catch(() => {});
              }
            } catch {}
          }
        }

        // ── Status card: append DB-derived project status for status queries ──
        const isStatusQuery = /\b(what.{0,25}(need|next|do|action|pending|outstanding|status|overview|update)|where (are|am) (we|i)|status update|next step|what.*outstanding|what.*blocking|what.*waiting)\b/i.test(message);
        if (isStatusQuery && deployment?.projectId) {
          try {
            const [pendingArts, artSession] = await Promise.all([
              db.agentArtefact.count({ where: { projectId: deployment.projectId, agentId, status: { in: ["DRAFT", "PENDING_REVIEW"] } } }),
              db.knowledgeBaseItem.findFirst({ where: { agentId, projectId: deployment.projectId, title: "__clarification_session__", tags: { has: "active" } } }),
            ]);
            await db.chatMessage.create({
              data: {
                agentId,
                conversationId,
                role: "agent",
                content: "__PROJECT_STATUS__",
                metadata: {
                  type: "project_status",
                  projectName: project?.name ?? "Project",
                  phase: currentPhase?.name ?? null,
                  phases: phases.map(p => ({ name: p.name, status: p.status })),
                  nextPhase: nextPhase?.name ?? null,
                  pendingApprovals: pendingApprovals.length,
                  pendingArtefacts: pendingArts,
                  pendingQuestions: artSession ? 1 : 0,
                  risks: openRisks.length,
                } as any,
              },
            }).catch(() => {});
          } catch {}
        }

        await db.agentActivity.create({
          data: { agentId, type: "chat", summary: `Chat response: ${message.slice(0, 80)}${message.length > 80 ? "…" : ""}` },
        }).catch(() => {});

        const creditCost = fullContent.length > 2000 ? 8 : fullContent.length > 800 ? 4 : 2;
        await CreditService.deduct(orgId, creditCost, `Agent chat: ${message.slice(0, 40)}`, agentId);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
