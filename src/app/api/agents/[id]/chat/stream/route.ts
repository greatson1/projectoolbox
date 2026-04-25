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
  const savedUserMsg = await db.chatMessage.create({
    data: { agentId, conversationId, role: "user", content: message },
    select: { id: true },
  });

  // ── Sentiment extraction (non-blocking, cheap Haiku) ──
  if (message.length > 10) {
    (async () => {
      const a = await db.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
      if (!a) return;
      const { recordSentiment } = await import("@/lib/sentiment/recorder");
      await recordSentiment({
        orgId: a.orgId,
        text: message,
        subjectType: "chat",
        subjectId: savedUserMsg.id,
        context: "user chat message to agent",
      });
    })().catch(() => {});
  }

  // ── Clarification session guard ───────────────────────────────────────────────
  // If an active clarification session exists, messages in the chat stream are
  // treated as free typed answers — route through the answer endpoint instead of
  // burning AI credits here.  The dedicated widget in the UI already calls
  // /clarification/answer directly; this is a fallback for users who type manually.
  let isClarificationAnswer = false;
  try {
    const deployment0 = await db.agentDeployment.findFirst({
      where: { agentId, isActive: true },
      select: { id: true, projectId: true, phaseStatus: true },
    });

    // ── Self-heal: detect stuck phaseStatus ──
    // If phaseStatus is "awaiting_clarification" but there is NO active
    // clarification session AND the user has already accumulated HIGH_TRUST
    // facts in KB (meaning they answered the questions), unlock the state.
    // This fixes agents that got stuck due to a failed completion handler.
    if (deployment0?.projectId && deployment0.phaseStatus === "awaiting_clarification") {
      const { getActiveSession } = await import("@/lib/agents/clarification-session");
      const activeCheck = await getActiveSession(agentId, deployment0.projectId);
      if (!activeCheck) {
        const factCount = await db.knowledgeBaseItem.count({
          where: {
            agentId,
            projectId: deployment0.projectId,
            trustLevel: "HIGH_TRUST",
            tags: { has: "user_confirmed" },
          },
        }).catch(() => 0);
        if (factCount > 0) {
          await db.agentDeployment.update({
            where: { id: deployment0.id },
            data: { phaseStatus: "active" },
          }).catch(() => {});
          await db.agentActivity.create({
            data: {
              agentId,
              type: "system",
              summary: `Self-heal: deployment was stuck in "awaiting_clarification" but ${factCount} confirmed facts exist. Unlocked to "active".`,
            },
          }).catch(() => {});
        }
      }
    }

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

  // ── Approval-to-generate guard ──────────────────────────────────────────────
  // When the agent has presented assumptions and is awaiting user approval
  // (phaseStatus = "awaiting_clarification" but NO active clarification session),
  // detect approval phrases and trigger artefact generation.
  if (!isClarificationAnswer) {
    try {
      const dep0 = await db.agentDeployment.findFirst({
        where: { agentId, isActive: true },
        select: { id: true, projectId: true, currentPhase: true, phaseStatus: true },
      });
      if (dep0?.projectId && dep0.phaseStatus === "awaiting_clarification") {
        const { getActiveSession } = await import("@/lib/agents/clarification-session");
        const activeSession = await getActiveSession(agentId, dep0.projectId);
        // No active Q&A session → agent is waiting for user to approve generation
        if (!activeSession) {
          const msgLower = message.toLowerCase().trim();
          // Strict approval phrases — require explicit intent to generate
          const exactApprovals = ["go ahead", "generate", "yes", "approve", "do it", "ok", "okay", "sure", "confirmed", "let's go", "go for it"];
          const phraseApprovals = ["start generating", "create the documents", "create the artefacts", "generate the documents", "generate the artefacts", "proceed with generation", "go ahead and generate"];
          // Match: either the entire message is an exact approval, or it contains a multi-word phrase approval
          const isExactMatch = exactApprovals.includes(msgLower.replace(/[.!,\s]+$/, ""));
          const isPhraseMatch = phraseApprovals.some(p => msgLower.includes(p));
          const isApproval = isExactMatch || isPhraseMatch;
          if (isApproval) {
            // Trigger generation in background
            (async () => {
              try {
                await db.agentDeployment.update({
                  where: { id: dep0.id },
                  data: { phaseStatus: "active", nextCycleAt: new Date(Date.now() + 10 * 60_000) },
                });
                const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
                await generatePhaseArtefacts(agentId, dep0.projectId, dep0.currentPhase ?? undefined);
                await db.chatMessage.create({
                  data: {
                    agentId,
                    role: "agent",
                    content: `Your documents have been generated! Head to the **Artefacts** tab to review them. Any fields marked [TBC] can be updated there once you have the details.\n\n[Review Artefacts](/agents/${agentId}?tab=artefacts)`,
                  },
                }).catch(() => {});
              } catch (e) {
                console.error("[chat/stream] approval-triggered generation failed:", e);
              }
            })();

            // Stream an immediate acknowledgement and return early — do NOT also
            // call Claude. Otherwise we get two agent bubbles (one from Claude,
            // one from the background "documents generated" message).
            const ackContent = `Generating the Requirements phase artefacts now — using your ${(await db.knowledgeBaseItem.count({ where: { agentId, projectId: dep0.projectId, trustLevel: "HIGH_TRUST" } }).catch(() => 0))} confirmed facts. I'll post an update in the chat when they're ready, or check the **Artefacts** tab shortly.`;
            await db.chatMessage.create({
              data: { agentId, role: "agent", content: ackContent },
            }).catch(() => {});
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                // Stream the ack as tokens so the UI renders it like a normal response
                for (const chunk of ackContent.match(/.{1,40}/g) || [ackContent]) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: chunk })}\n\n`));
                }
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                controller.close();
              },
            });
            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
              },
            });
          }
        }
      }
    } catch {}
  }

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
  let tasks: any[] = [];
  let costEntries: any[] = [];
  let issues: any[] = [];
  let stakeholders: any[] = [];
  let latestMetrics: any = null;

  if (project?.id) {
    [phases, pendingApprovals, recentArtefacts, openRisks, recentActivity, knowledgeItems,
     tasks, costEntries, issues, stakeholders, latestMetrics] = await Promise.all([
      db.phase.findMany({ where: { projectId: project.id }, orderBy: { order: "asc" } }),
      db.approval.findMany({ where: { projectId: project.id, status: "PENDING" }, take: 5 }),
      // Artefacts — include content so the agent knows what was actually decided/written
      db.agentArtefact.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, name: true, status: true, content: true, phaseId: true, createdAt: true, updatedAt: true },
      }),
      db.risk.findMany({ where: { projectId: project.id }, orderBy: { score: "desc" }, take: 15, select: { title: true, description: true, probability: true, impact: true, score: true, status: true, category: true, owner: true, mitigation: true, responseLog: true } }),
      db.agentActivity.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: 10 }),
      // Knowledge base: exclude CHAT items (already in conversation history) and internal metadata
      db.knowledgeBaseItem.findMany({
        where: {
          OR: [{ agentId }, { projectId: project.id }, { layer: "WORKSPACE", orgId: caller.orgId }],
          NOT: [
            { title: { startsWith: "__" } },
            { type: "CHAT" },
          ],
        },
        orderBy: [{ trustLevel: "desc" }, { createdAt: "desc" }],
        take: 40,
        select: { title: true, content: true, type: true, layer: true, trustLevel: true, tags: true, createdAt: true },
      }),
      // Tasks — full list for status awareness (capped at 60 to stay lean)
      db.task.findMany({
        where: { projectId: project.id },
        orderBy: [{ status: "asc" }, { endDate: "asc" }],
        take: 60,
        select: { title: true, status: true, priority: true, assigneeName: true, endDate: true, progress: true, isCriticalPath: true, blocked: true, phaseId: true, storyPoints: true },
      }),
      // Cost entries — all estimates and actuals for budget picture
      db.costEntry.findMany({
        where: { projectId: project.id },
        orderBy: { recordedAt: "desc" },
        take: 100,
        select: { entryType: true, category: true, amount: true, description: true, vendorName: true, recordedAt: true },
      }),
      // Open issues
      db.issue.findMany({
        where: { projectId: project.id, status: { not: "CLOSED" } },
        orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
        take: 15,
        select: { title: true, priority: true, status: true, dueDate: true },
      }),
      // Stakeholders
      db.stakeholder.findMany({
        where: { projectId: project.id },
        take: 20,
        select: { name: true, role: true, organisation: true, power: true, interest: true, sentiment: true },
      }),
      // Latest EVM/health metrics snapshot
      db.metricsSnapshot.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
      }),
    ]);
  } else {
    // No project — still load workspace-level knowledge (exclude CHAT noise)
    knowledgeItems = await db.knowledgeBaseItem.findMany({
      where: { layer: "WORKSPACE", orgId: caller.orgId, NOT: { type: "CHAT" } },
      orderBy: [{ trustLevel: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: { title: true, content: true, type: true, layer: true, trustLevel: true, tags: true, createdAt: true },
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
    "Autonomous — full autonomy within governance bounds, HITL only for CRITICAL items and phase gates",
  ][Math.min((agent.autonomyLevel ?? 2) - 1, 2)];

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

  // ── Clarification state: detect if the user has already completed a clarification session ──
  // If so, tell Claude NOT to re-ask those questions — instead, reference the stored answers.
  let clarificationCompleteHint = "";
  try {
    const userConfirmedFactCount = project?.id ? await db.knowledgeBaseItem.count({
      where: {
        agentId,
        projectId: project.id,
        trustLevel: "HIGH_TRUST",
        tags: { has: "user_confirmed" },
      },
    }).catch(() => 0) : 0;
    if (userConfirmedFactCount > 0) {
      clarificationCompleteHint = `\n\n## ⚠️ CLARIFICATION ALREADY COMPLETE\nThe user has already answered clarification questions for this project. ${userConfirmedFactCount} confirmed facts are stored in the Knowledge Base (tagged "user_confirmed", trustLevel HIGH_TRUST). DO NOT re-ask questions the user has already answered. Instead, reference the stored answers and proceed to the next step (artefact generation, follow-up work, etc). If you need additional information beyond what was already gathered, ask a NEW specific question — never repeat the original clarification questions.\n`;
    }
  } catch {}

  const systemPrompt = `You are Agent ${agent.name}, an AI Project Manager deployed through Projectoolbox.
${agent.title ? `Your role: ${agent.title}.` : ""}
${domainTags.length > 0 ? `Your domain specialisations: ${domainTags.join(", ")}. Apply this expertise to all your recommendations, risk assessments, and artefact content.` : ""}

## ⚠️ ZERO FABRICATION — #1 RULE (OVERRIDES EVERYTHING ELSE)
NEVER invent personal names, company names, vendor names, contact details, booking references, venue names, addresses, or ANY specific fact not explicitly provided in the project data below.
- Use ROLE TITLES (e.g. "Project Manager", "Executive Sponsor") instead of names
- Use [TBC — description] for any unknown specific detail
- When critical information is missing, ASK THE USER via a clarification question rather than silently filling gaps
- NEVER claim something is "confirmed", "booked", "in progress", or "done" unless explicitly stated in the project data
- A response with honest [TBC] markers is better than one with invented details

## EVIDENCE-BASED DECISION MAKING (CRITICAL)
You must ALWAYS have evidence or basis for every action, recommendation, or content you generate:

1. **CITE YOUR SOURCES** — when making a claim, reference WHERE the information came from:
   - "Based on the Budget Breakdown artefact..." / "According to your answer about..."
   - "The Risk Register shows..." / "From the meeting notes on [date]..."
   - "Industry standard for [category] projects suggests..."

2. **DECLARE ASSUMPTIONS** — when you don't have confirmed data but need to proceed:
   - Clearly state: "**ASSUMPTION:** [what you assumed] — based on [reasoning]"
   - List all assumptions at the end of any generated artefact
   - Mark assumed content with [ASSUMPTION] tags in documents

3. **ASK BEFORE ASSUMING** — for critical decisions (budget, dates, scope):
   - Ask the user directly rather than assuming
   - "I need to know X before I can proceed. What is the [specific detail]?"
   - Never silently fill in budget figures, dates, or names

4. **FLAG UNCERTAINTY** — be transparent about confidence:
   - HIGH confidence: backed by user-confirmed KB facts or approved artefacts
   - MEDIUM confidence: inferred from project context or industry standards
   - LOW confidence: assumed with no direct evidence — MUST be flagged

5. **NO FABRICATION** — these are absolute rules:
   - NEVER invent personal names (use role titles: "Project Manager", "Team Lead")
   - NEVER fabricate specific costs, dates, or statistics without basis
   - NEVER claim something is booked, confirmed, or done unless the data says so
   - If you don't know, say "I don't have this information — [TBC]"

## YOUR IDENTITY & BEHAVIOUR
- You are a proactive, expert PM agent AND a knowledgeable domain consultant — not a passive chatbot
- You DRIVE the project forward: you propose actions, create documents, identify risks, and manage stakeholders
- At each phase you know exactly what needs to be done and you do it without waiting to be asked
- You always use British English (colour, organisation, prioritise, etc.)
- Communication tone: ${toneDesc}
- Response style: ${detailDesc}
- Autonomy level: L${agent.autonomyLevel ?? 2} — ${autonomyDesc}
${domainTags.length > 0 ? `- Domain expertise: ${domainTags.join(", ")} — use this to provide specialist advice and industry-specific terminology` : ""}
${teamMembers.length > 0 ? `- Team members: ${teamMembers.map((m: any) => `${m.user?.name || "Member"} (${m.role || "Team"})`).join(", ")}` : ""}

## DOMAIN EXPERTISE — ACT AS A SPECIALIST CONSULTANT
You are not just a project manager — you are a knowledgeable expert in the field this project operates in. ${project ? `This project ("${project.name}") is in the "${(project as any).category || "general"}" domain.` : ""}
${domainTags.length > 0 ? `Your specialisations are: ${domainTags.join(", ")}.` : ""}

You must:
- **Proactively share domain knowledge**: if the user is planning a training programme, advise on learning methodologies, assessment approaches, accreditation requirements. If it's an IT project, advise on architecture, security, deployment strategies. If it's an event, advise on venue logistics, catering ratios, health & safety.
- **Anticipate domain-specific risks**: don't just flag generic PM risks — flag risks specific to this domain (e.g. for training: low participant engagement, certification body delays; for travel: visa processing times, health requirements)
- **Reference industry standards**: cite relevant frameworks, regulations, and best practices for this domain
- **Use your Knowledge Base research**: your KB contains feasibility research from Perplexity AI about this specific project type. Use those facts to give informed, evidence-based advice — not generic PM platitudes.
- **Challenge the user constructively**: if the user's plan has gaps that your domain knowledge reveals (e.g. insufficient budget for the venue size, missing regulatory requirement), flag it proactively
- **Speak the language of the domain**: use terminology appropriate to the field, not just generic PM terms
${clarificationCompleteHint}
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

## CURRENT PHASE COMPLETION STATUS
${await (async () => {
  if (!currentPhase?.name || !deployment?.projectId) return "No active phase.";
  try {
    const { getPhaseCompletion } = await import("@/lib/agents/phase-completion");
    const comp = await getPhaseCompletion(deployment.projectId, currentPhase.name, agentId);
    return `**${comp.phaseName}** — ${comp.overall}% complete ${comp.canAdvance ? "✅ READY TO ADVANCE" : "⛔ NOT READY"}
  Artefacts: ${comp.artefacts.done}/${comp.artefacts.total} approved (${comp.artefacts.pct}%)
  PM Tasks: ${comp.pmTasks.done}/${comp.pmTasks.total} done (${comp.pmTasks.pct}%)
  Delivery Tasks: ${comp.deliveryTasks.done}/${comp.deliveryTasks.total} done (${comp.deliveryTasks.pct}%)
${comp.blockers.length > 0 ? `  **Blockers:** ${comp.blockers.join("; ")}` : "  No blockers — phase gate can proceed."}`;
  } catch { return "Phase completion data unavailable."; }
})()}

## PENDING APPROVALS (HITL GATES)
${pendingApprovals.length > 0
  ? pendingApprovals.map(a => `- **${a.title}** — ${a.description} [${a.type}]`).join("\n")
  : "No pending approvals."}

## GENERATED ARTEFACTS (${recentArtefacts.length} total)
${recentArtefacts.length > 0
  ? recentArtefacts.map(a => {
      const statusIcon = a.status === "APPROVED" ? "✅" : a.status === "PENDING_REVIEW" ? "⏳" : a.status === "REJECTED" ? "❌" : "📝";
      // Approved artefacts: show first 800 chars of content so agent knows what was decided
      // Draft/pending: just name and status — content not yet confirmed
      const preview = a.status === "APPROVED" && a.content
        ? `\n  > ${a.content.slice(0, 800).replace(/\n/g, "\n  > ")}${a.content.length > 800 ? "…" : ""}`
        : "";
      return `${statusIcon} **${a.name}** [${a.status}] — ${new Date(a.updatedAt || a.createdAt).toLocaleDateString("en-GB")}${preview}`;
    }).join("\n\n")
  : "No artefacts generated yet."}

## TASK STATUS SUMMARY
${(() => {
  if (tasks.length === 0) return "No tasks created yet.";
  const byStatus: Record<string, any[]> = {};
  tasks.forEach(t => { (byStatus[t.status] = byStatus[t.status] || []).push(t); });
  const done      = (byStatus["DONE"] || byStatus["COMPLETE"] || []).length;
  const inProg    = (byStatus["IN_PROGRESS"] || []).length;
  const todo      = (byStatus["TODO"] || []).length;
  const blocked   = tasks.filter(t => t.blocked).length;
  const overdue   = tasks.filter(t => t.endDate && new Date(t.endDate) < new Date() && t.status !== "DONE" && t.status !== "COMPLETE");
  const critPath  = tasks.filter(t => t.isCriticalPath && t.status !== "DONE" && t.status !== "COMPLETE");
  const pct       = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;

  let out = `**${tasks.length} tasks total — ${done} done (${pct}%), ${inProg} in progress, ${todo} to do, ${blocked} blocked**\n`;

  if (overdue.length > 0) {
    out += `\n⚠️ **OVERDUE (${overdue.length}):**\n`;
    out += overdue.slice(0, 8).map(t =>
      `- ${t.title} [${t.status}]${t.assigneeName ? ` — ${t.assigneeName}` : ""} (due ${new Date(t.endDate).toLocaleDateString("en-GB")})`
    ).join("\n");
  }
  if (critPath.length > 0) {
    out += `\n\n🔴 **CRITICAL PATH (${critPath.length} incomplete):**\n`;
    out += critPath.slice(0, 6).map(t =>
      `- ${t.title} [${t.status}]${t.assigneeName ? ` — ${t.assigneeName}` : ""}${t.endDate ? ` (due ${new Date(t.endDate).toLocaleDateString("en-GB")})` : ""}`
    ).join("\n");
  }
  if (inProg > 0) {
    out += `\n\n🔵 **IN PROGRESS:**\n`;
    out += (byStatus["IN_PROGRESS"] || []).slice(0, 8).map(t =>
      `- ${t.title}${t.progress > 0 ? ` (${t.progress}%)` : ""}${t.assigneeName ? ` — ${t.assigneeName}` : ""}`
    ).join("\n");
  }
  return out;
})()}

## BUDGET & COST POSITION
${(() => {
  const budget = (project as any)?.budget || 0;
  if (costEntries.length === 0 && !budget) return "No budget or cost data recorded yet.";

  const estimates = costEntries.filter((c: any) => c.entryType === "ESTIMATE");
  const actuals   = costEntries.filter((c: any) => c.entryType === "ACTUAL");
  const forecasts = costEntries.filter((c: any) => c.entryType === "FORECAST");

  const totalEst  = estimates.reduce((s: number, c: any) => s + c.amount, 0);
  const totalAct  = actuals.reduce((s: number, c: any) => s + c.amount, 0);
  const totalFore = forecasts.reduce((s: number, c: any) => s + c.amount, 0);
  const remaining = budget - totalAct;
  const burnPct   = budget > 0 ? Math.round((totalAct / budget) * 100) : 0;

  // Group actuals by category
  const byCat: Record<string, number> = {};
  actuals.forEach((c: any) => { byCat[c.category] = (byCat[c.category] || 0) + c.amount; });

  let out = `**Project Budget: £${budget.toLocaleString()}**\n`;
  out += `- Total Estimated Cost: £${totalEst.toLocaleString()}\n`;
  out += `- Actual Spend to Date: £${totalAct.toLocaleString()} (${burnPct}% of budget)\n`;
  if (totalFore > 0) out += `- Latest Forecast: £${totalFore.toLocaleString()}\n`;
  out += `- Remaining Budget: £${remaining.toLocaleString()}${remaining < 0 ? " ⚠️ OVER BUDGET" : ""}`;

  if (Object.keys(byCat).length > 0) {
    out += `\n\n**Spend by Category:**\n`;
    out += Object.entries(byCat).map(([cat, amt]: [string, number]) => `- ${cat}: £${amt.toLocaleString()}`).join("\n");
  }

  if (latestMetrics?.cpi) {
    out += `\n\n**Earned Value (latest snapshot):**\n`;
    out += `- CPI: ${latestMetrics.cpi?.toFixed(2)} (${latestMetrics.cpi >= 1 ? "✅ on/under budget" : "⚠️ over budget"})\n`;
    out += `- SPI: ${latestMetrics.spi?.toFixed(2)} (${latestMetrics.spi >= 1 ? "✅ on/ahead of schedule" : "⚠️ behind schedule"})\n`;
    if (latestMetrics.eac) out += `- EAC (forecast at completion): £${Math.round(latestMetrics.eac).toLocaleString()}\n`;
    if (latestMetrics.ragStatus) out += `- RAG Status: ${latestMetrics.ragStatus}`;
  }
  return out;
})()}

## OPEN ISSUES (${issues.length})
${issues.length > 0
  ? issues.map((i: any) => {
      const icon = i.priority === "CRITICAL" || i.priority === "HIGH" ? "🔴" : i.priority === "MEDIUM" ? "🟡" : "🟢";
      return `${icon} **${i.title}** [${i.status}] — ${i.priority}${i.dueDate ? ` — due ${new Date(i.dueDate).toLocaleDateString("en-GB")}` : ""}`;
    }).join("\n")
  : "No open issues."}

## STAKEHOLDERS (${stakeholders.length})
${stakeholders.length > 0
  ? stakeholders.map((s: any) =>
      `- **${s.name}** (${s.role || "Stakeholder"}${s.organisation ? `, ${s.organisation}` : ""}) — Power: ${s.power}/100, Interest: ${s.interest}/100${s.sentiment ? `, Sentiment: ${s.sentiment}` : ""}`
    ).join("\n")
  : "No stakeholders recorded yet."}

## PROJECT RISKS (${openRisks.length} total)
${openRisks.length > 0
  ? openRisks.map((r: any) => {
      const log = (r.responseLog as any[]) || [];
      const stakeholderResponses = log.filter((e: any) => e.type === "STAKEHOLDER_RESPONSE");
      const escalations = log.filter((e: any) => e.type === "ESCALATION");
      let detail = `- **${r.title}** [${r.status}] — Score: ${r.score}/25 (P${r.probability} x I${r.impact}) — ${r.description || ""}`;
      if (r.mitigation) detail += `\n  Mitigation: ${r.mitigation}`;
      if (r.owner) detail += ` | Owner: ${r.owner}`;
      if (escalations.length > 0) detail += `\n  ⚠️ ESCALATED to: ${escalations.map((e: any) => e.recipients?.join(", ")).join("; ")}`;
      if (stakeholderResponses.length > 0) {
        for (const sr of stakeholderResponses) {
          detail += `\n  📩 Stakeholder response from ${sr.respondedBy}: ${sr.action}${sr.comment ? ` — "${sr.comment}"` : ""} (${sr.respondedAt ? new Date(sr.respondedAt).toLocaleDateString("en-GB") : ""})`;
        }
      }
      return detail;
    }).join("\n")
  : "No risks logged yet."}

## ACTIVE ASSUMPTIONS (you made these — pending user confirmation)
${await (async () => {
  try {
    const { getProjectAssumptions } = await import("@/lib/agents/assumptions");
    const assumptions = await getProjectAssumptions(agentId, project?.id || "");
    return assumptions || "No assumptions recorded. All content should be based on confirmed facts from the Knowledge Base.";
  } catch { return "No assumptions recorded."; }
})()}

When the user confirms or changes an assumption, affected artefacts will be automatically flagged for update.

## RECENT ACTIVITY LOG (what happened recently)
${recentActivity.length > 0
  ? recentActivity.map((a: any) => `- [${a.type}] ${a.summary} (${new Date(a.createdAt).toLocaleDateString("en-GB")})`).join("\n")
  : "No recent activity."}

## ALERTS
${(() => {
  const draftArts   = recentArtefacts.filter(a => a.status === "DRAFT" || a.status === "PENDING_REVIEW");
  const hasPendingGate = pendingApprovals.some((a: any) => a.type === "PHASE_GATE");
  const overdueTaskCount = tasks.filter(t => t.endDate && new Date(t.endDate) < new Date() && t.status !== "DONE" && t.status !== "COMPLETE").length;
  const criticalIssues = issues.filter((i: any) => i.priority === "CRITICAL" || i.priority === "HIGH");
  const budget = (project as any)?.budget || 0;
  const totalAct = costEntries.filter((c: any) => c.entryType === "ACTUAL").reduce((s: number, c: any) => s + c.amount, 0);
  const overBudget = budget > 0 && totalAct > budget;

  // Only list items that need attention — nothing else. No workflow re-explanation.
  // The agent already knows the workflow from the main prompt rules.
  const alerts: string[] = [];
  if (recentArtefacts.length === 0 && phases.length > 0) alerts.push(`No artefacts generated yet for ${currentPhase?.name || "current phase"}`);
  if (draftArts.length > 0) alerts.push(`${draftArts.length} artefact(s) pending review: ${draftArts.slice(0, 3).map(a => a.name).join(", ")}`);
  if (hasPendingGate) alerts.push(`Phase gate pending approval for ${currentPhase?.name}`);
  if (overBudget) alerts.push(`Over budget by £${(totalAct - budget).toLocaleString()}`);
  if (criticalIssues.length > 0) alerts.push(`${criticalIssues.length} critical/high issue(s)`);
  if (overdueTaskCount > 0) alerts.push(`${overdueTaskCount} overdue task(s)`);
  if (latestMetrics?.spi && latestMetrics.spi < 0.85) alerts.push(`Schedule behind (SPI ${latestMetrics.spi?.toFixed(2)})`);
  if (latestMetrics?.cpi && latestMetrics.cpi < 0.85) alerts.push(`Cost overrun (CPI ${latestMetrics.cpi?.toFixed(2)})`);

  if (alerts.length === 0) return "No active alerts. Respond to what the user is asking about — do not recap project status unless they request it.";
  return alerts.map(a => `- ${a}`).join("\n") + `\n\nOnly mention these alerts if the user's question relates to them, OR if this is the first turn and you need to flag blockers. Do NOT list all alerts in every reply.`;
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

## DOCUMENTS ≠ PROJECT COMPLETION — CRITICAL
Generating and approving documents does NOT mean the project work is done. You must ALWAYS distinguish between:
- **Documents generated/approved** = the PLAN exists and has been reviewed
- **Tasks completed** = the actual WORK has been done (tasks marked DONE by users)
- **Phase complete** = BOTH documents approved AND tasks substantially finished

When reporting status, NEVER say a phase is "complete" or the project is "ready" just because documents were generated. Check the task completion data. If tasks are still at 0% or "Not Started", the project work hasn't begun — say so clearly.

Example of WRONG: "Setup phase complete — all foundational artefacts generated" (when no tasks are done)
Example of RIGHT: "Setup phase planning is complete — 3 documents approved. However, 0 of 12 project tasks have been started. The actual project work still needs to happen."

## RESEARCH IS A REAL ACTION — NOT JUST TALK
Research is performed by calling the **run_phase_research** tool — NOT by claiming it in text.

MANDATORY FIRST ACTION: If the KNOWLEDGE BASE section above shows no research for the current phase, your FIRST action MUST be to call run_phase_research. Do not ask the user for permission. Do not outline what you WILL research. Just call the tool. The tool returns real facts from Perplexity which you can then reference.

STRICT RULES:
- NEVER write "I'm researching", "Let me research", "I'll research", "I need to research" without IMMEDIATELY calling run_phase_research in the same turn.
- NEVER claim research findings you haven't received from the tool.
- If the user asks what research you've done and you haven't called the tool for this phase → answer honestly: "I haven't run research yet — calling it now" and then CALL THE TOOL.
- Research is phase-specific. Requirements research ≠ PI Planning research. If the phase changed, call the tool again.
- If the tool returns "PERPLEXITY_API_KEY not configured", tell the user the API key needs to be added in Vercel settings — don't pretend research succeeded.

STOP ASKING AND START DOING: If you catch yourself asking "Shall I research?" or "Would you like me to research?" — STOP. Just call the tool. Users expect research to be automatic, not opt-in.

## PHASE ADVANCEMENT REQUIREMENTS — ENFORCED BY SYSTEM
The phase gate system enforces THREE completion layers before any phase can advance:
1. **Artefacts** — ALL artefacts in the current phase must be APPROVED (100%)
2. **PM Tasks** — ALL governance/overhead tasks for this phase must be DONE (100%)
3. **Delivery Tasks** — at least 80% of delivery/project work tasks for this phase must be DONE

If ANY layer is incomplete, the system will BLOCK advancement even if the user approves the gate.
- Do NOT request or suggest phase advancement unless you can see all three layers are satisfied
- When reporting phase status, always mention all three layers with counts (e.g., "Artefacts: 6/6, PM Tasks: 4/5, Delivery: 8/12")
- If tasks are incomplete, tell the user what remains and link to: [Task Board](/projects/${project?.id || ""}/agile), [Schedule](/projects/${project?.id || ""}/schedule), [PM Tracker](/projects/${project?.id || ""}/pm-tracker)
- The phase gate will show "BLOCKED" status until all requirements are met

## EVIDENCE-BASED OUTPUT — CRITICAL
- NEVER claim you have done something unless it appears in the GENERATED ARTEFACTS or LIFECYCLE STATE above. If you haven't done it, say you WILL do it or PLAN to do it.
- NEVER fabricate progress, bookings, requests, confirmations, contacts, or vendor names. You are a planner — describe what NEEDS to happen, not what supposedly already happened.
- When producing documents or boards, ALL items start as "Not Started" or "Planned" unless the project description or artefact data explicitly confirms otherwise.
- Use [TBC] for any specific fact not provided in the project context above. An honest [TBC] is better than a plausible-sounding invention.

## ARTEFACT APPROVAL STATUS — STRICT RULES
- You CANNOT approve artefacts. Only the human user can approve them by clicking the Approve button or by asking you to approve in chat.
- The ONLY source of truth for artefact approval status is the GENERATED ARTEFACTS section above. Check the [STATUS] tag next to each artefact name.
- If an artefact shows [DRAFT] or [PENDING_REVIEW], it is NOT approved — do not say or imply it is approved.
- If an artefact shows [APPROVED] with ✅, it IS approved — you may reference this.
- NEVER say "all artefacts are approved" unless EVERY artefact in the list above shows [APPROVED].
- When the user asks about approval status, read the GENERATED ARTEFACTS list and report the EXACT status of each one.
- If artefacts need approval, direct the user to review them: [Review Artefacts](/agents/${agentId}?tab=artefacts)

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

## INTERACTIVE QUESTIONS — MANDATORY FORMAT FOR ALL QUESTIONS
EVERY time you need information from the user — whether it's a clarification, a decision, a confirmation, or any detail — you MUST use the <ASK> format below. NEVER ask questions as plain text, bullet lists, or numbered lists. The <ASK> format renders as an interactive card widget that the user can answer with one click or typed response.

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
- NEVER ask questions as plain text — ALWAYS use <ASK> tags. No exceptions.
- NEVER list multiple questions as bullets or numbered items — one <ASK> per response

## FACT EXTRACTION — LEARN FROM EVERY CONVERSATION
When the user tells you something new about the project (a name, date, decision, preference, constraint, confirmation), include a <FACTS> block at the END of your response (after all visible text). This is parsed by the system and stored to the Knowledge Base so you remember it in future conversations.

Format — one fact per line, pipe-separated:
<FACTS>
title | content
</FACTS>

Examples:
<FACTS>
Venue confirmed | The training will be held at the Hilton Birmingham Metropole
Number of attendees | 5 senior executives attending the programme
Budget approved | £15,000 approved by finance director on 10/04/2026
Catering preference | Vegetarian options required for 2 of 5 attendees
</FACTS>

Rules:
- Only include GENUINELY NEW facts the user just told you — not things already in the KB
- Title should be a short label (2-5 words). Content should be the specific detail.
- Do NOT include facts you inferred or assumed — only what the user explicitly stated
- If the user didn't provide any new facts in their message, do NOT include a <FACTS> block
- The <FACTS> block is invisible to the user — it's stripped before display

## KNOWLEDGE BASE
${(() => {
  if (knowledgeItems.length === 0) {
    return "No knowledge base items yet. Add documents, decisions, URLs, or run research to build project context.";
  }

  // --- Relevance scoring: boost items whose title/tags overlap with the current message ---
  const msgWords = new Set(
    message.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w: string) => w.length > 3)
  );
  const scored = knowledgeItems.map(k => {
    const titleWords = (k.title || "").toLowerCase().split(/\s+/);
    const tagWords   = (k.tags || []).flatMap((t: string) => t.toLowerCase().split(/[\s_-]+/));
    const overlap = [...titleWords, ...tagWords].filter(w => msgWords.has(w)).length;
    // Trust weight: HIGH_TRUST=3, STANDARD=1, REFERENCE_ONLY=0
    const trustWeight = k.trustLevel === "HIGH_TRUST" ? 3 : k.trustLevel === "REFERENCE_ONLY" ? 0 : 1;
    return { ...k, _score: overlap * 2 + trustWeight };
  }).sort((a, b) => b._score - a._score);

  // --- Per-item char limits by trust level ---
  const charLimit = (item: any) => {
    if (item.trustLevel === "HIGH_TRUST" || item.type === "DECISION") return 1500;
    if (item.trustLevel === "REFERENCE_ONLY") return 200;
    return 600; // STANDARD
  };

  // --- Budget-aware render: stop once we hit 8000 chars total ---
  const KB_BUDGET = 8000;
  let used = 0;
  const rendered: string[] = [];

  for (const k of scored) {
    if (used >= KB_BUDGET) break;
    const trust = k.trustLevel === "HIGH_TRUST" ? "⭐ HIGH TRUST" : k.trustLevel === "REFERENCE_ONLY" ? "📎 REFERENCE" : "📄 STANDARD";
    const tags  = k.tags?.length > 0 ? ` [${k.tags.join(", ")}]` : "";
    const date  = new Date(k.createdAt).toLocaleDateString("en-GB");
    const limit = charLimit(k);
    const remaining = KB_BUDGET - used;
    const allowedChars = Math.min(limit, remaining);
    const body = k.content.length > allowedChars
      ? k.content.slice(0, allowedChars) + "…"
      : k.content;
    const block = `### ${k.title} (${trust}${tags} — ${date})\n${body}`;
    rendered.push(block);
    used += block.length;
  }

  return `The following project knowledge is available. HIGH_TRUST items are confirmed facts — treat them as ground truth. STANDARD items inform your reasoning. REFERENCE_ONLY items are supplementary.

${rendered.join("\n\n")}

_(${rendered.length} of ${knowledgeItems.length} items shown — prioritised by relevance to your query and trust level)_`;
})()}

