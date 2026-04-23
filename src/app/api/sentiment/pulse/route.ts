import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrgSentimentPulse } from "@/lib/sentiment/trend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const days = parseInt(new URL(req.url).searchParams.get("days") || "7", 10);
  const pulse = await getOrgSentimentPulse(orgId, days);
  return NextResponse.json({ data: pulse });
}
