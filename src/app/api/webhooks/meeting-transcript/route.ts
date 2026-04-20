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
import { isN8nEnabled, forwardToN8n } from "@/lib/n8n";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.text();

  // ── n8n forwarding gate ──────────────────────────────────────────
  if (await isN8nEnabled("meeting_transcript")) {
    try {
      const payload = JSON.parse(body);
      const forwarded = await forwardToN8n("meeting_transcript", {
        event: payload.event || payload.data?.event,
        botId: payload.data?.bot_id || payload.botId,
        meetingUrl: payload.data?.meeting_url,
        transcript: payload.transcript,
        source: req.headers.get("x-ptx-bot-source") || "recall",
      });
      if (forwarded) {
        return NextResponse.json({ status: "forwarded_to_n8n" });
      }
    } catch {
      // If JSON parse fails, fall through to existing logic
    }
  }
  const { createHmac } = await import("crypto");

  // Determine source: custom bot vs Recall.ai
  const botSource = req.headers.get("x-ptx-bot-source"); // "custom" or null

  if (botSource === "custom") {
    // ── Custom bot signature verification ──────────────────────────────────
    const customSecret = process.env.CUSTOM_BOT_WEBHOOK_SECRET;
    if (customSecret) {
      const sig = req.headers.get("x-ptx-signature") || "";
      const expected = createHmac("sha256", customSecret).update(body).digest("hex");
      if (sig !== expected) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }
    const payload = JSON.parse(body);
    return handlePayload(payload, "custom");
  }

  // ── Recall.ai signature verification ─────────────────────────────────────
  const recallSecret = process.env.RECALL_WEBHOOK_SECRET;
  if (recallSecret) {
    const sig = req.headers.get("x-recall-signature") || "";
    const expected = createHmac("sha256", recallSecret).update(body).digest("hex");
    if (sig !== expected) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const payload = JSON.parse(body);
  return handlePayload(payload, "recall");
}

