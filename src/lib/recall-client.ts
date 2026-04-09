/**
 * Recall.ai API client
 *
 * Recall.ai is a universal meeting bot SDK — it handles joining Zoom, Teams,
 * and Google Meet as a participant, recording audio, and returning a transcript.
 *
 * Docs: https://docs.recall.ai/reference
 *
 * Required env vars:
 *   RECALL_API_KEY     — your Recall.ai API key
 *   RECALL_REGION      — "us-west-2" (default) or "eu-central-1"
 *   NEXT_PUBLIC_APP_URL — base URL for the webhook callback
 */

const RECALL_BASE = `https://${process.env.RECALL_REGION || "us-west-2"}.recall.ai/api/v1`;
const RECALL_KEY = process.env.RECALL_API_KEY || "";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecallBot {
  id: string;
  status: {
    code:
      | "ready"
      | "joining_call"
      | "in_waiting_room"
      | "in_call_not_recording"
      | "in_call_recording"
      | "call_ended"
      | "done"
      | "fatal";
    message?: string;
  };
  meeting_url: string;
  bot_name: string;
  join_at: string | null;
}

export interface RecallTranscriptUtterance {
  speaker: string;
  words: { text: string; start_time: number; end_time: number; confidence: number }[];
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

async function recallFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!RECALL_KEY) throw new Error("RECALL_API_KEY not configured");

  const res = await fetch(`${RECALL_BASE}${path}`, {
    ...options,
    headers: {
      "Authorization": `Token ${RECALL_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall.ai ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a bot to join a meeting URL.
 * The bot will transcribe the call and fire a webhook when done.
 */
export async function createRecallBot(
  meetingUrl: string,
  botName: string,
  webhookUrl: string,
  options?: {
    joinAt?: Date;          // schedule for a future time (ISO)
    transcriptLanguage?: string; // e.g. "en"
    recordVideo?: boolean;
  },
): Promise<RecallBot> {
  return recallFetch<RecallBot>("/bot/", {
    method: "POST",
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: botName,
      // Real-time transcript events + done webhook
      transcription_options: {
        provider: "assembly_ai",
        language: options?.transcriptLanguage || "en",
      },
      real_time_transcription: {
        destination_url: webhookUrl,
        partial_results: false,
      },
      // Also fire a webhook when the bot is fully done
      webhook: {
        url: webhookUrl,
        events: [
          "bot.joining_call",
          "bot.in_waiting_room",
          "bot.in_call_not_recording",
          "bot.in_call_recording",
          "bot.recording_permission_allowed",
          "bot.recording_permission_denied",
          "bot.waiting_room_timeout",
          "bot.call_ended",
          "bot.done",
          "bot.fatal",
          "bot.participant_events",
        ],
      },
      ...(options?.joinAt && { join_at: options.joinAt.toISOString() }),
      automatic_video_output: { in_call_recording: { kind: "webpage" } },
      automatic_leave: {
        silence_detection: { timeout: 600, activate_after: 120 }, // leave after 10 min silence
        everyone_left_timeout: 2,
        noone_joined_timeout: 600,
      },
    }),
  });
}

/**
 * Fetch the current bot status.
 */
export async function getRecallBot(botId: string): Promise<RecallBot> {
  return recallFetch<RecallBot>(`/bot/${botId}/`);
}

/**
 * Remove the bot from a meeting immediately.
 */
export async function deleteRecallBot(botId: string): Promise<void> {
  await recallFetch<void>(`/bot/${botId}/`, { method: "DELETE" });
}

/**
 * Fetch the full transcript after the bot is done.
 * Returns utterances sorted by start time.
 */
export async function getRecallTranscript(
  botId: string,
): Promise<RecallTranscriptUtterance[]> {
  const data = await recallFetch<{ results: RecallTranscriptUtterance[] }>(
    `/bot/${botId}/transcript/`,
  );
  return data.results || [];
}

/**
 * Convert Recall utterances into a readable transcript string.
 * Format: "Speaker Name: text\n"
 */
export function formatTranscript(
  utterances: RecallTranscriptUtterance[],
): string {
  return utterances
    .map(u => {
      const text = u.words.map(w => w.text).join(" ");
      return `${u.speaker}: ${text}`;
    })
    .join("\n");
}

/**
 * Map Recall bot status code → our DB status string.
 */
export function normaliseBotStatus(
  code: RecallBot["status"]["code"] | string,
): string {
  switch (code) {
    case "ready":
    case "joining_call":          return "joining";
    case "in_waiting_room":       return "waiting";
    case "in_call_not_recording": return "joined";
    case "in_call_recording":     return "recording";
    case "call_ended":            return "processing";
    case "done":                  return "done";
    case "fatal":                 return "failed";
    default:                      return "joining";
  }
}

/**
 * Detect the meeting platform from the URL.
 */
export function detectPlatform(meetingUrl: string): string {
  if (/zoom\.us/i.test(meetingUrl))   return "zoom";
  if (/teams\.microsoft/i.test(meetingUrl)) return "teams";
  if (/meet\.google/i.test(meetingUrl)) return "meet";
  if (/webex/i.test(meetingUrl))      return "webex";
  return "other";
}
