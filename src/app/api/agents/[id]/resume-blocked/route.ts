import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resumeBlockedProposals } from "@/lib/agents/action-executor";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[id]/resume-blocked
 *
 * Manually trigger re-processing of all budget-blocked proposals for an agent.
 * Useful after a credit top-up when the auto-resume didn't fire, or for debugging.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify agent belongs to the user's org
  const agent = await db.agent.findUnique({
    where: { id },
    select: { id: true, name: true, orgId: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (agent.orgId !== (session.user as any).orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Count pending jobs before
  const pendingBefore = await db.agentJob.count({
    where: { agentId: id, type: "budget_resume", status: "PENDING" },
  });

  if (pendingBefore === 0) {
    return NextResponse.json({
      data: { resumed: 0, failed: 0, message: "No blocked proposals queued for this agent." },
    });
  }

  const result = await resumeBlockedProposals(id);

  return NextResponse.json({
    data: {
      ...result,
      message:
        result.resumed === 0
          ? "No proposals could be resumed — agent may still be over budget."
          : `Successfully resumed ${result.resumed} blocked action(s).${result.failed > 0 ? ` ${result.failed} still pending (budget may be exhausted).` : ""}`,
    },
  });
}

/**
 * GET /api/agents/[id]/resume-blocked
 *
 * Returns the count and details of pending budget-blocked proposals.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const agent = await db.agent.findUnique({
    where: { id },
    select: { id: true, name: true, orgId: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (agent.orgId !== (session.user as any).orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const jobs = await db.agentJob.findMany({
    where: { agentId: id, type: "budget_resume", status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      payload: true,
    },
  });

  const proposals = jobs.map((job) => {
    const p = (job.payload as any)?.proposal;
    return {
      jobId: job.id,
      queuedAt: job.createdAt,
      description: p?.description ?? "Unknown action",
      type: p?.type ?? "unknown",
      creditCost: p?.creditCost ?? 0,
      blockedReason: (job.payload as any)?.blockedReason,
    };
  });

  return NextResponse.json({ data: { count: jobs.length, proposals } });
}
