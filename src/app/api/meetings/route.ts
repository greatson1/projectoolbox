import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/meetings — List meetings for org
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation — session may still be loading" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status");

  const meetings = await db.meeting.findMany({
    where: {
      orgId,
      ...(projectId && { projectId }),
      ...(status && { status: status as any }),
    },
    include: {
      project: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, gradient: true } },
      actionItems: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Split into upcoming (SCHEDULED) and past (COMPLETED)
  const upcoming = meetings.filter(m => m.status === "SCHEDULED");
  const past = meetings.filter(m => m.status === "COMPLETED");

  return NextResponse.json({ data: { upcoming, past, all: meetings } });
}

// POST /api/meetings — Create meeting (manual or with transcript upload)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const { title, projectId, platform, scheduledAt, attendees, agentId, rawTranscript } = body;

  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  // Check credits for transcript processing
  if (rawTranscript) {
    const { CreditService } = await import("@/lib/credits/service");
    const hasCredits = await CreditService.checkBalance(orgId, 5);
    if (!hasCredits) {
      return NextResponse.json({ error: "Insufficient credits. Transcript processing costs 5 credits." }, { status: 402 });
    }
  }

  const meeting = await db.meeting.create({
    data: {
      title,
      orgId,
      projectId: projectId || null,
      platform: platform || null,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      attendees: attendees || null,
      agentId: agentId || null,
      rawTranscript: rawTranscript || null,
      status: rawTranscript ? "COMPLETED" : "SCHEDULED",
    },
    include: {
      project: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, gradient: true } },
    },
  });

  // Process transcript if provided
  if (rawTranscript) {
    try {
      const { processMeetingTranscript } = await import("@/lib/agents/meeting-processor");
      await processMeetingTranscript(meeting.id);

      const { CreditService } = await import("@/lib/credits/service");
      await CreditService.deduct(orgId, 5, `Meeting transcript processed: ${title}`);

      // Fetch updated meeting with extracted data
      const updated = await db.meeting.findUnique({
        where: { id: meeting.id },
        include: {
          project: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true, gradient: true } },
          actionItems: true,
        },
      });

      // Notify user
      await db.notification.create({
        data: {
          userId: session.user.id!,
          type: "AGENT_ALERT",
          title: `Meeting processed: ${title}`,
          body: `Transcript analysis complete. Action items, decisions, and risks have been extracted.`,
          actionUrl: `/meetings`,
        },
      });

      return NextResponse.json({ data: updated }, { status: 201 });
    } catch (e: any) {
      console.error("Transcript processing error:", e);
      return NextResponse.json({ data: meeting, error: e.message }, { status: 201 });
    }
  }

  return NextResponse.json({ data: meeting }, { status: 201 });
}
