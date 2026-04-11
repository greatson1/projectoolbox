/**
 * GET /api/integrations/google-calendar/callback
 * Receives the OAuth code, exchanges for tokens, stores in org metadata.
 */
import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleCalCode } from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state"); // orgId
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://projectoolbox.vercel.app";

  if (error || !code || !state) {
    return NextResponse.redirect(`${appUrl}/settings?gcal=failed&reason=${error || "no_code"}`);
  }

  try {
    const ok = await exchangeGoogleCalCode(code, state);
    if (!ok) return NextResponse.redirect(`${appUrl}/settings?gcal=failed&reason=token_error`);
    return NextResponse.redirect(`${appUrl}/settings?gcal=connected`);
  } catch (e: any) {
    console.error("[google-calendar callback]", e);
    return NextResponse.redirect(`${appUrl}/settings?gcal=error&msg=${encodeURIComponent(e.message)}`);
  }
}
