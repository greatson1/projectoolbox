import { NextRequest, NextResponse } from "next/server";

// GET /api/integrations/zoom/callback — Zoom OAuth callback
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // orgId

  if (!code || !state) {
    return NextResponse.redirect(new URL("/admin?error=zoom_auth_failed", req.url));
  }

  try {
    const { exchangeZoomCode } = await import("@/lib/zoom");
    const success = await exchangeZoomCode(code, state);

    if (success) {
      return NextResponse.redirect(new URL("/admin?zoom=connected", req.url));
    } else {
      return NextResponse.redirect(new URL("/admin?error=zoom_token_failed", req.url));
    }
  } catch (e) {
    console.error("Zoom OAuth callback error:", e);
    return NextResponse.redirect(new URL("/admin?error=zoom_error", req.url));
  }
}
