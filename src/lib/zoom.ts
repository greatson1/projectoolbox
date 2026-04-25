import { db } from "@/lib/db";

const ZOOM_AUTH_URL = "https://zoom.us/oauth/authorize";
const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_API_URL = "https://api.zoom.us/v2";

function getClientId() { return process.env.ZOOM_CLIENT_ID || ""; }
function getClientSecret() { return process.env.ZOOM_CLIENT_SECRET || ""; }
function getRedirectUri() {
  return process.env.ZOOM_REDIRECT_URI || "https://projectoolbox.com/api/integrations/zoom/callback";
}

/**
 * Generate Zoom OAuth authorization URL.
 * User clicks this to grant meeting creation access.
 */
export function getZoomAuthUrl(orgId: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    state: orgId, // pass orgId to associate token with org
  });
  return `${ZOOM_AUTH_URL}?${params}`;
}

/**
 * Exchange authorization code for access + refresh tokens.
 */
export async function exchangeZoomCode(code: string, orgId: string): Promise<boolean> {
  const auth = Buffer.from(`${getClientId()}:${getClientSecret()}`).toString("base64");

  const response = await fetch(ZOOM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(),
    }),
  });

  if (!response.ok) {
    console.error("Zoom token exchange failed:", await response.text());
    return false;
  }

  const data = await response.json();

  // Store tokens in org metadata (or a dedicated table)
  await db.organisation.update({
    where: { id: orgId },
    data: {
      autoTopUp: {
        // Preserve existing autoTopUp data, add zoom tokens
        ...(await db.organisation.findUnique({ where: { id: orgId }, select: { autoTopUp: true } }).then(o => (o?.autoTopUp as any) || {})),
        zoomAccessToken: data.access_token,
        zoomRefreshToken: data.refresh_token,
        zoomTokenExpiry: Date.now() + data.expires_in * 1000,
        zoomConnected: true,
      },
    },
  });

  return true;
}

/**
 * Get a valid Zoom access token for an org, refreshing if needed.
 */
async function getAccessToken(orgId: string): Promise<string | null> {
  const org = await db.organisation.findUnique({
    where: { id: orgId },
    select: { autoTopUp: true },
  });

  const meta = (org?.autoTopUp as any) || {};
  if (!meta.zoomAccessToken) return null;

  // Check if token is expired (with 5 min buffer)
  if (meta.zoomTokenExpiry && meta.zoomTokenExpiry < Date.now() + 300000) {
    // Refresh token
    const auth = Buffer.from(`${getClientId()}:${getClientSecret()}`).toString("base64");
    const response = await fetch(ZOOM_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: meta.zoomRefreshToken,
      }),
    });

    if (!response.ok) {
      console.error("Zoom token refresh failed");
      return null;
    }

    const data = await response.json();
    await db.organisation.update({
      where: { id: orgId },
      data: {
        autoTopUp: {
          ...meta,
          zoomAccessToken: data.access_token,
          zoomRefreshToken: data.refresh_token || meta.zoomRefreshToken,
          zoomTokenExpiry: Date.now() + data.expires_in * 1000,
        },
      },
    });

    return data.access_token;
  }

  return meta.zoomAccessToken;
}

/**
 * Check if Zoom is connected for an org.
 */
export async function isZoomConnected(orgId: string): Promise<boolean> {
  const org = await db.organisation.findUnique({
    where: { id: orgId },
    select: { autoTopUp: true },
  });
  return !!(org?.autoTopUp as any)?.zoomConnected;
}

/**
 * Create a Zoom meeting.
 */
