import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { dispatchMeetingBot } from "@/lib/agents/dispatch-meeting-bot";

export const dynamic = "force-dynamic";

/**
 * POST /api/meetings/:id/redispatch-bot
 *
 * Manually retry dispatching the recording bot for a meeting whose original
 * dispatch failed (recallBotStatus === "failed" or null). Used by the
 * "Retry bot dispatch" button on the Calendar event detail view so users
 * can recover from transient provider outages without recreating the meeting.
 *
 * Returns the structured BotDispatchResult so the UI can show the actual
 * provider/error if it fails again.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { id } = await params;

  const meeting = await db.meeting.findFirst({
    where: { id, orgId },
    include: { agent: { select: { id: true, name: true } } },
  });
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (!meeting.meetingUrl) {
    return NextResponse.json({ error: "Meeting has no join URL — cannot dispatch a bot" }, { status: 400 });
  }
  if (!meeting.agent) {
    return NextResponse.json({ error: "Meeting has no agent — cannot dispatch a bot" }, { status: 400 });
  }
  if (meeting.recallBotStatus && !["failed", "idle"].includes(meeting.recallBotStatus)) {
    return NextResponse.json(
      { error: `Bot is already ${meeting.recallBotStatus} — won't redispatch.` },
      { status: 400 },
    );
  }

  const result = await dispatchMeetingBot({
    meetingId: meeting.id,
    agentId: meeting.agent.id,
    orgId: meeting.orgId,
    agentName: meeting.agent.name,
    joinUrl: meeting.meetingUrl,
    scheduledAt: meeting.scheduledAt,
  });

  return NextResponse.json({ data: result });
}
