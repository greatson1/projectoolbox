import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isGoogleCalendarConnected } from "@/lib/google-calendar";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });
  const connected = await isGoogleCalendarConnected(orgId);
  return NextResponse.json({ data: { connected, authUrl: connected ? null : `/api/integrations/google-calendar/connect` } });
}
