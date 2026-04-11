/**
 * POST /api/agents/[id]/meetings/create
 *
 * Creates a new meeting (Zoom or Google Meet), saves a CalendarEvent + Meeting
 * record, dispatches the bot, and sends invite emails — all in one click.
 *
 * Body:
 *   platform      "zoom" | "meet"
 *   title         string
 *   scheduledAt   ISO 8601  (defaults to "now + 2 min")
 *   durationMins  number    (defaults to 60)
 *   invitees      string[]  array of email addresses
 *   agenda        string    (optional)
 *   autoBot       boolean   dispatch bot automatically (default true)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";
import { detectPlatform, createRecallBot, normaliseBotStatus } from "@/lib/recall-client";
import { CreditService, orgCanUseFeature } from "@/lib/credits/service";
import { CREDIT_COSTS } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { id: true, orgId: true, name: true },
  });
  if (!agent || agent.orgId !== caller.orgId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await req.json();
  const {
    platform = "zoom",
    title = "Team Meeting",
    scheduledAt,
    durationMins = 60,
    invitees = [] as string[],
    agenda = "",
    autoBot = true,
  } = body;

  const startTime = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 2 * 60 * 1000);

  // ── Create the meeting on the provider ─────────────────────────────────────
  let joinUrl: string;

  if (platform === "zoom") {
    const { createZoomMeeting, isZoomConnected } = await import("@/lib/zoom");
    const connected = await isZoomConnected(caller.orgId);
    if (!connected) {
      const { getZoomAuthUrl } = await import("@/lib/zoom");
      return NextResponse.json({
        error: "Zoom not connected",
        code: "ZOOM_NOT_CONNECTED",
        authUrl: getZoomAuthUrl(caller.orgId),
      }, { status: 403 });
    }
    const zoom = await createZoomMeeting(caller.orgId, {
      topic: title,
      startTime: startTime.toISOString(),
      duration: durationMins,
      agenda,
      invitees: invitees.map((e: string) => ({ email: e })),
    });
    if (!zoom) return NextResponse.json({ error: "Zoom meeting creation failed" }, { status: 502 });
    joinUrl = zoom.joinUrl;

  } else if (platform === "meet") {
    const { createGoogleMeet, isGoogleCalendarConnected } = await import("@/lib/google-calendar");
    const connected = await isGoogleCalendarConnected(caller.orgId);
    if (!connected) {
      return NextResponse.json({
        error: "Google Calendar not connected",
        code: "GOOGLE_NOT_CONNECTED",
        authUrl: `/api/integrations/google-calendar/connect?orgId=${caller.orgId}`,
      }, { status: 403 });
    }
    const meet = await createGoogleMeet(caller.orgId, {
      summary: title,
      startTime: startTime.toISOString(),
      endTime: new Date(startTime.getTime() + durationMins * 60000).toISOString(),
      attendees: invitees.map((e: string) => ({ email: e })),
      description: agenda,
    });
    if (!meet) return NextResponse.json({ error: "Google Meet creation failed" }, { status: 502 });
    joinUrl = meet.joinUrl;

  } else {
    return NextResponse.json({ error: "Invalid platform. Use 'zoom' or 'meet'" }, { status: 400 });
  }

  // ── Save CalendarEvent + Meeting records ────────────────────────────────────
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });

  const calEvent = await db.calendarEvent.create({
    data: {
      orgId: caller.orgId,
      agentId,
      projectId: deployment?.projectId || null,
      title,
      startTime,
      endTime: new Date(startTime.getTime() + durationMins * 60000),
      meetingUrl: joinUrl,
      attendees: invitees.map((email: string) => ({ email })),
      source: "MANUAL",
      description: agenda || null,
    },
  });

  const meeting = await db.meeting.create({
    data: {
      title,
      orgId: caller.orgId,
      agentId,
      projectId: deployment?.projectId || null,
      platform: detectPlatform(joinUrl),
      meetingUrl: joinUrl,
      calendarEventId: calEvent.id,
      scheduledAt: startTime,
      status: "SCHEDULED",
      recallBotStatus: "idle",
      botProvider: autoBot ? "recall" : null,
    },
  });

  // ── Send invite emails via agent email ──────────────────────────────────────
  if (invitees.length > 0) {
    try {
      const agentWithEmail = await db.agent.findUnique({
        where: { id: agentId },
        include: { agentEmail: true },
      });
      if (agentWithEmail?.agentEmail?.isActive) {
        const { EmailService } = await import("@/lib/email");
        const platformLabel = platform === "zoom" ? "Zoom" : "Google Meet";
        const platformColor = platform === "zoom" ? "#2D8CFF" : "#1A73E8";
        await EmailService.sendAgentEmail(agentId, {
          to: invitees,
          subject: `Meeting Invitation: ${title}`,
          html: `
            <div style="background:linear-gradient(135deg,#6366F1,#8B5CF6);padding:20px 24px;border-radius:12px 12px 0 0">
              <h1 style="color:white;margin:0;font-size:18px">📅 Meeting Invitation</h1>
            </div>
            <div style="padding:24px;background:#fff;border:1px solid #E2E8F0;border-top:0;border-radius:0 0 12px 12px">
              <h2 style="margin:0 0 12px;font-size:16px;color:#0F172A">${title}</h2>
              <table style="font-size:14px;color:#475569">
                <tr><td style="padding:4px 12px 4px 0;font-weight:600">When:</td>
                    <td>${startTime.toLocaleString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"})}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;font-weight:600">Duration:</td><td>${durationMins} minutes</td></tr>
                ${agenda ? `<tr><td style="padding:4px 12px 4px 0;font-weight:600">Agenda:</td><td>${agenda}</td></tr>` : ""}
              </table>
              <a href="${joinUrl}" style="display:inline-block;margin-top:20px;background:${platformColor};color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
                Join ${platformLabel} Meeting
              </a>
              <p style="margin-top:16px;color:#94A3B8;font-size:12px">Organised by ${agent.name} (AI Project Manager)</p>
            </div>
          `,
        });
      }
    } catch (e) {
      console.error("[create-meeting] invite email failed:", e);
    }
  }

  // ── Log agent activity ─────────────────────────────────────────────────────
  await db.agentActivity.create({
    data: {
      agentId,
      type: "meeting",
      summary: `Scheduled ${platform === "zoom" ? "Zoom" : "Google Meet"}: "${title}" · ${invitees.length} invitee(s)`,
      metadata: { meetingId: meeting.id, joinUrl, invitees, platform },
    },
  });

  // ── Dispatch bot if requested ──────────────────────────────────────────────
  let botId: string | null = null;
  let botStatus: string = "idle";

  if (autoBot) {
    try {
      const canRecall = await orgCanUseFeature(caller.orgId, "recallBot");
      const canCustom = await orgCanUseFeature(caller.orgId, "customBot" as any);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://projectoolbox.vercel.app";
      const webhookUrl = `${appUrl}/api/webhooks/meeting-transcript`;
      const botName = `${agent.name} (AI Assistant)`;

      let provider: "recall" | "custom" = "recall";
      let botCost: number = CREDIT_COSTS.RECALL_BOT_PER_HOUR;

      if (canCustom && process.env.CUSTOM_BOT_SERVICE_URL) {
        provider = "custom";
        botCost = CREDIT_COSTS.CUSTOM_BOT_PER_HOUR;
      } else if (!canRecall || !process.env.RECALL_API_KEY) {
        // No bot available — meeting created but not recorded
        await db.meeting.update({ where: { id: meeting.id }, data: { botProvider: null } });
        return NextResponse.json({
          data: { meetingId: meeting.id, calendarEventId: calEvent.id, joinUrl, botDispatched: false,
                  message: `${title} created. Upgrade to Starter or above to have ${agent.name} join automatically.` },
        }, { status: 201 });
      }

      const budgetCheck = await CreditService.checkAgentBudget(agentId, caller.orgId, botCost);
      if (!budgetCheck.allowed) {
        return NextResponse.json({
          data: { meetingId: meeting.id, calendarEventId: calEvent.id, joinUrl, botDispatched: false,
                  message: `Meeting created — insufficient credits (${budgetCheck.orgBalance}) to dispatch bot.` },
        }, { status: 201 });
      }

      if (provider === "recall") {
        const bot = await createRecallBot(joinUrl, botName, webhookUrl, {
          joinAt: scheduledAt ? new Date(scheduledAt) : undefined,
        });
        botId = bot.id;
        botStatus = normaliseBotStatus(bot.status.code);
      } else {
        const { createCustomBot } = await import("@/lib/custom-bot-client");
        const bot = await createCustomBot(meeting.id, agentId, caller.orgId, joinUrl, botName, {
          joinAt: scheduledAt ? new Date(scheduledAt) : undefined,
        });
        botId = bot.id;
        botStatus = normaliseBotStatus(bot.status.code);
      }

      await db.meeting.update({
        where: { id: meeting.id },
        data: { recallBotId: botId, recallBotStatus: botStatus, botProvider: provider, status: "SCHEDULED" },
      });

      await CreditService.deduct(
        caller.orgId, botCost,
        `${provider === "recall" ? "Recall.ai" : "Custom"} bot: "${title}"`,
        agentId,
      );

    } catch (e: any) {
      console.error("[create-meeting] bot dispatch failed:", e);
      // Meeting created successfully even if bot fails
      await db.meeting.update({ where: { id: meeting.id }, data: { recallBotStatus: "failed" } });
    }
  }

  return NextResponse.json({
    data: {
      meetingId: meeting.id,
      calendarEventId: calEvent.id,
      joinUrl,
      botId,
      botStatus,
      botDispatched: !!botId,
      message: botId
        ? `${title} created. ${agent.name} will join automatically${scheduledAt ? " at the scheduled time" : " shortly"}.`
        : `${title} created successfully. ${agent.name} was not dispatched.`,
    },
  }, { status: 201 });
}