export async function createZoomMeeting(orgId: string, options: {
  topic: string;
  startTime: string; // ISO 8601
  duration: number; // minutes
  agenda?: string;
  invitees?: { email: string }[];
}): Promise<{ joinUrl: string; meetingId: number; password: string } | null> {
  const token = await getAccessToken(orgId);
  if (!token) return null;

  const response = await fetch(`${ZOOM_API_URL}/users/me/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic: options.topic,
      type: 2, // Scheduled meeting
      start_time: options.startTime,
      duration: options.duration,
      timezone: "Europe/London",
      agenda: options.agenda || "",
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: true,
        waiting_room: false,
        meeting_invitees: options.invitees || [],
        auto_recording: "cloud", // Auto record for transcript
      },
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    console.error("Zoom meeting creation failed:", err);
    return null;
  }

  const meeting = await response.json();
  return {
    joinUrl: meeting.join_url,
    meetingId: meeting.id,
    password: meeting.password || "",
  };
}

/**
 * Full flow: Agent creates a Zoom meeting, saves to calendar, optionally invites via email.
 */
export async function agentScheduleZoomMeeting(agentId: string, data: {
  title: string;
  startTime: string;
  duration: number;
  projectId?: string;
  invitees?: { name: string; email: string }[];
  agenda?: string;
}): Promise<{ success: boolean; joinUrl?: string; error?: string; botDispatched?: boolean; botProvider?: "recall" | "custom" | null }> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: { org: { select: { id: true } }, agentEmail: true },
  });

  if (!agent) return { success: false, error: "Agent not found" };

  const orgId = agent.org.id;
  const connected = await isZoomConnected(orgId);
  if (!connected) return { success: false, error: "Zoom not connected. Go to Admin → Integrations to connect." };

  // Create the Zoom meeting
  const zoom = await createZoomMeeting(orgId, {
    topic: data.title,
    startTime: data.startTime,
    duration: data.duration,
    agenda: data.agenda,
    invitees: data.invitees?.map(i => ({ email: i.email })),
  });

  if (!zoom) return { success: false, error: "Failed to create Zoom meeting" };

  // Save to calendar
  const event = await db.calendarEvent.create({
    data: {
      orgId,
      title: data.title,
      startTime: new Date(data.startTime),
      endTime: new Date(new Date(data.startTime).getTime() + data.duration * 60000),
      projectId: data.projectId || null,
      agentId,
      meetingUrl: zoom.joinUrl,
      attendees: data.invitees || [],
      source: "MANUAL",
      description: data.agenda || null,
    },
  });

  // Save to meetings table too
  const meeting = await db.meeting.create({
    data: {
      title: data.title,
      orgId,
      projectId: data.projectId || null,
      agentId,
      platform: "zoom",
      scheduledAt: new Date(data.startTime),
      status: "SCHEDULED",
      attendees: data.invitees || [],
    },
  });

  // Dispatch the recording bot — Recall.ai (or self-hosted Custom bot) joins
  // the meeting at start time, captures the audio + transcript, and posts to
  // /api/webhooks/meeting-transcript when done. Same logic the
  // /api/agents/[id]/meetings/create endpoint uses; previously this Calendar
  // path silently skipped it, leaving the agent with no way to capture what
  // was said. Best-effort: bot failure does NOT fail the meeting creation.
  let botId: string | null = null;
  let botProvider: "recall" | "custom" | null = null;
  try {
    const haveCustom = !!process.env.CUSTOM_BOT_SERVICE_URL && !!process.env.CUSTOM_BOT_SERVICE_KEY;
    const haveRecall = !!process.env.RECALL_API_KEY;
    if (haveCustom || haveRecall) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "";
      const webhookUrl = `${appUrl}/api/webhooks/meeting-transcript`;
      const botName = `${agent.name} (AI Assistant)`;
      const joinAt = new Date(data.startTime);

      if (haveCustom) {
        const { createCustomBot } = await import("@/lib/custom-bot-client");
        const bot = await createCustomBot(meeting.id, agentId, orgId, zoom.joinUrl, botName, { joinAt });
        botId = bot.id;
        botProvider = "custom";
      } else {
        const { createRecallBot, normaliseBotStatus } = await import("@/lib/recall-client");
        const bot = await createRecallBot(zoom.joinUrl, botName, webhookUrl, { joinAt });
        botId = bot.id;
        botProvider = "recall";
        // Eagerly normalise the initial status string for visibility
        normaliseBotStatus(bot.status.code);
      }

      await db.meeting.update({
        where: { id: meeting.id },
        data: { recallBotId: botId, botProvider },
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[zoom] bot dispatch failed:", e);
    await db.meeting.update({
      where: { id: meeting.id },
      data: { recallBotStatus: "failed" },
    }).catch(() => {});
  }

  // Send invite emails via agent email
  if (data.invitees?.length && agent.agentEmail?.isActive) {
    try {
      const { EmailService } = await import("@/lib/email");
      await EmailService.sendAgentEmail(agentId, {
        to: data.invitees.map(i => i.email),
        subject: `Meeting Invitation: ${data.title}`,
        html: `
          <div style="background: linear-gradient(135deg, #6366F1, #8B5CF6); padding: 20px 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 18px;">📅 Meeting Invitation</h1>
          </div>
          <div style="padding: 24px; background: #FFFFFF; border: 1px solid #E2E8F0; border-top: 0; border-radius: 0 0 12px 12px;">
            <h2 style="margin: 0 0 12px; font-size: 16px; color: #0F172A;">${data.title}</h2>
            <table style="font-size: 14px; color: #475569;">
              <tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">When:</td><td>${new Date(data.startTime).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td></tr>
              <tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">Duration:</td><td>${data.duration} minutes</td></tr>
              ${data.agenda ? `<tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">Agenda:</td><td>${data.agenda}</td></tr>` : ""}
            </table>
            <a href="${zoom.joinUrl}" style="display: inline-block; margin-top: 20px; background: #2D8CFF; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
              Join Zoom Meeting
            </a>
            <p style="margin-top: 16px; color: #94A3B8; font-size: 12px;">Meeting ID: ${zoom.meetingId} · Password: ${zoom.password}</p>
          </div>
        `,
      });
    } catch (e) {
      console.error("Failed to send meeting invites:", e);
    }
  }

  // Log agent activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "meeting",
      summary: `Scheduled Zoom meeting: "${data.title}" with ${data.invitees?.length || 0} invitees`,
      metadata: { meetingId: zoom.meetingId, joinUrl: zoom.joinUrl, invitees: data.invitees },
    },
  });

  // Generate pre-meeting brief if project is linked
  if (data.projectId) {
    try {
      const { generatePreMeetingBrief } = await import("@/lib/agents/meeting-processor");
      await generatePreMeetingBrief(event.id);
    } catch (e) {
      console.error("Pre-meeting brief failed:", e);
    }
  }

  return { success: true, joinUrl: zoom.joinUrl, botDispatched: !!botId, botProvider };
}
