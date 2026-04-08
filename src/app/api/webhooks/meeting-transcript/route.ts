/**
 * POST /api/webhooks/meeting-transcript
 *
 * Recall.ai fires this endpoint for two event types:
 *
 *   1. Bot status changes  (bot.joining_call, bot.in_call_recording, bot.done, bot.fatal …)
 *   2. Real-time transcript chunks  (transcript.data)
 *
 * On `bot.done` we fetch the full transcript from Recall, store it on the
 * Meeting record, and run processMeetingTranscript so the agent's KB is
 * updated immediately.
 *
 * Recall docs: https://docs.recall.ai/docs/webhooks
 *
 * Env: RECALL_WEBHOOK_SECRET (optional but recommended) — used to verify
 *      the X-Recall-Signature header.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getRecallTranscript,
  formatTranscript,
  normaliseBotStatus,
} from "@/lib/recall-client";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // ── Optional signature verification ──────────────────────────────────────
  const secret = process.env.RECALL_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-recall-signature") || "";
    // Recall uses HMAC-SHA256 of the raw body
    const body = await req.text();
    const { createHmac } = await import("crypto");
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    if (sig !== expected) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    // Re-parse since we consumed the stream
    const payload = JSON.parse(body);
    return handlePayload(payload);
  }

  const payload = await req.json();
  return handlePayload(payload);
}

async function handlePayload(payload: any) {
  const event = payload.event || payload.type;
  const botId = payload.data?.bot_id || payload.bot_id;

  if (!botId) return NextResponse.json({ ok: true }); // ignore malformed

  // ── Update bot status on every event ─────────────────────────────────────
  const statusCode = payload.data?.status?.code || payload.status?.code;
  if (statusCode) {
    const dbStatus = normaliseBotStatus(statusCode);
    await db.meeting.updateMany({
      where: { recallBotId: botId },
      data: { recallBotStatus: dbStatus },
    });
  }

  // ── bot.done — fetch transcript and process ───────────────────────────────
  if (event === "bot.done" || statusCode === "done") {
    try {
      const meeting = await db.meeting.findFirst({
        where: { recallBotId: botId },
        include: {
          org: { select: { creditBalance: true } },
        },
      });

      if (!meeting) {
        console.warn(`[Recall webhook] No meeting found for bot ${botId}`);
        return NextResponse.json({ ok: true });
      }

      // Fetch full transcript from Recall
      const utterances = await getRecallTranscript(botId);
      const rawTranscript = formatTranscript(utterances);

      if (!rawTranscript.trim()) {
        await db.meeting.update({
          where: { id: meeting.id },
          data: { recallBotStatus: "done", status: "COMPLETED", summary: "No transcript content — meeting may have had no audio." },
        });
        return NextResponse.json({ ok: true });
      }

      // Calculate duration from utterances
      const lastWord = utterances.at(-1)?.words.at(-1);
      const durationMinutes = lastWord ? Math.ceil(lastWord.end_time / 60) : null;

      // Store raw transcript
      await db.meeting.update({
        where: { id: meeting.id },
        data: {
          rawTranscript,
          status: "IN_PROGRESS",
          recallBotStatus: "done",
          endedAt: new Date(),
          duration: durationMinutes,
        },
      });

      // Run AI processing (extracts decisions, risks, action items → KB)
      if (meeting.org.creditBalance >= 5) {
        const { processMeetingTranscript } = await import("@/lib/agents/meeting-processor");
        await processMeetingTranscript(meeting.id);

        const { CreditService } = await import("@/lib/credits/service");
        await CreditService.deduct(
          meeting.orgId,
          5,
          `Recall.ai transcript processed: ${meeting.title}`,
        );
      } else {
        // No credits — store transcript but skip AI processing
        await db.meeting.update({
          where: { id: meeting.id },
          data: { status: "COMPLETED" },
        });
      }

      // Notify org users
      const admins = await db.user.findMany({
        where: { orgId: meeting.orgId, role: { in: ["OWNER", "ADMIN", "MEMBER"] } },
        select: { id: true },
      });
      for (const admin of admins) {
        await db.notification.create({
          data: {
            userId: admin.id,
            type: "AGENT_ALERT",
            title: `Meeting transcript ready: ${meeting.title}`,
            body: `Your agent has transcribed "${meeting.title}" and updated the knowledge base.`,
            actionUrl: `/agents/${meeting.agentId}?tab=knowledge`,
          },
        });
      }

    } catch (e: any) {
      console.error("[Recall webhook] bot.done processing failed:", e);
      await db.meeting.updateMany({
        where: { recallBotId: botId },
        data: { recallBotStatus: "failed" },
      });
    }
  }

  // ── bot.fatal — mark as failed ────────────────────────────────────────────
  if (event === "bot.fatal" || statusCode === "fatal") {
    await db.meeting.updateMany({
      where: { recallBotId: botId },
      data: { recallBotStatus: "failed", status: "CANCELLED" },
    });

    // Log agent activity
    const meeting = await db.meeting.findFirst({ where: { recallBotId: botId } });
    if (meeting?.agentId) {
      const reason = payload.data?.status?.message || "Unknown error";
      await db.agentActivity.create({
        data: {
          agentId: meeting.agentId,
          type: "meeting",
          summary: `Meeting bot failed for "${meeting.title}": ${reason}`,
        },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
