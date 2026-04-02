import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { CreditService } from "@/lib/credits/service";
import { AgentLLM } from "@/lib/agents/llm";

// POST /api/agents/[id]/chat — Send message to agent
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = (session.user as any).orgId;
  const body = await req.json();
  const { message, conversationId } = body;

  if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 });

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

  // Save agent response
  const agentMsg = await db.chatMessage.create({
    data: { agentId, conversationId, role: "agent", content: responseContent },
  });

  // Deduct credit (1 for simple chat, 5 for complex analysis)
  const isComplex = message.length > 200 || message.toLowerCase().includes("analyse") || message.toLowerCase().includes("generate") || message.toLowerCase().includes("report");
  const creditCost = isComplex ? 5 : 1;
  await CreditService.deduct(orgId, creditCost, `Chat: ${isComplex ? "complex analysis" : "query"}`, agentId);

  // Log activity
  await db.agentActivity.create({
    data: { agentId, type: "chat", summary: `Responded to: ${message.slice(0, 60)}${message.length > 60 ? "..." : ""}` },
  });

  return NextResponse.json({
    data: { userMessage: userMsg, agentMessage: agentMsg },
  });
}

// GET /api/agents/[id]/chat — Chat history
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;

  const messages = await db.chatMessage.findMany({
    where: { agentId },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  return NextResponse.json({ data: messages });
}
