/**
 * POST /api/projects/[projectId]/sprints/replan
 *
 * Triggers a full sprint replan for the project's backlog.
 * Clears auto-planned sprint assignments and re-distributes tasks
 * across new sprints based on priority, story points, and team velocity.
 *
 * Body (all optional):
 *   resetAll           boolean  — also clear user-set sprint assignments (full wipe)
 *   sprintDurationDays number   — override sprint length (default: 14 days)
 *   velocityOverride   number   — override story points per sprint
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  // Verify project access
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true, name: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Verify the user belongs to this org
  const member = await db.userOrganisation.findFirst({
    where: { orgId: project.orgId, userId: (session.user as any).id },
  });
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Parse body (all optional)
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}

  const resetAll           = body.resetAll           === true;
  const sprintDurationDays = typeof body.sprintDurationDays === "number" ? body.sprintDurationDays : undefined;
  const velocityOverride   = typeof body.velocityOverride   === "number" ? body.velocityOverride   : undefined;

  // Resolve the active agent for this project
  const deployment = await db.agentDeployment.findFirst({
    where: { projectId, isActive: true },
    select: { agentId: true },
  });
  if (!deployment) {
    return NextResponse.json({ error: "No active agent for this project" }, { status: 400 });
  }

  // Run the planner with force=true
  const { planSprints } = await import("@/lib/agents/sprint-planner");
  const result = await planSprints(deployment.agentId, projectId, {
    force: true,
    resetAll,
    sprintDurationDays,
    velocityOverride,
  });

  // Audit log
  await db.agentActivity.create({
    data: {
      agentId: deployment.agentId,
      type: "document",
      summary: `Sprint replan triggered by ${session.user.name ?? session.user.email ?? "user"}: ${result.cleared} task(s) unassigned, ${result.sprints} sprint(s) created, ${result.tasksAssigned} task(s) assigned, ${result.pointsPlanned} story points planned.`,
    },
  }).catch(() => {});

  return NextResponse.json({
    success: true,
    result: {
      sprintsCreated:  result.sprints,
      tasksAssigned:   result.tasksAssigned,
      pointsPlanned:   result.pointsPlanned,
      tasksCleared:    result.cleared,
    },
    message: `Replanned: ${result.sprints} sprint(s) created, ${result.tasksAssigned} task(s) assigned across ${result.pointsPlanned} story points.`,
  });
}
