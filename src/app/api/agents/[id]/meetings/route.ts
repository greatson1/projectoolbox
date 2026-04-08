/**
 * GET  /api/agents/[id]/meetings — list recent + upcoming meetings for this agent
 * POST /api/agents/[id]/meetings — send a Recall.ai bot to a meeting URL
 *
 * Auth: session cookie OR Authorization: Bearer ptx_live_<key>
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";
import {
  createRecallBot,
  detectPlatform,
  normaliseBotStatus,
} from "@/lib/recall-client";

export const maxDuration = 30;

// ── GET — list meetings ───────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;

  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
  if (!agent || agent.orgId !== caller.orgId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Get meetings for this agent (last 30 days + future)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [meetings, calendarEvents] = await Promise.all([
    db.meeting.findMany({
      where: { agentId, orgId: caller.orgId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, title: true, platform: true, status: true,
        scheduledAt: true, endedAt: true, duration: true,
        recallBotId: true, recallBotStatus: true, meetingUrl: true,
        summary: true, confidence: true, processedAt: true,
        calendarEventId: true, createdAt: true,
        actionItems: { select: { id: true, text: true, status: true }, take: 5 },
      },
    }),
    db.calendarEvent.findMany({
      where: {
        agentId,
        orgId: caller.orgId,
        startTime: { gte: new Date() },
      },
      orderBy: { startTime: "asc" },
      take: 10,
      select: {
        id: true, title: true, startTime: true, endTime: true,
        meetingUrl: true, attendees: true, location: true,
      },
    }),
  ]);

  return NextResponse.json({ data: { meetings, upcomingEvents: calendarEvents } });
}

// ── POST — send bot to meeting ────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { orgId: true, name: true },
  });
  if (!agent || agent.orgId !== caller.orgId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await req.json();
  const { meetingUrl, title, calendarEventId, joinAt } = body;

  if (!meetingUrl?.trim()) {
    return NextResponse.json({ error: "meetingUrl is required" }, { status: 400 });
  }

  // Check Recall is configured
  if (!process.env.RECALL_API_KEY) {
    return NextResponse.json(
      { error: "RECALL_API_KEY not configured — add it in Vercel environment variables" },
      { status: 503 },
    );
  }

  // Get project for this agent
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });

  // Create Meeting record first so we have an ID for the webhook lookup
  const meetingTitle = title || (calendarEventId
    ? (await db.calendarEvent.findUnique({ where: { id: calendarEventId }, select: { title: true } }))?.title
    : null) || "Meeting";

  const meeting = await db.meeting.create({
    data: {
      title: meetingTitle,
      orgId: caller.orgId,
      agentId,
      projectId: deployment?.projectId || null,
      platform: detectPlatform(meetingUrl),
      meetingUrl,
      calendarEventId: calendarEventId || null,
      status: "SCHEDULED",
      recallBotStatus: "idle",
      scheduledAt: joinAt ? new Date(joinAt) : new Date(),
    },
  });

  // Build the webhook URL for Recall to call us back
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://projectoolbox.com";
  const webhookUrl = `${appUrl}/api/webhooks/meeting-transcript`;

  try {
    const bot = await createRecallBot(
      meetingUrl,
      `${agent.name} (AI Assistant)`,
      webhookUrl,
      { joinAt: joinAt ? new Date(joinAt) : undefined },
    );

    // Store the bot ID so the webhook can find this meeting
    await db.meeting.update({
      where: { id: meeting.id },
      data: {
        recallBotId: bot.id,
        recallBotStatus: normaliseBotStatus(bot.status.code),
        status: "SCHEDULED",
      },
    });

    // Log activity
    await db.agentActivity.create({
      data: {
        agentId,
        type: "meeting",
        summary: `Meeting bot dispatched to "${meetingTitle}" on ${detectPlatform(meetingUrl)}`,
        metadata: { meetingId: meeting.id, botId: bot.id, meetingUrl },
      },
    });

    return NextResponse.json({
      data: {
        meetingId: meeting.id,
        botId: bot.id,
        status: normaliseBotStatus(bot.status.code),
        message: `${agent.name} will join the meeting${joinAt ? " at the scheduled time" : " shortly"}.`,
      },
    }, { status: 201 });

  } catch (e: any) {
    // Clean up the meeting record if bot creation failed
    await db.meeting.update({
      where: { id: meeting.id },
      data: { recallBotStatus: "failed", status: "CANCELLED" },
    });

    return NextResponse.json(
      { error: `Failed to dispatch bot: ${e.message}` },
      { status: 502 },
    );
  }
}
