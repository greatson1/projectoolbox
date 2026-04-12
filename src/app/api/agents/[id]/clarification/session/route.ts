import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";
import { getActiveSession } from "@/lib/agents/clarification-session";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/clarification/session
 *
 * Returns the active clarification session (if any) for the agent's current deployment.
 * Used by the chat page on mount to hydrate the interactive question card.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });
  if (!deployment?.projectId) {
    return NextResponse.json({ data: null });
  }

  const session = await getActiveSession(agentId, deployment.projectId);
  if (!session) return NextResponse.json({ data: null });

  const currentQuestion = session.questions[session.currentQuestionIndex] ?? null;
  const answeredCount = session.questions.filter(q => q.answered).length;

  return NextResponse.json({
    data: {
      session,
      currentQuestion,
      answeredCount,
      totalCount: session.questions.length,
    },
  });
}
