/**
 * GET    /api/agents/[id]/meetings/[meetingId] — poll bot status
 * DELETE /api/agents/[id]/meetings/[meetingId] — remove bot from meeting
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";
import { getRecallBot, deleteRecallBot, normaliseBotStatus } from "@/lib/recall-client";

export const dynamic = "force-dynamic";

// ── GET — poll current bot status ─────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId, meetingId } = await params;

  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, agentId, orgId: caller.orgId },
    select: {
      id: true, title: true, status: true, recallBotId: true,
      recallBotStatus: true, duration: true, summary: true,
      processedAt: true, actionItems: { select: { id: true, text: true, status: true } },
    },
  });

  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If bot is active, sync status from Recall
  if (meeting.recallBotId && !["done", "failed"].includes(meeting.recallBotStatus || "")) {
    try {
      const bot = await getRecallBot(meeting.recallBotId);
      const fresh = normaliseBotStatus(bot.status.code);
      if (fresh !== meeting.recallBotStatus) {
        await db.meeting.update({
          where: { id: meetingId },
          data: { recallBotStatus: fresh },
        });
        meeting.recallBotStatus = fresh;
      }
    } catch {}
  }

  return NextResponse.json({ data: meeting });
}

// ── DELETE — kick bot out of meeting ─────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId, meetingId } = await params;

  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, agentId, orgId: caller.orgId },
    select: { recallBotId: true, title: true },
  });

  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (meeting.recallBotId) {
    try {
      await deleteRecallBot(meeting.recallBotId);
    } catch {}
  }

  await db.meeting.update({
    where: { id: meetingId },
    data: { recallBotStatus: "failed", status: "CANCELLED" },
  });

  await db.agentActivity.create({
    data: {
      agentId,
      type: "meeting",
      summary: `Meeting bot removed from "${meeting.title}"`,
    },
  });

  return NextResponse.json({ data: { cancelled: true } });
}
