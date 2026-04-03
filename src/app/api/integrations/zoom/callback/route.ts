import { NextRequest, NextResponse } from "next/server";

// GET /api/integrations/zoom/callback — Zoom OAuth callback
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // orgId

  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?zoom=failed&reason=no_code", req.url));
  }

  try {
    // Exchange code for tokens directly here (not via import) to avoid any module issues
    const clientId = process.env.ZOOM_CLIENT_ID || "";
    const clientSecret = process.env.ZOOM_CLIENT_SECRET || "";
    const redirectUri = process.env.ZOOM_REDIRECT_URI || `${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}/api/integrations/zoom/callback`;

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokenRes = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error("Zoom token exchange failed:", JSON.stringify(tokenData));
      return NextResponse.redirect(new URL(`/login?zoom=failed&reason=${tokenData.error || "token_error"}`, req.url));
    }

    // Save tokens to org
    const { db } = await import("@/lib/db");
    const org = await db.organisation.findUnique({
      where: { id: state },
      select: { autoTopUp: true },
    });

    const existingMeta = (org?.autoTopUp as any) || {};

    await db.organisation.update({
      where: { id: state },
      data: {
        autoTopUp: {
          ...existingMeta,
          zoomAccessToken: tokenData.access_token,
          zoomRefreshToken: tokenData.refresh_token,
          zoomTokenExpiry: Date.now() + tokenData.expires_in * 1000,
          zoomConnected: true,
          zoomScopes: tokenData.scope,
        },
      },
    });

    return NextResponse.redirect(new URL("/login?zoom=connected", req.url));
  } catch (e: any) {
    console.error("Zoom OAuth callback error:", e);
    return NextResponse.redirect(new URL(`/login?zoom=error&msg=${encodeURIComponent(e.message)}`, req.url));
  }
}