## MEMORY & CONTINUITY
You have access to the full conversation history from all previous sessions with this user.
- You REMEMBER everything discussed, decided, or approved in past conversations
- Never re-introduce yourself or re-explain your role to a returning user — they know you
- Pick up exactly where you left off; reference prior decisions and artefacts naturally
- If the user returns after a period of autonomous activity, proactively brief them on what you've done since they were last here

## DO NOT REPEAT — STRICT RULE
STOP recapping project status at the start of every reply. The user sees the project status on the dashboard and pipeline pages. They do NOT need you to:
- Re-state the project name, budget, timeline, phase, methodology
- Re-list "Current Status Summary" or "Current Project Understanding"
- Re-list what you know about the project (confirmed facts, gaps, etc.)
- Re-describe what you are "about to do" or "what you need"
- Summarise "Next Steps" at the end of every message
- Ask "Would you like me to proceed?" or "Shall I...?" for routine work

RESPOND DIRECTLY to what the user asked. If they ask "what's next?", give a short answer. If they ask a question, answer it. If they confirm a fact, acknowledge in 1 sentence and continue the work. Do NOT produce structured status reports unless explicitly requested.

Length guidance: Most replies should be 2-5 sentences. Only use headers/bullets for: artefact content, formal status reports, or multi-step plans the user explicitly requested.

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

  // Sanitise: Anthropic requires strictly alternating user/assistant roles.
  // Consecutive same-role messages occur when a stream fails and no assistant
  // response is saved — collapsing them prevents permanent 400 error loops.
  messages = messages.reduce<typeof messages>((acc, msg) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.role === msg.role) {
      // Same role: keep the LATER message (most recent context wins)
      acc[acc.length - 1] = msg;
    } else {
      acc.push(msg);
    }
    return acc;
  }, []);

  // Anthropic requires the array to end on a user turn (or be empty)
  // Strip trailing assistant messages so the current user turn is always last
  while (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    messages.pop();
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
    {
      name: "create_artefact",
      description: "Create a new project document/artefact. Use when the user asks you to write ANY document — reports, briefs, comparisons, minutes, plans, or custom documents not in the standard methodology. The document is saved as DRAFT for user review, editing, and export as Word/PDF/Excel.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Document name (e.g., 'Vendor Comparison Report', 'Site Survey Brief')" },
          content: { type: "string", description: "Full document content in Markdown. Be comprehensive — headings, tables, analysis, recommendations." },
          format: { type: "string", enum: ["markdown", "csv"], description: "Use 'markdown' for prose, 'csv' for spreadsheets" },
        },
        required: ["name", "content"],
      },
    },
    {
      name: "record_assumption",
      description: "Record an assumption you are making. Use EVERY TIME you generate content or make a recommendation that is not backed by confirmed user input. This creates a trackable assumption that the user can later confirm or change.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Short name of what is being assumed (e.g., 'Venue capacity', 'Budget for catering')" },
          value: { type: "string", description: "The assumed value (e.g., '50 guests', '£500')" },
          source: { type: "string", enum: ["agent_inference", "industry_standard", "default_value", "similar_project"], description: "Basis for the assumption" },
          confidence: { type: "string", enum: ["high", "medium", "low"], description: "How confident you are" },
          reasoning: { type: "string", description: "Why you made this assumption" },
          affectedArtefacts: { type: "array", items: { type: "string" }, description: "Which artefacts depend on this assumption" },
        },
        required: ["title", "value", "source", "confidence", "reasoning", "affectedArtefacts"],
      },
    },
    {
      name: "run_phase_research",
      description: "Trigger phase-specific research via Perplexity AI. Use when the current phase has no research yet in KB, or when the user asks you to research something specific for this phase. This runs real queries against the web and stores facts to KB. Do NOT claim you are researching unless you've called this tool.",
      input_schema: {
        type: "object" as const,
        properties: {
          phase: {
            type: "string",
            description: "The phase name to research (e.g., 'PI Planning', 'Requirements', 'Design'). Defaults to the current active phase.",
          },
        },
        required: [],
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
      // Helper: emit a structured progress event to the client
      const emitStatus = (stage: string, detail: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: { stage, detail, ts: Date.now() } })}\n\n`));
      };

      try {
        emitStatus("thinking", "Analysing your message...");

        // ── Auto-scaffold phase tasks if this phase has none yet.
        // Covers existing projects where only the first phase was scaffolded at deploy,
        // or methodologies that skipped delivery task scaffolding for some phases.
        if (deployment?.projectId && deployment.currentPhase) {
          try {
            const phaseLC = deployment.currentPhase.toLowerCase();
            const existingScaffolded = await db.task.count({
              where: {
                projectId: deployment.projectId,
                createdBy: `agent:${agentId}`,
                OR: [
                  { phaseId: deployment.currentPhase },
                  { phaseId: phaseLC },
                ],
                description: { contains: "[scaffolded" },
              },
            });
            if (existingScaffolded === 0) {
              const phaseRow = await db.phase.findFirst({
                where: { projectId: deployment.projectId, name: deployment.currentPhase },
                select: { id: true, name: true, order: true },
              });
              const projectRow = await db.project.findUnique({
                where: { id: deployment.projectId },
                select: { startDate: true, endDate: true, methodology: true },
              });
              if (phaseRow && projectRow) {
                const { scaffoldProjectTasks } = await import("@/lib/agents/task-scaffolding");
                // Fire-and-forget — doesn't block chat response
                scaffoldProjectTasks(agentId, deployment.projectId, [phaseRow], projectRow as any).catch(() => {});
              }
            }
          } catch {}
        }

        // ── Auto-research trigger: if current phase has no KB research AND research
        // hasn't been attempted yet for this phase, fire it in background ONCE.
        // Tracked via a KB sentinel "__phase_research_attempted__" per phase so we
        // don't retry on every chat turn.
        if (deployment?.projectId && deployment.currentPhase) {
          const phaseLC = deployment.currentPhase.toLowerCase();
          const attemptedTag = `research_attempted:${phaseLC}`;

          const [existingPhaseFacts, alreadyAttempted] = await Promise.all([
            db.knowledgeBaseItem.count({
              where: {
                projectId: deployment.projectId,
                agentId,
                tags: { hasSome: [phaseLC, "phase_research"] },
              },
            }).catch(() => 0),
            db.knowledgeBaseItem.count({
              where: {
                projectId: deployment.projectId,
                agentId,
                tags: { has: attemptedTag },
              },
            }).catch(() => 0),
          ]);

          if (existingPhaseFacts === 0 && alreadyAttempted === 0) {
            // Mark as attempted IMMEDIATELY so concurrent messages don't re-trigger
            await db.knowledgeBaseItem.create({
              data: {
                orgId, agentId, projectId: deployment.projectId,
                layer: "PROJECT", type: "TEXT",
                title: `__phase_research_attempted__:${phaseLC}`,
                content: `Auto-research triggered for ${deployment.currentPhase} at ${new Date().toISOString()}`,
                trustLevel: "STANDARD",
                tags: [attemptedTag, "system"],
              },
            }).catch(() => {});

            // Fire-and-forget research
            // Flip phaseStatus to "researching" so UI surfaces reflect the live state
            await db.agentDeployment.update({
              where: { id: deployment.id },
              data: { phaseStatus: "researching" },
            }).catch(() => {});

            import("@/lib/agents/feasibility-research").then(async ({ runPhaseResearch }) => {
              try {
                const research = await runPhaseResearch(agentId, deployment.projectId!, orgId, deployment.currentPhase!);
                if (research.factsDiscovered > 0) {
                  await db.chatMessage.create({
                    data: {
                      agentId,
                      conversationId,
                      role: "agent",
                      content: "__RESEARCH_FINDINGS__",
                      metadata: {
                        type: "research_findings",
                        projectName: project?.name || "Project",
                        factsCount: research.factsDiscovered,
                        sections: research.sections,
                        facts: research.facts,
                        phase: deployment.currentPhase,
                        autoTriggered: true,
                      } as any,
                    },
                  }).catch(() => {});
                }
                // Research complete — advance to clarification so UI reflects progress
                await db.agentDeployment.update({
                  where: { id: deployment.id },
                  data: { phaseStatus: "awaiting_clarification" },
                }).catch(() => {});
                // Log transition for status bar + activity feed
                await db.agentActivity.create({
                  data: {
                    agentId,
                    type: "decision",
                    summary: `Research complete — ${research.factsDiscovered} facts gathered for ${deployment.currentPhase}. Ready for clarification.`,
                  },
                }).catch(() => {});
              } catch (e) {
                console.error("[chat/stream] auto-research failed:", e);
                // On failure, don't leave state stuck at "researching"
                await db.agentDeployment.update({
                  where: { id: deployment.id },
                  data: { phaseStatus: "active" },
                }).catch(() => {});
              }
            }).catch(() => {});
          }
        }

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
          const status = phase1Response.status;
          const userMsg = status === 401 ? "API key is invalid or expired. Please check your ANTHROPIC_API_KEY."
            : status === 429 ? "Rate limited by Anthropic — please wait a moment and try again."
            : status === 529 ? "Anthropic API is temporarily overloaded. Please try again shortly."
            : `AI service error (${status}). Please try again.`;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: userMsg })}\n\n`));
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
                  // Track whether we're inside a <FACTS> block based on what we've
                  // seen so far (excluding this token). This prevents leaking the
                  // close tag's trailing content.
                  const wasInsideFacts = (fullContent.match(/<FACTS>/gi)?.length || 0) > (fullContent.match(/<\/FACTS>/gi)?.length || 0);
                  fullContent += event.delta.text;
                  const nowInsideFacts = (fullContent.match(/<FACTS>/gi)?.length || 0) > (fullContent.match(/<\/FACTS>/gi)?.length || 0);

                  // Strip sentinel strings from live stream (they're post-processed into cards)
                  let cleanToken = event.delta.text
                    .replace(/\b(PROJECT_STATUS|AGENT_QUESTION|__PROJECT_STATUS__|__AGENT_QUESTION__|__CLARIFICATION_SESSION__|__CLARIFICATION_COMPLETE__|__CHANGE_PROPOSAL__)\b/g, "");

                  // FACTS suppression — 4 cases:
                  if (wasInsideFacts && nowInsideFacts) {
                    // Still inside — suppress entirely
                    cleanToken = "";
                  } else if (wasInsideFacts && !nowInsideFacts) {
                    // Close tag arrived in this token — strip everything up to and including </FACTS>
                    cleanToken = cleanToken.replace(/^[\s\S]*?<\/FACTS>/i, "");
                  } else if (!wasInsideFacts && nowInsideFacts) {
                    // Open tag arrived in this token — keep content before, strip from <FACTS> onwards
                    cleanToken = cleanToken.replace(/<FACTS>[\s\S]*$/i, "");
                  } else {
                    // Self-contained FACTS block inside single token
                    cleanToken = cleanToken.replace(/<FACTS>[\s\S]*?<\/FACTS>/gi, "");
                  }
                  // Belt-and-braces: strip any stray tag markers
                  cleanToken = cleanToken.replace(/<\/?FACTS>/gi, "");

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
          emitStatus("executing", `Running ${p1ToolBlocks.length} action${p1ToolBlocks.length > 1 ? "s" : ""}...`);
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

            } else if (toolBlock.name === "create_artefact") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: "\n\n*Creating document…*\n\n" })}\n\n`));
              fullContent += "\n\n*Creating document…*\n\n";
              try {
                const depForArt = await db.agentDeployment.findFirst({ where: { agentId, isActive: true }, select: { projectId: true, currentPhase: true } });
                const artName = toolBlock.input.name || "Custom Document";
                const artContent = toolBlock.input.content || "";
                const artFormat = toolBlock.input.format || "markdown";

                // Dedupe check — prevent creating duplicate artefacts
                const { artefactExists } = await import("@/lib/agents/artefact-dedupe");
                const dupCheck = depForArt?.projectId
                  ? await artefactExists(depForArt.projectId, agentId, artName, depForArt.currentPhase)
                  : { exists: false };

                if (dupCheck.exists) {
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolBlock.id,
                    content: JSON.stringify({
                      error: `Artefact already exists: "${dupCheck.existingName}" (ID: ${dupCheck.existingId}). Edit the existing one instead of creating a duplicate.`,
                      existingId: dupCheck.existingId,
                      existingName: dupCheck.existingName,
                    }),
                  });
                  continue;
                }

                const artefact = await db.agentArtefact.create({
                  data: {
                    agentId,
                    projectId: depForArt?.projectId || "",
                    name: artName,
                    content: artContent,
                    format: artFormat,
                    status: "DRAFT",
                    version: 1,
                    phaseId: depForArt?.currentPhase || null,
                  },
                });

                await db.agentActivity.create({
                  data: { agentId, type: "document", summary: `Created custom artefact: "${artName}" (${artContent.length} chars)` },
                }).catch(() => {});

                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({
                  success: true, artefactId: artefact.id, name: artName, format: artFormat,
                  message: `Document "${artName}" created as DRAFT. User can review at /agents/${agentId}?tab=artefacts`,
                }) });
              } catch (err: any) {
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ error: err.message }) });
              }

            } else if (toolBlock.name === "record_assumption") {
              try {
                const depForAssumption = await db.agentDeployment.findFirst({ where: { agentId, isActive: true }, select: { projectId: true } });
                const { recordAssumption } = await import("@/lib/agents/assumptions");
                const assId = await recordAssumption(agentId, depForAssumption?.projectId || "", orgId, {
                  title: toolBlock.input.title,
                  value: toolBlock.input.value,
                  source: toolBlock.input.source || "agent_inference",
                  confidence: toolBlock.input.confidence || "medium",
                  affectedArtefacts: toolBlock.input.affectedArtefacts || [],
                  reasoning: toolBlock.input.reasoning || "",
                });
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ success: true, assumptionId: assId, message: "Assumption recorded. User can confirm or change it in the Knowledge Base." }) });
              } catch (err: any) {
                toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: JSON.stringify({ error: err.message }) });
              }

            } else if (toolBlock.name === "run_phase_research") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: { stage: "researching", detail: "Running phase research..." } })}\n\n`));
              try {
                const depForResearch = await db.agentDeployment.findFirst({
                  where: { agentId, isActive: true },
                  select: { projectId: true, currentPhase: true },
                });
                const targetPhase = toolBlock.input.phase || depForResearch?.currentPhase;
                if (!depForResearch?.projectId || !targetPhase) {
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolBlock.id,
                    content: JSON.stringify({ error: "No active deployment or phase found" }),
                  });
                } else {
                  const { runPhaseResearch } = await import("@/lib/agents/feasibility-research");
                  const research = await runPhaseResearch(agentId, depForResearch.projectId, orgId, targetPhase);

                  // Post research findings card in chat
                  if (research.factsDiscovered > 0) {
                    await db.chatMessage.create({
                      data: {
                        agentId,
                        conversationId,
                        role: "agent",
                        content: "__RESEARCH_FINDINGS__",
                        metadata: {
                          type: "research_findings",
                          projectName: project?.name || "Project",
                          factsCount: research.factsDiscovered,
                          sections: research.sections,
                          facts: research.facts,
                          phase: targetPhase,
                        } as any,
                      },
                    }).catch(() => {});
                  }

                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolBlock.id,
                    content: JSON.stringify({
                      success: true,
                      phase: targetPhase,
                      factsDiscovered: research.factsDiscovered,
                      queriesRun: research.queries.length,
                      summary: research.summary.slice(0, 500),
                      message: research.factsDiscovered > 0
                        ? `Research complete — ${research.factsDiscovered} facts stored to KB for ${targetPhase} phase.`
                        : `Research skipped — KB already has coverage for ${targetPhase} phase topics.`,
                    }),
                  });
                }
              } catch (err: any) {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolBlock.id,
                  content: JSON.stringify({ error: `Phase research failed: ${err.message}` }),
                });
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

        // ── Extract <FACTS> for KB storage ──────────────────────────────
        const factsMatch = fullContent.match(/<FACTS>([\s\S]*?)<\/FACTS>/i);
        if (factsMatch && deployment?.projectId) {
          const factLines = factsMatch[1].trim().split("\n").filter(l => l.includes("|"));
          for (const line of factLines) {
            const [title, ...rest] = line.split("|").map(s => s.trim());
            const content = rest.join("|").trim();
            if (title && content) {
              try {
                const { storeFactToKB } = await import("@/lib/agents/clarification-session");
                await storeFactToKB(agentId, deployment.projectId, orgId, title, content, ["chat_extracted"]);
              } catch {}
            }
          }
        }

        // Clean <ASK> and <FACTS> blocks from the persisted text
        const cleanedContent = fullContent
          .replace(/<ASK[\s\S]*?<\/ASK>/gi, "")
          .replace(/<FACTS>[\s\S]*?<\/FACTS>/gi, "")
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

        // ── Chat-based artefact approval ───────────────────────────────
        const approvalMatch = /\b(approve|sign.?off|accept)\b.*\b(all|every|artefact|document|charter|brief|register|schedule|budget|wbs|plan|report|business case|stakeholder)/i.test(message)
          || /\b(all|every)?\s*(artefact|document)s?\b.*\b(approve|sign.?off|accept)\b/i.test(message);
        if (approvalMatch && deployment?.projectId) {
          emitStatus("approving", "Processing artefact approvals...");
          try {
            const isApproveAll = /\ball\b|\bevery\b/i.test(message);
            // Find artefacts to approve
            const candidates = await db.agentArtefact.findMany({
              where: {
                agentId,
                projectId: deployment.projectId,
                status: { in: ["DRAFT", "PENDING_REVIEW"] },
              },
              select: { id: true, name: true, status: true },
            });

            // If not "approve all", try to match specific artefact name
            let toApprove = candidates;
            if (!isApproveAll && candidates.length > 0) {
              const msgLower = message.toLowerCase();
              const matched = candidates.filter(a => msgLower.includes(a.name.toLowerCase()));
              if (matched.length > 0) toApprove = matched;
            }

            if (toApprove.length > 0) {
              const approved: string[] = [];
              for (const art of toApprove) {
                await db.agentArtefact.update({
                  where: { id: art.id },
                  data: {
                    status: "APPROVED",
                    metadata: {
                      approvedBy: caller.userId || "chat",
                      approvedAt: new Date().toISOString(),
                      approvedByName: "User (via chat)",
                      approvedVia: "chat",
                    },
                  },
                });
                approved.push(art.name);
              }
              // Post a confirmation message
              await db.chatMessage.create({
                data: {
                  agentId,
                  conversationId,
                  role: "agent",
                  content: `✅ **${approved.length} artefact${approved.length !== 1 ? "s" : ""} approved:**\n${approved.map(n => `- ${n}`).join("\n")}\n\nApproved via chat.`,
                },
              }).catch(() => {});

              await db.agentActivity.create({
                data: { agentId, type: "approval", summary: `${approved.length} artefact(s) approved via chat: ${approved.join(", ")}` },
              }).catch(() => {});
            }
          } catch {}
        }

        // ── Chat-based artefact editing ──────────────────────────────
        const editMatch = /\b(update|edit|change|modify|revise|add|remove|include|amend|rewrite|fix|correct)\b/i.test(message)
          && !approvalMatch; // don't fire on approval messages
        if (editMatch && deployment?.projectId) {
          emitStatus("editing", "Looking for matching artefact...");
          try {
            // Find all artefacts for this project to match against
            const allArtefacts = await db.agentArtefact.findMany({
              where: { agentId, projectId: deployment.projectId },
              select: { id: true, name: true, content: true, format: true, status: true, version: true, feedback: true },
            });

            if (allArtefacts.length > 0) {
              const msgLower = message.toLowerCase();
              // Try to match an artefact name in the message
              const matched = allArtefacts.filter(a => msgLower.includes(a.name.toLowerCase()));
              // Also try partial matches for common short names
              const partialMatches = matched.length === 0
                ? allArtefacts.filter(a => {
                    const words = a.name.toLowerCase().split(/\s+/);
                    return words.some(w => w.length > 3 && msgLower.includes(w));
                  })
                : [];
              const target = matched[0] || partialMatches[0];

              if (target && process.env.ANTHROPIC_API_KEY) {
                emitStatus("editing", `Revising "${target.name}"...`);
                // If the artefact is REJECTED, the stored feedback is the
                // canonical record of what the reviewer wanted changed. Pull
                // it into the prompt alongside the user's chat message so
                // Claude addresses the rejection even when the user's
                // request is terse ("fix it", "redo this").
                const rejectionContext = target.status === "REJECTED" && (target as any).feedback
                  ? `\n\nPRIOR REJECTION FEEDBACK from the human reviewer (you MUST address this):\n${(target as any).feedback}\n`
                  : "";

                // Call Claude to revise the artefact
                const editPrompt = `You are editing a project management document. Apply the user's requested change to the existing document content.

DOCUMENT NAME: ${target.name}
FORMAT: ${target.format}
CURRENT CONTENT:
${target.content.slice(0, 30000)}
${rejectionContext}
USER'S EDIT REQUEST:
${message}

RULES:
- Apply ONLY the specific change the user requested. Do not rewrite unrelated sections.
- Preserve the existing format (${target.format}) — if it's CSV keep it CSV, if HTML keep HTML, if markdown keep markdown.
- If adding new items, place them in the logical location within the document.
- If removing items, remove them cleanly without leaving gaps.
- Return ONLY the updated document content, no explanations or preamble.
- If the requested change doesn't make sense for this document, return the original content unchanged.`;

                const editRes = await fetch("https://api.anthropic.com/v1/messages", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": process.env.ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                  },
                  body: JSON.stringify({
                    model: "claude-sonnet-4-20250514",
                    max_tokens: 8192,
                    messages: [{ role: "user", content: editPrompt }],
                  }),
                });

                if (editRes.ok) {
                  const editData = await editRes.json();
                  const newContent = editData.content?.[0]?.text?.trim();

                  if (newContent && newContent !== target.content.trim()) {
                    const newVersion = target.version + 1;
                    await db.agentArtefact.update({
                      where: { id: target.id },
                      data: {
                        content: newContent,
                        version: newVersion,
                        status: "DRAFT", // reset to draft for re-approval
                        feedback: `Edited via chat: "${message.slice(0, 200)}"`,
                      },
                    });

                    // Post confirmation
                    await db.chatMessage.create({
                      data: {
                        agentId,
                        conversationId,
                        role: "agent",
                        content: `📝 **${target.name}** updated to v${newVersion}\n\nEdit: "${message.slice(0, 150)}"\n\nStatus reset to **DRAFT** for your review. [Review Artefacts](/agents/${agentId}?tab=artefacts)`,
                      },
                    }).catch(() => {});

                    await db.agentActivity.create({
                      data: { agentId, type: "document", summary: `Artefact edited via chat: "${target.name}" → v${newVersion}` },
                    }).catch(() => {});

                    // Deduct credits for the edit
                    await CreditService.deduct(orgId, 3, `Artefact edit: ${target.name}`, agentId).catch(() => {});
                  }
                }
              }
            }
          } catch {}
        }

        // Note: We intentionally don't log a chat activity here — every chat turn
        // already creates two chatMessage rows (user + agent). Adding an activity
        // entry duplicates the record and clutters the activity feed.
        // Activity entries are now only written for actual ACTIONS (approvals,
        // artefact edits, research runs, task changes).

        const creditCost = fullContent.length > 2000 ? 8 : fullContent.length > 800 ? 4 : 2;
        await CreditService.deduct(orgId, creditCost, `Agent chat: ${message.slice(0, 40)}`, agentId);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();
      } catch (e: any) {
        // Emit error status so client can show retry UI
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: { stage: "error", detail: e?.message || "Something went wrong" }, error: e?.message || "Unknown error" })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch {
          controller.error(e);
        }
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
