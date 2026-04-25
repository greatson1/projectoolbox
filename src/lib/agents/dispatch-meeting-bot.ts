/**
 * dispatchMeetingBot — single source of truth for sending a recording bot
 * to a scheduled meeting. Both /api/agents/[id]/meetings/create (agent's
 * own Meetings tab) and lib/zoom.ts (Calendar UI's "Schedule via Zoom"
 * flow) call this so every future project gets the same behaviour:
 *
 *   1. Try the self-hosted Custom bot first if it's configured. It's
 *      cheaper and we own the failure modes.
 *   2. If Custom is unavailable / errors out, fall back to Recall.ai.
 *   3. If neither is reachable, return a structured "skipped" reason
 *      so the caller can surface a useful message to the user instead
 *      of a generic "was not dispatched".
 *
 * The result object is intentionally rich: callers can render the exact
 * reason ("custom bot service 502", "Recall API key missing", "no bot
 * services configured") rather than a vague "failed".
 */

import { db } from "@/lib/db";

export type BotDispatchResult =
  | {
      dispatched: true;
      provider: "custom" | "recall";
      botId: string;
      botStatus: string;
      message: string;
    }
  | {
      dispatched: false;
      provider: null;
      reason:
        | "no_services_configured"
        | "custom_bot_failed"
        | "recall_failed"
        | "all_providers_failed"
        | "unknown_error";
      detail: string;
      errors: { provider: "custom" | "recall"; error: string }[];
      message: string;
    };

interface DispatchInput {
  meetingId: string;
  agentId: string;
  orgId: string;
  agentName: string;
  joinUrl: string;
  scheduledAt?: Date | string | null;
}

const APP_URL_FALLBACK = "https://projectoolbox.vercel.app";

export async function dispatchMeetingBot(input: DispatchInput): Promise<BotDispatchResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || APP_URL_FALLBACK;
  const webhookUrl = `${appUrl}/api/webhooks/meeting-transcript`;
  const botName = `${input.agentName} (AI Assistant)`;
  const joinAt = input.scheduledAt ? new Date(input.scheduledAt) : undefined;

  const haveCustom = !!process.env.CUSTOM_BOT_SERVICE_URL && !!process.env.CUSTOM_BOT_SERVICE_KEY;
  const haveRecall = !!process.env.RECALL_API_KEY;

  if (!haveCustom && !haveRecall) {
    return {
      dispatched: false,
      provider: null,
      reason: "no_services_configured",
      detail: "Neither CUSTOM_BOT_SERVICE_URL nor RECALL_API_KEY is set on this deployment.",
      errors: [],
      message: `${input.agentName} cannot join automatically — no recording bot is configured for this organisation.`,
    };
  }

  const errors: { provider: "custom" | "recall"; error: string }[] = [];

  // 1. Try the self-hosted Custom bot first.
  if (haveCustom) {
    try {
      const { createCustomBot } = await import("@/lib/custom-bot-client");
      const bot = await createCustomBot(input.meetingId, input.agentId, input.orgId, input.joinUrl, botName, { joinAt });
      const { normaliseBotStatus } = await import("@/lib/recall-client");
      const status = normaliseBotStatus(bot.status.code);
      await db.meeting.update({
        where: { id: input.meetingId },
        data: { recallBotId: bot.id, recallBotStatus: status, botProvider: "custom", status: "SCHEDULED" },
      }).catch(() => {});
      return {
        dispatched: true,
        provider: "custom",
        botId: bot.id,
        botStatus: status,
        message: `${input.agentName} will join automatically${joinAt ? " at the scheduled time" : " shortly"}.`,
      };
    } catch (e: any) {
      const errMsg = String(e?.message ?? e ?? "unknown error").slice(0, 240);
      errors.push({ provider: "custom", error: errMsg });
      console.error("[dispatchMeetingBot] custom bot failed:", errMsg);
    }
  }

  // 2. Fall back to Recall.ai.
  if (haveRecall) {
    try {
      const { createRecallBot, normaliseBotStatus } = await import("@/lib/recall-client");
      const bot = await createRecallBot(input.joinUrl, botName, webhookUrl, { joinAt });
      const status = normaliseBotStatus(bot.status.code);
      await db.meeting.update({
        where: { id: input.meetingId },
        data: { recallBotId: bot.id, recallBotStatus: status, botProvider: "recall", status: "SCHEDULED" },
      }).catch(() => {});
      return {
        dispatched: true,
        provider: "recall",
        botId: bot.id,
        botStatus: status,
        message: `${input.agentName} will join via Recall.ai${joinAt ? " at the scheduled time" : " shortly"}.`,
      };
    } catch (e: any) {
      const errMsg = String(e?.message ?? e ?? "unknown error").slice(0, 240);
      errors.push({ provider: "recall", error: errMsg });
      console.error("[dispatchMeetingBot] Recall.ai failed:", errMsg);
    }
  }

  // 3. Both providers attempted (or only one was configured) — neither worked.
  await db.meeting.update({
    where: { id: input.meetingId },
    data: { recallBotStatus: "failed" },
  }).catch(() => {});

  // The reason union lives on the `dispatched: false` branch only — narrow
  // the type with a local annotation.
  type FailureReason = Extract<BotDispatchResult, { dispatched: false }>["reason"];
  const reason: FailureReason = errors.length > 1
    ? "all_providers_failed"
    : errors[0]?.provider === "custom"
      ? "custom_bot_failed"
      : errors[0]?.provider === "recall"
        ? "recall_failed"
        : "unknown_error";

  const detail = errors.map((e) => `${e.provider}: ${e.error}`).join(" · ") || "no providers attempted";

  return {
    dispatched: false,
    provider: null,
    reason,
    detail,
    errors,
    message: `${input.agentName} could not join the meeting (${detail}). The meeting was created — you can still join, but no transcript will be captured.`,
  };
}
