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

  // Get agent config + conversation history
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: { deployments: { where: { isActive: true }, include: { project: true } } },
  });

  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const project = agent.deployments[0]?.project;
  const personality = (agent.personality as any) || {};
  const formalLevel = personality.formal || 50;

  const systemPrompt = `You are Agent ${agent.name}, an AI Project Manager deployed by Projectoolbox.
Autonomy Level: L${agent.autonomyLevel}. Communication style: ${formalLevel < 30 ? "formal" : formalLevel < 70 ? "professional" : "friendly"}.
${project ? `Project: ${project.name} (${project.methodology}, ${project.status})` : "No project assigned."}
Respond helpfully as Agent ${agent.name}.`;

  const history = await db.chatMessage.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const messages = history.reverse()
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: m.content }));

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "No AI API key configured" }, { status: 500 });
  }

  // Stream from Anthropic
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
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

        // Deduct credits
        const isComplex = message.length > 200;
        await CreditService.deduct(orgId, isComplex ? 5 : 1, `Chat stream: ${isComplex ? "complex" : "query"}`, agentId);

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
