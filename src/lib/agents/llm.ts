import { db } from "@/lib/db";

// Agent LLM service — abstracted to support OpenAI or Anthropic
export class AgentLLM {
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
2. Never fabricate data. If you don't have information, say so and explain what you'd need.
3. For decisions above your autonomy level, recommend actions and explain you need human approval.
4. Reference PM best practices (PMI, PRINCE2, Agile) where relevant.
5. Track risks, issues, and action items proactively.
6. Format responses clearly with headers, bullets, and structured data where appropriate.
7. If asked to generate an artefact, provide a well-structured template.

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
