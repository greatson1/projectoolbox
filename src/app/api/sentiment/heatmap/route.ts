import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStakeholderHeatmap } from "@/lib/sentiment/trend";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const heatmap = await getStakeholderHeatmap(orgId);
  return NextResponse.json({ data: heatmap });
}
