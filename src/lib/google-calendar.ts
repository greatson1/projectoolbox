/**
 * Google Calendar + Meet integration
 *
 * Stores Google Calendar OAuth tokens in the Organisation.autoTopUp JSON blob
 * (same piggyback pattern as Zoom tokens) under keys:
 *   googleCalAccessToken, googleCalRefreshToken, googleCalTokenExpiry, googleCalConnected
 *
 * Scopes required:
 *   https://www.googleapis.com/auth/calendar.events
 *
 * Connect flow:  GET /api/integrations/google-calendar/connect
 * Callback:      GET /api/integrations/google-calendar/callback
 */

import { db } from "@/lib/db";

const GCAL_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GCAL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GCAL_API_URL  = "https://www.googleapis.com/calendar/v3";

function getClientId()     { return process.env.GOOGLE_CLIENT_ID     || ""; }
function getClientSecret() { return process.env.GOOGLE_CLIENT_SECRET || ""; }
function getRedirectUri()  {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://projectoolbox.vercel.app";
  return `${base}/api/integrations/google-calendar/callback`;
}

// ─── Auth URL ─────────────────────────────────────────────────────────────────

export function getGoogleCalAuthUrl(orgId: string): string {
  const params = new URLSearchParams({
    client_id:     getClientId(),
    redirect_uri:  getRedirectUri(),
    response_type: "code",
    scope:         "https://www.googleapis.com/auth/calendar.events",
    access_type:   "offline",
    prompt:        "consent",
    state:         orgId,
  });
  return `${GCAL_AUTH_URL}?${params}`;
}

// ─── Token exchange / refresh ──────────────────────────────────────────────────

export async function exchangeGoogleCalCode(code: string, orgId: string): Promise<boolean> {
  const res = await fetch(GCAL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     getClientId(),
      client_secret: getClientSecret(),
      redirect_uri:  getRedirectUri(),
      grant_type:    "authorization_code",
    }),
  });

  if (!res.ok) {
    console.error("[google-calendar] token exchange failed:", await res.text());
    return false;
  }

  const data = await res.json();
  const org  = await db.organisation.findUnique({ where: { id: orgId }, select: { autoTopUp: true } });
  const meta = (org?.autoTopUp as any) || {};

  await db.organisation.update({
    where: { id: orgId },
    data: {
      autoTopUp: {
        ...meta,
        googleCalAccessToken:  data.access_token,
        googleCalRefreshToken: data.refresh_token || meta.googleCalRefreshToken,
        googleCalTokenExpiry:  Date.now() + (data.expires_in || 3600) * 1000,
        googleCalConnected:    true,
      },
    },
  });

  return true;
}

async function getAccessToken(orgId: string): Promise<string | null> {
  const org  = await db.organisation.findUnique({ where: { id: orgId }, select: { autoTopUp: true } });
  const meta = (org?.autoTopUp as any) || {};
  if (!meta.googleCalAccessToken) return null;

  // Refresh if expiring within 5 minutes
  if (meta.googleCalTokenExpiry && meta.googleCalTokenExpiry < Date.now() + 300_000) {
    if (!meta.googleCalRefreshToken) return null;
    const res = await fetch(GCAL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     getClientId(),
        client_secret: getClientSecret(),
        refresh_token: meta.googleCalRefreshToken,
        grant_type:    "refresh_token",
      }),
    });
    if (!res.ok) { console.error("[google-calendar] token refresh failed"); return null; }
    const data = await res.json();
    await db.organisation.update({
      where: { id: orgId },
      data: {
        autoTopUp: {
          ...meta,
          googleCalAccessToken: data.access_token,
          googleCalTokenExpiry: Date.now() + (data.expires_in || 3600) * 1000,
        },
      },
    });
    return data.access_token;
  }

  return meta.googleCalAccessToken;
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function isGoogleCalendarConnected(orgId: string): Promise<boolean> {
  const org = await db.organisation.findUnique({ where: { id: orgId }, select: { autoTopUp: true } });
  return !!(org?.autoTopUp as any)?.googleCalConnected;
}

// ─── Create a Google Meet event ───────────────────────────────────────────────

export async function createGoogleMeet(
  orgId: string,
  options: {
    summary:    string;
    startTime:  string; // ISO 8601
    endTime:    string; // ISO 8601
    attendees?: { email: string }[];
    description?: string;
  },
): Promise<{ joinUrl: string; eventId: string } | null> {
  const token = await getAccessToken(orgId);
  if (!token) return null;

  const body = {
    summary:     options.summary,
    description: options.description || "",
    start: { dateTime: options.startTime, timeZone: "Europe/London" },
    end:   { dateTime: options.endTime,   timeZone: "Europe/London" },
    attendees: options.attendees || [],
    conferenceData: {
      createRequest: {
        conferenceSolutionKey: { type: "hangoutsMeet" },
        requestId: `ptx-${Date.now()}`,
      },
    },
  };

  const res = await fetch(
    `${GCAL_API_URL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    console.error("[google-calendar] create event failed:", await res.text());
    return null;
  }

  const event = await res.json();
  const joinUrl = event.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === "video")?.uri;

  if (!joinUrl) {
    console.error("[google-calendar] no Meet link in response:", JSON.stringify(event.conferenceData));
    return null;
  }

  return { joinUrl, eventId: event.id };
}
