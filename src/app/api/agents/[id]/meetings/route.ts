/**
 * GET  /api/agents/[id]/meetings — list recent + upcoming meetings for this agent
 * POST /api/agents/[id]/meetings — send a Recall.ai bot to a meeting URL
 *
 * Auth: session cookie OR Authorization: Bearer ptx_live_<key>
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";
import { CreditService, orgCanUseFeature } from "@/lib/credits/service";
import { CREDIT_COSTS, insufficientPlanResponse } from "@/lib/utils";
import {
  createRecallBot,
  detectPlatform,
  normaliseBotStatus,
} from "@/lib/recall-client";
import {
  createCustomBot,
  pingBotService,
} from "@/lib/custom-bot-client";

export const dynamic = "force-dynamic";
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
    select: { id: true, orgId: true, name: true },
  });
  if (!agent || agent.orgId !== caller.orgId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await req.json();
  const { meetingUrl, title, calendarEventId, joinAt, provider: requestedProvider } = body;

  if (!meetingUrl?.trim()) {
    return NextResponse.json({ error: "meetingUrl is required" }, { status: 400 });
  }

  // ── Resolve provider (recall | custom | auto) ────────────────────────────
  const [canRecall, canCustomBot] = await Promise.all([
    orgCanUseFeature(caller.orgId, "recallBot"),
    orgCanUseFeature(caller.orgId, "customBot"),
  ]);

  let provider: "recall" | "custom";
  if (requestedProvider === "recall") {
    if (!canRecall) return NextResponse.json(insufficientPlanResponse("recallBot"), { status: 403 });
    provider = "recall";
  } else if (requestedProvider === "custom") {
    if (!canCustomBot) return NextResponse.json(insufficientPlanResponse("customBot"), { status: 403 });
    provider = "custom";
  } else {
    // auto: prefer custom (cheaper) if available, fall back to Recall
    if (canCustomBot && process.env.CUSTOM_BOT_SERVICE_URL) {
      provider = "custom";
    } else if (canRecall && process.env.RECALL_API_KEY) {
      provider = "recall";
    } else {
      return NextResponse.json({
        error: "No meeting bot available. Upgrade to Starter for the custom bot or Professional for Recall.ai.",
        code: "NO_BOT_PROVIDER",
        upgradeUrl: "/billing",
      }, { status: 403 });
    }
  }

  // ── Credit cost depends on provider ─────────────────────────────────────
  const botCost = provider === "recall"
    ? CREDIT_COSTS.RECALL_BOT_PER_HOUR
    : CREDIT_COSTS.CUSTOM_BOT_PER_HOUR;

  const budgetCheck = await CreditService.checkAgentBudget(agent.id, caller.orgId, botCost);
  if (!budgetCheck.allowed) {
    return NextResponse.json({
      error: `Insufficient credits. Cost: ${botCost} credits. Balance: ${budgetCheck.orgBalance}.`,
      code: "INSUFFICIENT_CREDITS",
      upgradeUrl: "/billing",
    }, { status: 402 });
  }

  // ── Validate provider config is in place ────────────────────────────────
  if (provider === "recall" && !process.env.RECALL_API_KEY) {
    return NextResponse.json({ error: "RECALL_API_KEY not configured" }, { status: 503 });
  }
  if (provider === "custom" && !process.env.CUSTOM_BOT_SERVICE_URL) {
    return NextResponse.json({ error: "CUSTOM_BOT_SERVICE_URL not configured" }, { status: 503 });
  }

  // ── Get project context ──────────────────────────────────────────────────
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });

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
      botProvider: provider,
      status: "SCHEDULED",
      recallBotStatus: "idle",
      scheduledAt: joinAt ? new Date(joinAt) : new Date(),
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://projectoolbox.vercel.app";
  const webhookUrl = `${appUrl}/api/webhooks/meeting-transcript`;
  const botName = `${agent.name} (AI Assistant)`;

  try {
    let botId: string;
    let botStatus: string;

    if (provider === "recall") {
      const bot = await createRecallBot(meetingUrl, botName, webhookUrl, {
        joinAt: joinAt ? new Date(joinAt) : undefined,
      });
      botId = bot.id;
      botStatus = normaliseBotStatus(bot.status.code);
    } else {
      const bot = await createCustomBot(
        meeting.id, agentId, caller.orgId, meetingUrl, botName,
        { joinAt: joinAt ? new Date(joinAt) : undefined },
      );
      botId = bot.id;
      botStatus = normaliseBotStatus(bot.status.code);
    }

    await db.meeting.update({
      where: { id: meeting.id },
      data: { recallBotId: botId, recallBotStatus: botStatus, status: "SCHEDULED" },
    });

    await CreditService.deduct(
      caller.orgId, botCost,
      `${provider === "recall" ? "Recall.ai" : "Custom"} bot: "${meetingTitle}" on ${detectPlatform(meetingUrl)}`,
      agentId,
    );
    await CreditService.checkBudgetAlerts(agentId, caller.orgId);

    await db.agentActivity.create({
      data: {
        agentId,
        type: "meeting",
        summary: `${provider === "recall" ? "Recall.ai" : "Custom"} bot dispatched to "${meetingTitle}"`,
        metadata: { meetingId: meeting.id, botId, meetingUrl, provider },
      },
    });

    return NextResponse.json({
      data: {
        meetingId: meeting.id,
        botId,
        provider,
        status: botStatus,
        message: `${agent.name} will join the meeting${joinAt ? " at the scheduled time" : " shortly"} via ${provider === "recall" ? "Recall.ai" : "custom bot"}.`,
      },
    }, { status: 201 });

  } catch (e: any) {
    await db.meeting.update({
      where: { id: meeting.id },
      data: { recallBotStatus: "failed", status: "CANCELLED" },
    });
    return NextResponse.json({ error: `Failed to dispatch bot: ${e.message}` }, { status: 502 });
  }
}
