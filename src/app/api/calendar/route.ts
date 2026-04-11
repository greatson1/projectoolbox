import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/calendar — List calendar events
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const range = searchParams.get("range") || "week"; // today, week, month

  const now = new Date();
  let startDate = new Date(now);
  let endDate = new Date(now);

  switch (range) {
    case "today":
      endDate.setHours(23, 59, 59, 999);
      break;
    case "week":
      startDate.setDate(startDate.getDate() - 1); // include yesterday
      endDate.setDate(endDate.getDate() + 7);
      break;
    case "month":
      startDate.setDate(1);
      endDate.setMonth(endDate.getMonth() + 1, 0);
      break;
  }

  const events = await db.calendarEvent.findMany({
    where: {
      orgId,
      ...(projectId && { projectId }),
      startTime: { gte: startDate, lte: endDate },
    },
    include: {
      project: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, gradient: true } },
    },
    orderBy: { startTime: "asc" },
  });

  // Identify events needing pre-meeting briefs (within next 2 hours, no brief yet)
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const needsBrief = events.filter(e =>
    e.startTime >= now && e.startTime <= twoHoursFromNow && !e.preAgenda && e.projectId
  );

  return NextResponse.json({ data: { events, needsBrief } });
}

// POST /api/calendar — Create calendar event
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const { title, description, startTime, endTime, projectId, agentId, meetingUrl, attendees, generateBrief } = body;

  if (!title || !startTime) {
    return NextResponse.json({ error: "Title and start time are required" }, { status: 400 });
  }

  const event = await db.calendarEvent.create({
    data: {
      orgId,
      title,
      description: description || null,
      startTime: new Date(startTime),
      endTime: endTime ? new Date(endTime) : null,
      projectId: projectId || null,
      agentId: agentId || null,
      meetingUrl: meetingUrl || null,
      attendees: attendees || null,
      source: "MANUAL",
    },
    include: {
      project: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, gradient: true } },
    },
  });

  // Generate pre-meeting brief if requested and project is linked
  if (generateBrief && projectId) {
    try {
      const { generatePreMeetingBrief } = await import("@/lib/agents/meeting-processor");
      await generatePreMeetingBrief(event.id);
    } catch (e) {
      console.error("Pre-meeting brief error:", e);
    }
  }

  return NextResponse.json({ data: event }, { status: 201 });
}
