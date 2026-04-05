import { db } from "@/lib/db";
import type { ActionProposal } from "./decision-classifier";

// Agent LLM service — abstracted to support OpenAI or Anthropic
export class AgentLLM {
  /**
   * Autonomous cycle: analyse project state, propose 0-N actions.
   * Returns structured ActionProposal[] (not conversational text).
   */
  static async autonomousCycle(agentId: string): Promise<ActionProposal[]> {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      include: { deployments: { where: { isActive: true }, include: { project: true } } },
    });
    if (!agent) return [];

    const project = agent.deployments[0]?.project;
    if (!project) return [];

    // Gather project state
    const [tasks, risks, issues, recentActivities] = await Promise.all([
      db.task.findMany({ where: { projectId: project.id }, orderBy: { updatedAt: "desc" }, take: 30 }),
      db.risk.findMany({ where: { projectId: project.id }, orderBy: { score: "desc" } }),
      db.issue.findMany({ where: { projectId: project.id, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      db.agentActivity.findMany({ where: { agentId }, orderBy: { createdAt: "desc" }, take: 10 }),
    ]);

    const totalTasks = tasks.length;
    const doneTasks = tasks.filter(t => t.status === "DONE").length;
    const blockedTasks = tasks.filter(t => t.status === "BLOCKED").length;
    const highRisks = risks.filter(r => (r.score || 0) >= 12);

    const projectState = `
PROJECT: ${project.name} (${project.methodology}, ${project.status})
Budget: £${(project.budget || 0).toLocaleString()} | Start: ${project.startDate || "TBD"} | End: ${project.endDate || "TBD"}

TASKS: ${doneTasks}/${totalTasks} done, ${blockedTasks} blocked
${tasks.slice(0, 15).map(t => `- [${t.status}] ${t.title}${t.assigneeId ? "" : " (unassigned)"}`).join("\n")}

RISKS: ${risks.length} total, ${highRisks.length} high/critical
${risks.slice(0, 8).map(r => `- [Score ${r.score}] ${r.title} (${r.status})`).join("\n")}

OPEN ISSUES: ${issues.length}
${issues.slice(0, 5).map(i => `- [${i.priority}] ${i.title}`).join("\n")}

RECENT AGENT ACTIVITY:
${recentActivities.slice(0, 5).map(a => `- ${a.type}: ${a.summary}`).join("\n")}
`;

    // Enrich with deep knowledge context
    let deepKnowledge = "";
    try {
      const { buildDeepKnowledgeContext } = await import("./deep-knowledge");
      deepKnowledge = await buildDeepKnowledgeContext(agentId, project.id);
    } catch {}

    // Inject project tier modifier
    let tierModifier = "";
    try {
      const { getProjectTierConfig, getTierPromptModifier } = await import("./project-tier");
      const tierConfig = getProjectTierConfig(project);
      tierModifier = getTierPromptModifier(tierConfig.tier);
    } catch {}

    const cyclePrompt = `You are Agent ${agent.name}, an L${agent.autonomyLevel} AI Project Manager.
Analyse the current project state and propose actions to take.

${tierModifier}

${projectState}
${deepKnowledge ? `\n${deepKnowledge}\n` : ""}

AUTONOMY LEVEL: L${agent.autonomyLevel} (${["", "Assistant", "Advisor", "Co-pilot", "Autonomous", "Strategic"][agent.autonomyLevel]})

Respond with a JSON array of action proposals. Each proposal:
{
  "type": "TASK_ASSIGNMENT" | "RISK_RESPONSE" | "SCHEDULE_CHANGE" | "RESOURCE_ALLOCATION" | "ESCALATION" | "BUDGET_CHANGE" | "SCOPE_CHANGE" | "COMMUNICATION" | "DOCUMENT_GENERATION",
  "description": "What to do (1 sentence)",
  "reasoning": "Why (2-3 sentences with evidence from project data)",
  "confidence": 0.0-1.0,
  "scheduleImpact": 1-4,
  "costImpact": 1-4,
  "scopeImpact": 1-4,
  "stakeholderImpact": 1-4,
  "affectedItems": [{"type": "task"|"risk"|"issue", "id": "...", "title": "..."}]
}

Rules:
- Propose 0-5 actions. If project is healthy, propose 0.
- Only propose actions supported by evidence in the data above.
- Do NOT fabricate task IDs — use the IDs from the data.
- Self-assess impact scores honestly (1=none, 4=major).
- Prefer LOW-risk routine actions over HIGH-risk changes.
- If a task is BLOCKED, propose investigating or escalating.
- If a risk has score ≥ 12, propose mitigation.

Output ONLY the JSON array, no markdown fences.`;

    if (!process.env.ANTHROPIC_API_KEY) return [];

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          messages: [{ role: "user", content: cyclePrompt }],
        }),
      });

      if (!response.ok) return [];

      const data = await response.json();
      const text = (data.content[0]?.text || "").trim();

      // Parse JSON — strip code fences if present
      const clean = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
      const proposals: ActionProposal[] = JSON.parse(clean);

      // Validate each proposal
      return proposals.filter(p =>
        p.type && p.description && typeof p.scheduleImpact === "number" &&
        typeof p.costImpact === "number" && typeof p.scopeImpact === "number" &&
        typeof p.stakeholderImpact === "number"
      );
    } catch (e) {
      console.error("Autonomous cycle LLM error:", e);
      return [];
    }
  }

  static async chat(agentId: string, userMessage: string): Promise<string> {
    // Get agent config
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      include: {
        deployments: { where: { isActive: true }, include: { project: true } },
      },
    });

    if (!agent) throw new Error("Agent not found");

    const project = agent.deployments[0]?.project;
    const personality = (agent.personality as any) || {};
    const formalLevel = personality.formal || 50;
    const detailLevel = personality.concise || 50;

    // Build system prompt
    const systemPrompt = buildSystemPrompt(agent, project, formalLevel, detailLevel);

    // Get conversation history (last 20 messages)
    const history = await db.chatMessage.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...history.reverse().map(m => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: m.content,
      })),
      { role: "user" as const, content: userMessage },
    ];

    // Try Anthropic first, then OpenAI, then fallback
    if (process.env.ANTHROPIC_API_KEY) {
      return await callAnthropic(messages, systemPrompt);
    }

    if (process.env.OPENAI_API_KEY) {
      return await callOpenAI(messages);
    }

    // Fallback — intelligent placeholder response
    return generateFallbackResponse(agent.name, project?.name, userMessage);
  }
}

