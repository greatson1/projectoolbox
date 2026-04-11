/**
 * Custom Bot Client — HTTP client for the VPS Playwright bot service.
 *
 * Mirrors the shape of recall-client.ts so the calling code can swap
 * providers with minimal branching.
 *
 * Env:
 *   CUSTOM_BOT_SERVICE_URL   e.g. http://187.77.182.159:3002
 *   CUSTOM_BOT_SERVICE_KEY   shared secret for X-PTX-Bot-Key header
 *   CUSTOM_BOT_WEBHOOK_SECRET  HMAC secret — the bot service signs its webhook
 *                              payloads with this; PTX verifies with it
 */

const BOT_SERVICE_URL = (process.env.CUSTOM_BOT_SERVICE_URL || "http://187.77.182.159:3002").replace(/\/$/, "");
const BOT_SERVICE_KEY = process.env.CUSTOM_BOT_SERVICE_KEY || "";

export interface CustomBot {
  id: string;
  status: { code: string };
  meeting_url: string;
  bot_name: string;
}

async function botFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BOT_SERVICE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-PTX-Bot-Key": BOT_SERVICE_KEY,
      ...(init.headers as Record<string, string>),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bot service ${res.status}: ${text}`);
  }

  const json = await res.json();
  return json.data as T;
}

/**
 * Dispatch a new Playwright bot to a meeting.
 */
export async function createCustomBot(
  meetingId: string,
  agentId: string,
  orgId: string,
  meetingUrl: string,
  botName: string,
  options?: { joinAt?: Date },
): Promise<CustomBot> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://projectoolbox.vercel.app";
  const webhookUrl = `${appUrl}/api/webhooks/meeting-transcript`;
  const webhookSecret = process.env.CUSTOM_BOT_WEBHOOK_SECRET || "";

  return botFetch<CustomBot>("/bots", {
    method: "POST",
    body: JSON.stringify({
      meetingId,
      agentId,
      orgId,
      meetingUrl,
      botName,
      webhookUrl,
      webhookSecret,
      joinAt: options?.joinAt?.toISOString(),
    }),
  });
}

/**
 * Get the current status of a custom bot.
 */
export async function getCustomBot(botId: string): Promise<CustomBot> {
  return botFetch<CustomBot>(`/bots/${botId}`);
}

/**
 * Remove the bot from the meeting.
 */
export async function deleteCustomBot(botId: string): Promise<void> {
  await botFetch<{ message: string }>(`/bots/${botId}`, { method: "DELETE" });
}

/**
 * Check if the custom bot service is reachable.
 */
export async function pingBotService(): Promise<boolean> {
  try {
    const res = await fetch(`${BOT_SERVICE_URL}/health`, {
      headers: { "X-PTX-Bot-Key": BOT_SERVICE_KEY },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
