import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/meetings/schedule — Agent schedules a Zoom meeting
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const { title, startTime, duration, projectId, agentId, invitees, agenda } = body;

  if (!title || !startTime) {
    return NextResponse.json({ error: "Title and start time are required" }, { status: 400 });
  }

  // Use first active agent if none specified
  let targetAgentId = agentId;
  if (!targetAgentId) {
    const { db } = await import("@/lib/db");
    const agent = await db.agent.findFirst({
      where: { orgId, status: "ACTIVE" },
      select: { id: true },
    });
    targetAgentId = agent?.id;
  }

  if (!targetAgentId) {
    return NextResponse.json({ error: "No active agent found" }, { status: 400 });
  }

  const { agentScheduleZoomMeeting } = await import("@/lib/zoom");
  const result = await agentScheduleZoomMeeting(targetAgentId, {
    title,
    startTime,
    duration: duration || 60,
    projectId: projectId || undefined,
    invitees: invitees || [],
    agenda: agenda || undefined,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    data: {
      joinUrl: result.joinUrl,
      botDispatched: result.botDispatched ?? false,
      botProvider: result.botProvider ?? null,
    },
  }, { status: 201 });
}