async function callAnthropic(messages: any[], systemPrompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.filter(m => m.role !== "system").map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Anthropic API error:", err);
    throw new Error("LLM API error");
  }

  const data = await response.json();
  return data.content[0]?.text || "I apologize, I couldn't generate a response.";
}

async function callOpenAI(messages: any[]): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) throw new Error("OpenAI API error");

  const data = await response.json();
  return data.choices[0]?.message?.content || "I apologize, I couldn't generate a response.";
}

function buildSystemPrompt(agent: any, project: any, formalLevel: number, detailLevel: number): string {
  const tone = formalLevel < 30 ? "formal and data-driven" : formalLevel < 70 ? "professional but approachable" : "friendly and conversational";
  const detail = detailLevel < 30 ? "concise and to-the-point" : detailLevel < 70 ? "balanced with key details" : "thorough and comprehensive";

  return `You are Agent ${agent.name}, an AI Project Manager deployed by Projectoolbox.

IDENTITY:
- Name: Agent ${agent.name} (codename: ${agent.codename})
- Autonomy Level: L${agent.autonomyLevel} (${["", "Assistant", "Advisor", "Co-pilot", "Autonomous", "Strategic"][agent.autonomyLevel]})
- Communication style: ${tone}, ${detail}

${project ? `PROJECT CONTEXT:
- Project: ${project.name}
- Methodology: ${project.methodology}
- Description: ${project.description || "Not specified"}
- Budget: ${project.budget ? `$${project.budget.toLocaleString()}` : "Not set"}
- Start: ${project.startDate || "Not set"}, End: ${project.endDate || "Not set"}
- Status: ${project.status}` : "No project currently assigned."}

RULES:
1. You are a professional project manager. Provide actionable, evidence-based advice.
2. ZERO-HALLUCINATION PRINCIPLE: Never fabricate data. If data is missing, state EXACTLY what is missing and ask for it. Do NOT fill gaps with assumptions.
3. For decisions above your autonomy level, recommend actions and explain you need human approval.
4. Reference PM best practices (PMI, PRINCE2, Agile) where relevant.
5. Track risks, issues, and action items proactively.
6. Format responses clearly with headers, bullets, and structured data where appropriate.
7. If asked to generate an artefact, provide a well-structured template.

SOURCE TRACEABILITY — MANDATORY:
- Label every data point you cite as one of: [VERIFIED] (from project database), [CALCULATED] (derived from project data), or [INFERRED] (your analysis/estimation).
- End every substantive response with a "Sources:" section listing where each key fact came from.
- When data is incomplete, state: "Note: This assessment is based on available data. Missing: [list what's missing]. Confidence: [HIGH/MEDIUM/LOW] because [reason]."
- When sources conflict, flag the conflict and recommend human review rather than choosing one.

Respond helpfully as Agent ${agent.name}.`;
}

function generateFallbackResponse(agentName: string, projectName: string | undefined, userMessage: string): string {
  const msg = userMessage.toLowerCase();

  if (msg.includes("status") || msg.includes("update")) {
    return `**Project Status Update — ${projectName || "Current Project"}**

I'm currently analysing the project data. Here's what I can tell you:

- **Overall Health**: Monitoring in progress
- **Key Activities**: Awaiting task and schedule data to provide specific metrics
- **Recommendations**: Consider setting up the project schedule and risk register to enable automated tracking

Would you like me to help set up any specific project artefacts?

*Note: Connect an AI API key (Anthropic or OpenAI) in your .env file to enable full AI-powered responses.*`;
  }

  if (msg.includes("risk")) {
    return `**Risk Analysis — ${projectName || "Current Project"}**

I'll analyse the current risk landscape:

1. **Risk Identification**: I'll scan for potential risks based on the project parameters
2. **Assessment**: Each risk will be scored on probability × impact (1-5 scale)
3. **Mitigation**: I'll recommend strategies for high-priority risks

To provide specific risk analysis, I need:
- Project scope and deliverables
- Schedule constraints
- Resource availability
- External dependencies

Shall I create a Risk Register template for this project?

*Note: Add an AI API key to your .env for intelligent risk analysis.*`;
  }

  return `Hello! I'm Agent ${agentName}${projectName ? `, managing ${projectName}` : ""}. I've received your message and I'm ready to help.

I can assist with:
- 📊 **Status updates** and progress tracking
- ⚠️ **Risk identification** and mitigation planning
- 📄 **Document generation** (plans, reports, registers)
- 📅 **Schedule management** and milestone tracking
- 💰 **Budget monitoring** and EVM analysis
- 👥 **Stakeholder communications**

What would you like me to focus on?

*Note: For full AI-powered responses, add your Anthropic or OpenAI API key to the .env file.*`;
}
