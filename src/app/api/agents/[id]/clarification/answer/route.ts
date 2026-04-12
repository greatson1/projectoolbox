import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";
import { answerQuestionInSession } from "@/lib/agents/clarification-session";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[id]/clarification/answer
 *
 * Answers one clarification question, stores the fact to KB, advances the session,
 * and posts the next question card to chat.
 *
 * Zero credits consumed — this is a data-collection flow, not a chat/AI call.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const body = await req.json();
  const { questionId, answer } = body;

  if (!questionId || answer === undefined || answer === null) {
    return NextResponse.json({ error: "questionId and answer are required" }, { status: 400 });
  }

  // Get active deployment for projectId
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });
  if (!deployment?.projectId) {
    return NextResponse.json({ error: "No active deployment found" }, { status: 404 });
  }

  const result = await answerQuestionInSession(
    agentId,
    deployment.projectId,
    caller.orgId,
    questionId,
    String(answer),
  );

  return NextResponse.json({ data: result });
}
