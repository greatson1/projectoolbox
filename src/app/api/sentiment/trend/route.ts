import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSentimentTrend } from "@/lib/sentiment/trend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const url = new URL(req.url);
  const subjectType = url.searchParams.get("subjectType") || "stakeholder";
  const subjectId = url.searchParams.get("subjectId");
  const days = parseInt(url.searchParams.get("days") || "30", 10);

  if (!subjectId) return NextResponse.json({ error: "subjectId required" }, { status: 400 });

  const trend = await getSentimentTrend(orgId, subjectType, subjectId, days);
  return NextResponse.json({ data: trend });
}
