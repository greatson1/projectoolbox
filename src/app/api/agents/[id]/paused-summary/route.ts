import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/paused-summary
 *
 * Returns a snapshot of what was in-flight when this agent was last paused,
 * so the chat resume banner can warn the user "Resuming will re-run X
 * cancelled jobs" before they click. Removes the "where exactly was I?"
 * guesswork after a pause.
 *
 * Returns null pausedAt for non-paused agents — caller treats that as
 * "nothing to show, render the simple banner".
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { status: true },
  });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (agent.status !== "PAUSED") {
    return NextResponse.json({ data: { pausedAt: null, cancelledJobs: [] } });
  }

  // Most recent "paused" activity row tells us when this pause started.
  const lastPause = await db.agentActivity.findFirst({
    where: { agentId, type: "paused" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, summary: true },
  });

  if (!lastPause) {
    return NextResponse.json({ data: { pausedAt: null, cancelledJobs: [] } });
  }

  // Jobs cancelled by the pause: FAILED rows whose error message matches the
  // pause-cancellation marker, written by cancelAgentJobs() in job-queue.ts.
  // We accept a small lookback window before the pause timestamp because the
  // updateMany happens microseconds after the activity row write — strict
  // equality misses some rows under load.
  const lookback = new Date(lastPause.createdAt.getTime() - 5000);
  const cancelledJobs = await db.agentJob.findMany({
    where: {
      agentId,
      status: "FAILED",
      error: "Cancelled: agent paused",
      completedAt: { gte: lookback },
    },
    select: { id: true, type: true, priority: true, completedAt: true },
    orderBy: { completedAt: "desc" },
  });

  // Friendly per-type counts for the banner copy.
  const countsByType: Record<string, number> = {};
  for (const j of cancelledJobs) {
    countsByType[j.type] = (countsByType[j.type] || 0) + 1;
  }

  return NextResponse.json({
    data: {
      pausedAt: lastPause.createdAt,
      pausedBy: lastPause.summary,
      cancelledJobsCount: cancelledJobs.length,
      countsByType,
    },
  });
}
