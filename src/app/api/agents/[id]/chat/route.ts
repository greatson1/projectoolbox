import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { CreditService } from "@/lib/credits/service";
import { AgentLLM } from "@/lib/agents/llm";

export const dynamic = "force-dynamic";

// POST /api/agents/[id]/chat — Send message to agent
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;
  const body = await req.json();
  const { message, conversationId } = body;

  if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 });

  // Pause guard — mirrors the streaming route so paused agents stay silent
  // on both code paths. Without this, the streaming guard would just push
  // traffic to the fallback endpoint instead of actually blocking it.
  const agentRow = await db.agent.findUnique({ where: { id: agentId }, select: { status: true, name: true } });
  if (!agentRow) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (agentRow.status === "PAUSED") {
    return NextResponse.json(
      {
        error: "Agent is paused",
        agentStatus: "PAUSED",
        message: `${agentRow.name} is paused. Resume the agent to continue the conversation.`,
      },
      { status: 423 },
    );
  }
  if (agentRow.status === "ARCHIVED") {
    return NextResponse.json(
      {
        error: "Agent is archived",
        agentStatus: "ARCHIVED",
        message: `${agentRow.name} is archived (read-only). Unarchive the agent to resume the conversation.`,
      },
      { status: 423 },
    );
  }

  // Check credits
  const hasCredits = await CreditService.checkBalance(orgId, 1);
  if (!hasCredits) {
    return NextResponse.json({ error: "Insufficient credits. Purchase more at /billing/credits" }, { status: 402 });
  }

  // Save user message
  const userMsg = await db.chatMessage.create({
    data: { agentId, conversationId, role: "user", content: message },
  });

  // Call LLM
  let responseContent: string;
  try {
    responseContent = await AgentLLM.chat(agentId, message);
  } catch (e: any) {
    console.error("LLM error:", e.message);
    responseContent = `I encountered an error processing your request. Please try again. (${e.message})`;
  }

  // Detect if the response contains an action proposal
  // LLM may include [ACTION_PROPOSAL] markers or structured JSON
  let actionProposal = null;
  const actionMatch = responseContent.match(/\[ACTION_PROPOSAL\]([\s\S]*?)\[\/ACTION_PROPOSAL\]/);
  if (actionMatch) {
    try {
      actionProposal = JSON.parse(actionMatch[1].trim());
      // Remove the proposal markers from the visible response
      responseContent = responseContent.replace(/\[ACTION_PROPOSAL\][\s\S]*?\[\/ACTION_PROPOSAL\]/, "").trim();
    } catch {}
  }

  // Also detect action-like language and auto-classify
  const lowerMsg = message.toLowerCase();
  const isActionRequest = lowerMsg.includes("move") || lowerMsg.includes("reschedule") ||
    lowerMsg.includes("reassign") || lowerMsg.includes("create") || lowerMsg.includes("update") ||
    lowerMsg.includes("send") || lowerMsg.includes("generate report") || lowerMsg.includes("change");

  // Save agent response with metadata
  const agentMsg = await db.chatMessage.create({
    data: {
      agentId, conversationId, role: "agent", content: responseContent,
      metadata: {
        ...(actionProposal && { actionProposal }),
        ...(isActionRequest && { isActionRequest: true }),
      },
    },
  });

  // Deduct credit (1 for simple chat, 5 for complex analysis)
  const isComplex = message.length > 200 || lowerMsg.includes("analyse") || lowerMsg.includes("generate") || lowerMsg.includes("report");
  const creditCost = isComplex ? 5 : 1;
  await CreditService.deduct(orgId, creditCost, `Chat: ${isComplex ? "complex analysis" : "query"}`, agentId);

  // Log activity
  await db.agentActivity.create({
    data: { agentId, type: "chat", summary: `Responded to: ${message.slice(0, 60)}${message.length > 60 ? "..." : ""}` },
  });

  // Auto-populate Knowledge Base with chat exchange
  try {
    const deployment = await db.agentDeployment.findFirst({ where: { agentId, isActive: true }, select: { projectId: true } });
    await db.knowledgeBaseItem.create({
      data: {
        orgId, agentId, projectId: deployment?.projectId || null,
        layer: "PROJECT", type: "CHAT",
        title: `Chat: ${message.slice(0, 80)}`,
        content: `User: ${message}\n\nAgent: ${responseContent.slice(0, 1000)}`,
        tags: ["chat", "auto-generated"],
      },
    });
  } catch {}

  return NextResponse.json({
    data: { userMessage: userMsg, agentMessage: agentMsg },
  });
}

// GET /api/agents/[id]/chat — Chat history
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;

  // Take the LATEST 100 messages, then return them in chronological order.
  // The previous version ordered ASC + take:100 which returned the oldest
  // 100 — once a conversation crossed that threshold the newest messages
  // (the ones the user actually wants on refresh) were silently dropped.
  const recent = await db.chatMessage.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const ordered = recent.reverse();

  // Pull pause / resume activities that fall inside the chat window so the
  // client can render faint timeline dividers ("— Agent paused 18:42 —").
  // Reading old chat later, you can see exactly where the agent went silent
  // without leaving the thread to dig through the activity log.
  const oldestTs = ordered[0]?.createdAt;
  const lifecycle = oldestTs
    ? await db.agentActivity.findMany({
        where: {
          agentId,
          type: { in: ["paused", "resumed"] },
          createdAt: { gte: oldestTs },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, summary: true, createdAt: true },
      }).catch(() => [])
    : [];

  return NextResponse.json({ data: ordered, lifecycle });
}
