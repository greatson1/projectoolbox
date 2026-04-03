import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// GET /api/integrations/zoom — Get Zoom auth URL + connection status
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const { getZoomAuthUrl, isZoomConnected } = await import("@/lib/zoom");
  const connected = await isZoomConnected(orgId);
  const authUrl = connected ? null : getZoomAuthUrl(orgId);

  return NextResponse.json({ data: { connected, authUrl } });
}
