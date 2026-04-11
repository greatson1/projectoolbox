/**
 * GET /api/integrations/google-calendar/connect
 * Redirects the user to the Google OAuth consent screen for Calendar access.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGoogleCalAuthUrl } from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const authUrl = getGoogleCalAuthUrl(orgId);
  return NextResponse.redirect(authUrl);
}
