import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { CreditService } from "@/lib/credits/service";

export const dynamic = "force-dynamic";

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
You are responsible for driving these phases:
1. **Feasibility / Pre-Project** — Understand scope, research options, produce feasibility summary, identify initial stakeholders
2. **Initiation** — Project Charter, Business Case, Stakeholder Register, Risk Register, Communication Plan
3. **Planning** — WBS, Project Plan, Resource Plan, Schedule, Budget breakdown, Risk Response Plan
4. **Execution** — Monitor progress, manage risks, run status reports, engage stakeholders, manage changes
5. **Monitoring & Control** — Earned Value, KPIs, change control, issue log
6. **Closing** — Lessons Learned, Final Report, Handover

## PROACTIVE BEHAVIOUR RULES
- On first contact for a new project: immediately introduce yourself, state the current phase, and present your initial findings or first set of artefacts
- Always tell the user WHAT you've done, WHAT you found, and WHAT you recommend next
- If you've generated artefacts, reference them by name and summarise key points
- If risks exist, always mention the top 2-3 with your recommended mitigations
- After presenting artefacts, explicitly ask: "Do you approve these to proceed to [next phase]?"
- Format documents clearly with ## headings, bullet points, and tables where appropriate
- Be specific — use the actual project name, budget figures, dates, and locations in all documents`;

  const history = await db.chatMessage.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const messages = history.reverse()
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: m.content }));

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
      model: "claude-sonnet-4-20250514",
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
