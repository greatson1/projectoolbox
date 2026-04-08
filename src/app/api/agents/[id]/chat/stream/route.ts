import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { CreditService } from "@/lib/credits/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/agents/[id]/chat/stream — Streaming chat via SSE
 * Returns tokens as they arrive from Anthropic's streaming API.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;
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

  if (project?.id) {
    [phases, pendingApprovals, recentArtefacts, openRisks, recentActivity] = await Promise.all([
      db.phase.findMany({ where: { projectId: project.id }, orderBy: { order: "asc" } }),
      db.approval.findMany({ where: { projectId: project.id, status: "PENDING" }, take: 5 }),
      db.agentArtefact.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 8 }),
      db.risk.findMany({ where: { projectId: project.id, status: "OPEN" }, orderBy: { score: "desc" }, take: 5 }),
      db.agentActivity.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);
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
    "Assistant — suggest only, no autonomous actions",
    "Advisor — draft everything, flag all for approval",
    "Co-pilot — handle routine autonomously, escalate key decisions above thresholds",
    "Autonomous — run the project, report weekly, HITL only for gates and budget",
    "Strategic — full autonomy within governance bounds, minimal check-ins",
  ][Math.min((agent.autonomyLevel ?? 3) - 1, 4)];

  const hitlConfig = (deployment as any)?.config ?? {};
  const budgetThreshold = hitlConfig.hitleBudgetThreshold || hitlConfig.budgetThreshold || "500";
  const riskThreshold = hitlConfig.hitleRiskThreshold || "high";
  const phaseGatesHITL = hitlConfig.hitlePhaseGates !== false;

  const systemPrompt = `You are Agent ${agent.name}, an AI Project Manager deployed through Projectoolbox.
${agent.title ? `Your role: ${agent.title}.` : ""}

## YOUR IDENTITY & BEHAVIOUR
- You are a proactive, expert PM agent — not a passive chatbot
- You DRIVE the project forward: you propose actions, create documents, identify risks, and manage stakeholders
- At each phase you know exactly what needs to be done and you do it without waiting to be asked
- You always use British English (colour, organisation, prioritise, etc.)
- Communication tone: ${toneDesc}
- Response style: ${detailDesc}
- Autonomy level: L${agent.autonomyLevel ?? 3} — ${autonomyDesc}

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

## GOVERNANCE RULES (HITL)
You must PAUSE and request human approval when:
${phaseGatesHITL ? "- ✅ Moving between phases (phase gate sign-off required)" : "- Phase gates: no approval required"}
- ✅ Any spend or commitment above £${Number(budgetThreshold).toLocaleString()}
- ✅ Risk level escalates above ${riskThreshold === "critical" ? "critical" : "high"}
- ✅ Communicating externally with stakeholders outside the team
When you hit a gate, say clearly: **"⏸ AWAITING YOUR APPROVAL"** and list exactly what needs sign-off.

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
- If you've generated artefacts, reference them by name and summarise key points
- If risks exist, always mention the top 2-3 with your recommended mitigations
- After presenting artefacts, explicitly ask: "Do you approve these to proceed to [next phase]?"
- Format documents clearly with ## headings, bullet points, and tables where appropriate
- Be specific — use the actual project name, budget figures, dates, and locations in all documents

## MEMORY & CONTINUITY
You have access to the full conversation history from all previous sessions with this user.
- You REMEMBER everything discussed, decided, or approved in past conversations
- Never re-introduce yourself or re-explain your role to a returning user — they know you
- Pick up exactly where you left off; reference prior decisions and artefacts naturally
- If the user returns after a period of autonomous activity, proactively brief them on what you've done since they were last here
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "No AI API key configured" }, { status: 500 });
  }

  // Stream from Anthropic with full token budget for comprehensive PM responses
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    return NextResponse.json({ error: "LLM stream failed" }, { status: 502 });
  }

  // Transform Anthropic SSE stream into our own SSE format
  let fullContent = "";
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);
              if (event.type === "content_block_delta" && event.delta?.text) {
                fullContent += event.delta.text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: event.delta.text })}\n\n`));
              }
            } catch {}
          }
        }

        // Save complete response
        await db.chatMessage.create({
          data: { agentId, conversationId, role: "agent", content: fullContent },
        });

        // Log activity
        await db.agentActivity.create({
          data: { agentId, type: "chat", summary: `Chat response: ${message.slice(0, 80)}${message.length > 80 ? "…" : ""}` },
        }).catch(() => {});

        // Deduct credits — scale by response complexity
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