async function handlePayload(payload: any, source: "recall" | "custom" = "recall") {
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

  // ── bot.joining_call — status update only (already handled above) ─────────
  // ── bot.in_call_not_recording — status update only ────────────────────────
  // ── bot.in_call_recording — update to SCHEDULED→IN_PROGRESS ─────────────
  if (event === "bot.in_call_recording") {
    await db.meeting.updateMany({
      where: { recallBotId: botId },
      data: { status: "IN_PROGRESS", recallBotStatus: "recording" },
    });
  }

  // ── bot.call_ended — call has ended, transcript will follow ───────────────
  if (event === "bot.call_ended") {
    await db.meeting.updateMany({
      where: { recallBotId: botId },
      data: { recallBotStatus: "processing", endedAt: new Date() },
    });
  }

  // ── bot.recording_permission_denied — host blocked the bot ───────────────
  if (event === "bot.recording_permission_denied") {
    await db.meeting.updateMany({
      where: { recallBotId: botId },
      data: { recallBotStatus: "failed", status: "CANCELLED" },
    });

    const meeting = await db.meeting.findFirst({ where: { recallBotId: botId } });
    if (meeting) {
      const admins = await db.user.findMany({
        where: { orgId: meeting.orgId, role: { in: ["OWNER", "ADMIN", "MEMBER"] } },
        select: { id: true },
      });
      for (const admin of admins) {
        await db.notification.create({
          data: {
            userId: admin.id,
            type: "AGENT_ALERT",
            title: `Recording blocked: ${meeting.title}`,
            body: `The meeting host denied recording permission for "${meeting.title}". No transcript was captured.`,
            actionUrl: `/agents/${meeting.agentId}?tab=meetings`,
          },
        });
      }
      if (meeting.agentId) {
        await db.agentActivity.create({
          data: {
            agentId: meeting.agentId,
            type: "meeting",
            summary: `Recording permission denied by host for "${meeting.title}"`,
            metadata: { meetingId: meeting.id, botId },
          },
        });
      }
    }
  }

  // ── bot.recording_permission_allowed — confirmed recording ───────────────
  if (event === "bot.recording_permission_allowed") {
    await db.meeting.updateMany({
      where: { recallBotId: botId },
      data: { recallBotStatus: "recording", status: "IN_PROGRESS" },
    });
  }

  // ── bot.in_waiting_room — bot is waiting to be admitted ──────────────────
  if (event === "bot.in_waiting_room") {
    await db.meeting.updateMany({
      where: { recallBotId: botId },
      data: { recallBotStatus: "waiting" },
    });
  }

  // ── bot.waiting_room_timeout — bot gave up waiting ───────────────────────
  if (event === "bot.waiting_room_timeout") {
    await db.meeting.updateMany({
      where: { recallBotId: botId },
      data: { recallBotStatus: "failed", status: "CANCELLED" },
    });

    const meeting = await db.meeting.findFirst({ where: { recallBotId: botId } });
    if (meeting) {
      const admins = await db.user.findMany({
        where: { orgId: meeting.orgId, role: { in: ["OWNER", "ADMIN", "MEMBER"] } },
        select: { id: true },
      });
      for (const admin of admins) {
        await db.notification.create({
          data: {
            userId: admin.id,
            type: "AGENT_ALERT",
            title: `Bot timed out: ${meeting.title}`,
            body: `The meeting bot for "${meeting.title}" timed out in the waiting room and was never admitted.`,
            actionUrl: `/agents/${meeting.agentId}?tab=meetings`,
          },
        });
      }
    }
  }

  // ── bot.participant_events — track attendees ──────────────────────────────
  if (event === "bot.participant_events") {
    const participants = payload.data?.participants as Array<{ name: string; events: Array<{ event: string; timestamp: string }> }> | undefined;
    if (participants?.length) {
      const meeting = await db.meeting.findFirst({ where: { recallBotId: botId } });
      if (meeting) {
        // Store participant list in meeting metadata via summary field supplement
        // (full participant tracking would need a dedicated table — stored as metadata for now)
        const names = participants.map(p => p.name).filter(Boolean);
        if (meeting.agentId) {
          await db.agentActivity.create({
            data: {
              agentId: meeting.agentId,
              type: "meeting",
              summary: `Participants in "${meeting.title}": ${names.join(", ")}`,
              metadata: { meetingId: meeting.id, participants },
            },
          });
        }
      }
    }
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

      // Fetch or extract transcript depending on provider
      let utterances: Awaited<ReturnType<typeof getRecallTranscript>>;
      let rawTranscript: string;

      if (source === "custom") {
        // Custom bot embeds the full transcript in the webhook payload
        const embedded = payload.data?.transcript as Array<{ speaker: string; text: string; start_time: number; end_time: number }> | undefined;
        if (embedded?.length) {
          // Convert to Recall-compatible utterance shape so formatTranscript works
          utterances = embedded.map(u => ({
            speaker: u.speaker,
            words: [{ text: u.text, start_time: u.start_time, end_time: u.end_time, confidence: 1 }],
          }));
          rawTranscript = embedded.map(u => `${u.speaker}: ${u.text}`).join("\n");
        } else {
          utterances = [];
          rawTranscript = "";
        }
      } else {
        // Recall.ai — fetch from Recall API
        utterances = await getRecallTranscript(botId);
        rawTranscript = formatTranscript(utterances);
      }

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

      // Credit cost: custom bot charges Whisper per-minute; Recall charges flat processing fee
      const { CREDIT_COSTS } = await import("@/lib/utils");
      const processingCost = source === "custom"
        ? (durationMinutes ?? 1) * CREDIT_COSTS.WHISPER_PER_MINUTE
        : CREDIT_COSTS.MEETING_PROCESSING;

      // Run AI processing (extracts decisions, risks, action items → KB)
      if (meeting.org.creditBalance >= processingCost) {
        const { processMeetingTranscript } = await import("@/lib/agents/meeting-processor");
        await processMeetingTranscript(meeting.id);

        const { CreditService } = await import("@/lib/credits/service");
        const providerLabel = source === "custom" ? "Custom bot" : "Recall.ai";
        await CreditService.deduct(
          meeting.orgId,
          processingCost,
          `${providerLabel} transcript processed: ${meeting.title}`,
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
