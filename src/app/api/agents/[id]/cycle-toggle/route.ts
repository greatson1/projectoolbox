import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/cycle-toggle
 *
 * Returns the current paused state + the active deployment's phase
 * context so the toggle card can show "Cycle is paused / running" and
 * the phase-aware effective cadence.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { id: agentId } = await params;
  const agent = await db.agent.findFirst({
    where: { id: agentId, orgId },
    select: { id: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { id: true, cyclePaused: true, currentPhase: true, phaseStatus: true, cycleInterval: true },
  });
  if (!deployment) {
    return NextResponse.json({
      data: { paused: true, currentPhase: null, phaseStatus: null, cycleInterval: 10 },
    });
  }

  return NextResponse.json({
    data: {
      paused: deployment.cyclePaused,
      currentPhase: deployment.currentPhase,
      phaseStatus: deployment.phaseStatus,
      cycleInterval: deployment.cycleInterval,
    },
  });
}

/**
 * POST /api/agents/[id]/cycle-toggle
 * Body: { paused: boolean }
 *
 * Toggle the autonomous cycle on/off for the agent's active deployment.
 * Defaults to paused on new deployments — the user enables it when the
 * project enters delivery (so the cycle's monitoring loop adds value
 * vs paying Claude to scan an idle project waiting on user input).
 *
 * Effects:
 *  - paused=true  → getDueDeployments excludes this deployment, no cycle ever runs
 *  - paused=false → next cron tick picks it up; nextCycleAt is set to "now"
 *                   so the first cycle fires within the next minute, not after
 *                   the legacy 10-min wait.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { id: agentId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.paused !== "boolean") {
    return NextResponse.json({ error: "Body must be { paused: boolean }" }, { status: 400 });
  }

  // Verify the agent belongs to the caller's org
  const agent = await db.agent.findFirst({
    where: { id: agentId, orgId },
    select: { id: true, name: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { id: true, cyclePaused: true, currentPhase: true, phaseStatus: true },
  });
  if (!deployment) return NextResponse.json({ error: "No active deployment" }, { status: 404 });

  // Idempotent — if state already matches, no-op
  if (deployment.cyclePaused === body.paused) {
    return NextResponse.json({
      data: { agentId, deploymentId: deployment.id, paused: body.paused, changed: false },
    });
  }

  const updated = await db.agentDeployment.update({
    where: { id: deployment.id },
    data: {
      cyclePaused: body.paused,
      // When un-pausing, schedule the first cycle for ~now so the user
      // doesn't wait the full cycleInterval before seeing the agent
      // start working. When pausing, leave nextCycleAt alone — it'll be
      // ignored by getDueDeployments anyway.
      ...(body.paused === false ? { nextCycleAt: new Date() } : {}),
    },
  });

  // Audit trail + activity log so the operator can see when the toggle flipped.
  await Promise.all([
    db.auditLog.create({
      data: {
        orgId,
        userId: session.user.id,
        action: body.paused ? "AGENT_CYCLE_PAUSED" : "AGENT_CYCLE_RESUMED",
        target: agent.name,
        entityType: "agent",
        entityId: agentId,
        rationale: body.paused
          ? `Autonomous cycle paused — agent stops running monitoring/alert/Sonnet loops until re-enabled.`
          : `Autonomous cycle enabled — agent will run a monitoring + alert + autonomous-cycle loop on the configured cadence.`,
      },
    }).catch(() => {}),
    db.agentActivity.create({
      data: {
        agentId,
        type: "system",
        summary: body.paused
          ? `Autonomous cycle paused by ${session.user.name || session.user.email || "user"}`
          : `Autonomous cycle enabled by ${session.user.name || session.user.email || "user"}`,
      },
    }).catch(() => {}),
  ]);

  return NextResponse.json({
    data: {
      agentId,
      deploymentId: deployment.id,
      paused: updated.cyclePaused,
      changed: true,
      currentPhase: deployment.currentPhase,
      phaseStatus: deployment.phaseStatus,
    },
  });
}
